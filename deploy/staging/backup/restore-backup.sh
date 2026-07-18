#!/bin/bash
set -Eeuo pipefail

source /opt/staging/integrity-lib.sh
require_integrity_tools

backup_id="${1:-}"
assert_backup_id "$backup_id"
if [[ "${CONFIRM_DATABASE_RESTORE:-}" != "finance_agent_staging/$backup_id" ]]; then
  integrity_fail 'database_restore_confirmation_mismatch'
  exit 1
fi
if [[ "${CONFIRM_APPLICATION_QUIESCED:-}" != "finance_agent_staging/$backup_id" ]]; then
  integrity_fail 'application_quiescence_confirmation_mismatch'
  exit 1
fi
if [[ "${ALLOW_STAGING_RESTORE:-}" != 'true' ]]; then
  integrity_fail 'staging_restore_not_enabled'
  exit 1
fi

authorization_file="${RESTORE_AUTHORIZATION_FILE:?RESTORE_AUTHORIZATION_FILE is required}"
[[ -s "$authorization_file" ]] || { integrity_fail 'restore_authorization_missing'; exit 1; }
jq -e --arg backupId "$backup_id" '
  ((keys - [
    "schemaVersion", "targetEnvironment", "targetDatabase", "targetBucket", "backupId",
    "changeId", "nonce", "expiresAt", "h13Approved", "h13ApprovalId",
    "h14Approved", "h14ApprovalId"
  ]) | length) == 0 and
  .schemaVersion == "restore-authorization/1.0" and
  .targetEnvironment == "finance-agent-staging" and
  .targetDatabase == "finance_agent_staging" and
  .targetBucket == "finance-agent-raw" and
  .backupId == $backupId and
  .h13Approved == true and (.h13ApprovalId | type == "string" and length >= 3 and length <= 128) and
  .h14Approved == true and (.h14ApprovalId | type == "string" and length >= 3 and length <= 128) and
  (.changeId | type == "string" and test("^[A-Za-z0-9._-]{3,128}$")) and
  (.nonce | type == "string" and test("^[A-Za-z0-9_-]{16,128}$")) and
  (.expiresAt | type == "string" and length <= 64)
' "$authorization_file" >/dev/null || { integrity_fail 'restore_authorization_invalid'; exit 1; }
authorization_expires="$(jq -r '.expiresAt' "$authorization_file")"
authorization_expiry_epoch="$(date -u -d "$authorization_expires" +%s 2>/dev/null || printf '0')"
now_epoch="$(date +%s)"
if (( authorization_expiry_epoch <= now_epoch || authorization_expiry_epoch > now_epoch + 86400 )); then
  integrity_fail 'restore_authorization_expired_or_too_long'
  exit 1
fi
authorization_sha256="$(sha256_file "$authorization_file")"
authorization_marker="/backups/restore-authorizations/$authorization_sha256.used"

assert_authorization_unused() {
  [[ ! -e "$authorization_marker" ]] || integrity_fail 'restore_authorization_already_used'
}

consume_authorization() {
  mkdir "$authorization_marker" 2>/dev/null || integrity_fail 'restore_authorization_already_used'
  jq -n --arg usedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg backupId "$backup_id" \
    '{usedAt:$usedAt, backupId:$backupId}' > "$authorization_marker/evidence.json"
}

assert_authorization_unused
migration_url="$(cat "${MIGRATION_DATABASE_URL_FILE:?}")"
database_name="$(psql "$migration_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$database_name" != 'finance_agent_staging' ]]; then
  integrity_fail 'restore_target_must_be_finance_agent_staging'
  exit 1
fi
restore_admin_url="$(cat "${RESTORE_DATABASE_URL_FILE:?}")"
restore_admin_database="$(psql "$restore_admin_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$restore_admin_database" != 'postgres' ]]; then
  integrity_fail 'restore_admin_database_must_be_postgres'
  exit 1
fi

backup_dir="/backups/logical/$backup_id"
[[ -f "$backup_dir/complete" ]] || { integrity_fail 'requested_backup_is_not_complete'; exit 1; }
verify_sha256_sidecar "$backup_dir/manifest.json" "$backup_dir/manifest.sha256"
validate_backup_manifest "$backup_dir/manifest.json"

run_suffix="${backup_id,,}_${authorization_sha256:0:8}"
run_suffix="${run_suffix//t/_}"
run_suffix="${run_suffix//z/}"
stage_database="finance_agent_restore_stage_${run_suffix}_test"
stage_url="${restore_admin_url/\/postgres?/\/$stage_database?}"
if [[ "$stage_url" == "$restore_admin_url" ]]; then
  integrity_fail 'restore_database_url_has_unexpected_database_name'
  exit 1
fi
stage_bucket="finance-agent-restore-stage-${backup_id,,}-${authorization_sha256:0:8}"
compensation_dir="/backups/restore-compensation/${backup_id}-${authorization_sha256:0:8}"
compensation_bucket="finance-agent-restore-comp-${backup_id,,}-${authorization_sha256:0:8}"
[[ "$stage_database" =~ ^finance_agent_restore_stage_[a-z0-9_]+_test$ ]] || { integrity_fail 'unsafe_restore_stage_database_name'; exit 1; }
[[ "$stage_bucket" =~ ^finance-agent-restore-stage-[a-z0-9-]+$ ]] || { integrity_fail 'unsafe_restore_stage_bucket_name'; exit 1; }
[[ "$compensation_bucket" =~ ^finance-agent-restore-comp-[a-z0-9-]+$ ]] || { integrity_fail 'unsafe_compensation_bucket_name'; exit 1; }

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null

cutover_started=false
cutover_completed=false
compensation_ready=false

cleanup_stage() {
  set +e
  if [[ "$stage_database" =~ ^finance_agent_restore_stage_[a-z0-9_]+_test$ ]]; then
    dropdb --if-exists --force --maintenance-db="$restore_admin_url" "$stage_database" >/dev/null 2>&1 || true
  fi
  if [[ "$stage_bucket" =~ ^finance-agent-restore-stage-[a-z0-9-]+$ ]]; then
    mc rm --recursive --force --dangerous "staging/$stage_bucket" >/dev/null 2>&1 || true
    mc rb --force --dangerous "staging/$stage_bucket" >/dev/null 2>&1 || true
  fi
}

mirror_empty_or_source() {
  local source="$1" target="$2" count="$3"
  if (( count > 0 )); then
    mc mirror --overwrite --remove "$source" "$target" >/dev/null
  else
    local empty_dir
    empty_dir="$(mktemp -d)"
    mc mirror --overwrite --remove "$empty_dir" "$target" >/dev/null
    rmdir "$empty_dir"
  fi
}

restore_stage_database() {
  dropdb --if-exists --force --maintenance-db="$restore_admin_url" "$stage_database"
  createdb --maintenance-db="$restore_admin_url" "$stage_database"
  pg_restore --dbname="$stage_url" --no-owner --no-acl --exit-on-error --single-transaction "$backup_dir/database.dump"
}

restore_stage_bucket() {
  local expected_count
  expected_count="$(jq -r '.objects.count' "$backup_dir/manifest.json")"
  mc mb --ignore-existing "staging/$stage_bucket" >/dev/null
  mc anonymous set none "staging/$stage_bucket" >/dev/null
  mc version enable "staging/$stage_bucket" >/dev/null
  if (( expected_count > 0 )); then
    mc mirror --overwrite "staging/finance-agent-backups/raw/$backup_id" "staging/$stage_bucket" >/dev/null
  fi
}

create_compensation_snapshot() {
  local current_count
  mkdir -p "$compensation_dir"
  pg_dump "$migration_url" --format=custom --compress=6 --no-owner --no-acl --file "$compensation_dir/database.dump"
  pg_restore --list "$compensation_dir/database.dump" >/dev/null
  generate_database_object_refs "$migration_url" "$compensation_dir/database-object-refs.jsonl"
  generate_object_manifest staging/finance-agent-raw "$compensation_dir/source-object-manifest.jsonl"
  verify_database_object_refs_file "$compensation_dir/database-object-refs.jsonl" "$compensation_dir/source-object-manifest.jsonl"
  current_count="$(jq -s 'length' "$compensation_dir/source-object-manifest.jsonl")"
  mc mb --ignore-existing "staging/$compensation_bucket" >/dev/null
  mc anonymous set none "staging/$compensation_bucket" >/dev/null
  mc version enable "staging/$compensation_bucket" >/dev/null
  if (( current_count > 0 )); then
    mc mirror --overwrite staging/finance-agent-raw "staging/$compensation_bucket" >/dev/null
    generate_object_manifest "staging/$compensation_bucket" "$compensation_dir/object-manifest.jsonl"
    compare_object_manifests "$compensation_dir/source-object-manifest.jsonl" "$compensation_dir/object-manifest.jsonl"
  else
    : > "$compensation_dir/object-manifest.jsonl"
  fi
  jq -nS \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg databaseSha256 "$(sha256_file "$compensation_dir/database.dump")" \
    --arg databaseRefsSha256 "$(sha256_file "$compensation_dir/database-object-refs.jsonl")" \
    --arg objectManifestSha256 "$(sha256_file "$compensation_dir/object-manifest.jsonl")" \
    --arg bucket "$compensation_bucket" --argjson objectCount "$current_count" \
    '{
      schemaVersion:"restore-compensation/1.0",
      createdAt:$createdAt,
      databaseSha256:$databaseSha256,
      databaseRefsSha256:$databaseRefsSha256,
      objectManifestSha256:$objectManifestSha256,
      bucket:$bucket,
      objectCount:$objectCount,
      retention:"pending_h14"
    }' > "$compensation_dir/manifest.json"
  write_sha256_sidecar "$compensation_dir/manifest.json" "$compensation_dir/manifest.sha256"
  compensation_ready=true
}

restore_live_bucket() {
  local expected_count
  expected_count="$(jq -r '.objects.count' "$backup_dir/manifest.json")"
  mirror_empty_or_source "staging/$stage_bucket" staging/finance-agent-raw "$expected_count"
  verify_object_manifest "$backup_dir/object-manifest.jsonl" staging/finance-agent-raw
}

restore_live_database() {
  pg_restore \
    --dbname="$migration_url" \
    --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction \
    "$backup_dir/database.dump"
}

run_compensation_restore() {
  local compensation_count expected_database_sha expected_refs_sha expected_objects_sha
  [[ "$compensation_ready" == true ]] || return 1
  verify_sha256_sidecar "$compensation_dir/manifest.json" "$compensation_dir/manifest.sha256" || return 1
  jq -e '
    .schemaVersion == "restore-compensation/1.0" and
    (.databaseSha256 | test("^[0-9a-f]{64}$")) and
    (.databaseRefsSha256 | test("^[0-9a-f]{64}$")) and
    (.objectManifestSha256 | test("^[0-9a-f]{64}$")) and
    (.objectCount | type == "number" and . >= 0 and floor == .)
  ' "$compensation_dir/manifest.json" >/dev/null || return 1
  expected_database_sha="$(jq -r '.databaseSha256' "$compensation_dir/manifest.json")"
  expected_refs_sha="$(jq -r '.databaseRefsSha256' "$compensation_dir/manifest.json")"
  expected_objects_sha="$(jq -r '.objectManifestSha256' "$compensation_dir/manifest.json")"
  [[ "$(sha256_file "$compensation_dir/database.dump")" == "$expected_database_sha" ]] || return 1
  [[ "$(sha256_file "$compensation_dir/database-object-refs.jsonl")" == "$expected_refs_sha" ]] || return 1
  [[ "$(sha256_file "$compensation_dir/object-manifest.jsonl")" == "$expected_objects_sha" ]] || return 1
  compensation_count="$(jq -r '.objectCount' "$compensation_dir/manifest.json")"
  verify_object_manifest "$compensation_dir/object-manifest.jsonl" "staging/$compensation_bucket" || return 1
  verify_database_object_refs_file "$compensation_dir/database-object-refs.jsonl" "$compensation_dir/object-manifest.jsonl" || return 1
  mirror_empty_or_source "staging/$compensation_bucket" staging/finance-agent-raw "$compensation_count"
  pg_restore \
    --dbname="$migration_url" \
    --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction \
    "$compensation_dir/database.dump"
  verify_object_manifest "$compensation_dir/object-manifest.jsonl" staging/finance-agent-raw
  verify_database_object_refs "$migration_url" "$compensation_dir/database-object-refs.jsonl" "$compensation_dir/object-manifest.jsonl"
}

on_exit() {
  local status="$?"
  trap - EXIT
  if (( status != 0 )) && [[ "$cutover_started" == true && "$cutover_completed" != true ]]; then
    if ! run_compensation_restore; then
      printf 'restore_compensation_failed:%s\n' "$compensation_dir" >&2
    else
      printf 'restore_compensation_completed:%s\n' "$compensation_dir" >&2
    fi
  fi
  cleanup_stage
  exit "$status"
}
trap on_exit EXIT

restore_stage_database
restore_stage_bucket
verify_backup_bundle "$backup_dir" "staging/$stage_bucket" "$stage_url"
create_compensation_snapshot
assert_authorization_unused
consume_authorization

cutover_started=true
restore_live_bucket
restore_live_database
verify_backup_bundle "$backup_dir" staging/finance-agent-raw "$migration_url"
manifest_sha256="$(sha256_file "$backup_dir/manifest.json")"
audit_id="restore-${backup_id}-${authorization_sha256:0:8}"
psql "$migration_url" --set=ON_ERROR_STOP=1 --command "
  INSERT INTO audit_logs (id, action, resource_type, resource_id, metadata, created_at)
  VALUES (
    '$audit_id', 'staging.backup_restored', 'database', '$backup_id',
    jsonb_build_object(
      'backupId', '$backup_id',
      'manifestSha256', '$manifest_sha256',
      'authorizationSha256', '$authorization_sha256',
      'cutoverMode', 'application_level_phased_with_compensation',
      'compensationId', '${backup_id}-${authorization_sha256:0:8}'
    ), now()
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO ledger_events (id, event_type, aggregate_type, aggregate_id, idempotency_key, payload, created_at)
  VALUES (
    'ledger-$audit_id', 'staging.backup_restored', 'database', '$backup_id', 'restore:$authorization_sha256',
    jsonb_build_object('manifestSha256', '$manifest_sha256', 'authorizationSha256', '$authorization_sha256'), now()
  ) ON CONFLICT (idempotency_key) DO NOTHING;
"
cutover_completed=true
cleanup_stage
trap - EXIT
echo "Staging data restored from $backup_id using application-level phased cutover; compensation snapshot retained pending H14"
