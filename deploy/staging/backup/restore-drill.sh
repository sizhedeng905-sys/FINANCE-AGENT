#!/bin/bash
set -Eeuo pipefail

source /opt/staging/integrity-lib.sh
require_integrity_tools

started_epoch="$(date +%s)"
restore_metrics_file="${RESTORE_METRICS_FILE:-/metrics/finance_agent_restore.prom}"
migration_url="$(cat "${MIGRATION_DATABASE_URL_FILE:?}")"
database_name="$(psql "$migration_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$database_name" != 'finance_agent_staging' ]]; then
  integrity_fail 'restore_drill_source_must_be_finance_agent_staging'
  exit 1
fi

latest_complete="$(find /backups/logical -mindepth 2 -maxdepth 2 -name complete -print | sort | tail -1)"
if [[ -z "$latest_complete" ]]; then
  integrity_fail 'no_complete_backup_available_for_restore_drill'
  exit 1
fi
backup_dir="$(dirname "$latest_complete")"
backup_id="$(basename "$backup_dir")"
assert_backup_id "$backup_id"

restore_admin_url="$(cat "${RESTORE_DATABASE_URL_FILE:?}")"
restore_admin_database="$(psql "$restore_admin_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$restore_admin_database" != 'postgres' ]]; then
  integrity_fail 'restore_admin_database_must_be_postgres'
  exit 1
fi
database_suffix="${backup_id,,}"
database_suffix="${database_suffix//t/_}"
database_suffix="${database_suffix//z/}"
restore_database="finance_agent_restore_drill_${database_suffix}_${RANDOM}_test"
restore_url="${restore_admin_url/\/postgres?/\/$restore_database?}"
if [[ "$restore_url" == "$restore_admin_url" ]]; then
  integrity_fail 'restore_database_url_has_unexpected_database_name'
  exit 1
fi
restore_bucket="finance-agent-restore-drill-${backup_id,,}-${RANDOM}"
fault_bucket="finance-agent-restore-fault-${backup_id,,}-${RANDOM}"
[[ "$restore_database" =~ ^finance_agent_restore_drill_[a-z0-9_]+_test$ ]] || integrity_fail 'unsafe_restore_drill_database_name'
[[ "$restore_bucket" =~ ^finance-agent-restore-drill-[a-z0-9-]+$ ]] || integrity_fail 'unsafe_restore_drill_bucket_name'
[[ "$fault_bucket" =~ ^finance-agent-restore-fault-[a-z0-9-]+$ ]] || integrity_fail 'unsafe_restore_fault_bucket_name'

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null

cleanup() {
  set +e
  if [[ "$restore_database" =~ ^finance_agent_restore_drill_[a-z0-9_]+_test$ ]]; then
    dropdb --if-exists --force --maintenance-db="$restore_admin_url" "$restore_database" >/dev/null 2>&1 || true
  fi
  if [[ "$restore_bucket" =~ ^finance-agent-restore-drill-[a-z0-9-]+$ ]]; then
    mc rm --recursive --force --dangerous "staging/$restore_bucket" >/dev/null 2>&1 || true
    mc rb --force --dangerous "staging/$restore_bucket" >/dev/null 2>&1 || true
  fi
  if [[ "$fault_bucket" =~ ^finance-agent-restore-fault-[a-z0-9-]+$ ]]; then
    mc rm --recursive --force --dangerous "staging/$fault_bucket" >/dev/null 2>&1 || true
    mc rb --force --dangerous "staging/$fault_bucket" >/dev/null 2>&1 || true
  fi
}

record_failure() {
  set +e
  local failed_epoch
  failed_epoch="$(date +%s)"
  cat > "$restore_metrics_file.tmp" <<METRICS
finance_agent_restore_drill_success 0
finance_agent_restore_drill_last_failure_timestamp_seconds $failed_epoch
METRICS
  mv "$restore_metrics_file.tmp" "$restore_metrics_file"
}

on_exit() {
  local status="$?"
  trap - EXIT
  cleanup
  if (( status != 0 )); then
    record_failure
  fi
  exit "$status"
}
trap on_exit EXIT

restore_stage_database() {
  dropdb --if-exists --force --maintenance-db="$restore_admin_url" "$restore_database"
  createdb --maintenance-db="$restore_admin_url" "$restore_database"
  pg_restore \
    --dbname="$restore_url" \
    --no-owner --no-acl --exit-on-error --single-transaction \
    "$backup_dir/database.dump"
}

restore_stage_bucket() {
  local expected_count
  mc mb --ignore-existing "staging/$restore_bucket" >/dev/null
  mc anonymous set none "staging/$restore_bucket" >/dev/null
  mc version enable "staging/$restore_bucket" >/dev/null
  expected_count="$(jq -r '.objects.count' "$backup_dir/manifest.json")"
  if (( expected_count > 0 )); then
    mc mirror --overwrite "staging/finance-agent-backups/raw/$backup_id" "staging/$restore_bucket" >/dev/null
  fi
}

run_object_fault_injection_tests() {
  local expected key extra_key base_content other_content
  expected="$(mktemp)"
  key='2099/01/423e4567-e89b-42d3-a456-426614174000.pdf'
  extra_key='2099/01/523e4567-e89b-42d3-a456-426614174000.pdf'
  base_content='0123456789ABCDEFGHI'
  other_content='JKLMNOPQRSTUVWXYZ01'
  mc mb --ignore-existing "staging/$fault_bucket" >/dev/null
  mc anonymous set none "staging/$fault_bucket" >/dev/null
  printf '%s' "$base_content" | mc pipe "staging/$fault_bucket/$key" >/dev/null
  generate_object_manifest "staging/$fault_bucket" "$expected"

  expect_object_failure() {
    local label="$1"
    if verify_object_manifest "$expected" "staging/$fault_bucket" >/dev/null 2>&1; then
      rm -f "$expected"
      integrity_fail "fault_injection_not_rejected_$label"
      return 1
    fi
  }
  reset_fault_bucket() {
    mc rm --recursive --force --dangerous "staging/$fault_bucket" >/dev/null 2>&1 || true
  }

  reset_fault_bucket
  printf '%s' "$base_content" | mc pipe "staging/$fault_bucket/$extra_key" >/dev/null
  expect_object_failure same_count_wrong_key
  reset_fault_bucket
  printf '%s' "${base_content}X" | mc pipe "staging/$fault_bucket/$key" >/dev/null
  expect_object_failure same_key_wrong_size
  reset_fault_bucket
  printf '%s' "$other_content" | mc pipe "staging/$fault_bucket/$key" >/dev/null
  expect_object_failure same_size_wrong_content
  reset_fault_bucket
  expect_object_failure missing_object
  printf '%s' "$base_content" | mc pipe "staging/$fault_bucket/$key" >/dev/null
  printf '%s' "$base_content" | mc pipe "staging/$fault_bucket/$extra_key" >/dev/null
  expect_object_failure extra_object
  rm -f "$expected"
}

verify_sha256_sidecar "$backup_dir/manifest.json" "$backup_dir/manifest.sha256"
validate_backup_manifest "$backup_dir/manifest.json"
restore_stage_database
restore_stage_bucket
verify_backup_bundle "$backup_dir" "staging/$restore_bucket" "$restore_url"
run_object_fault_injection_tests

table_count="$(psql "$restore_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
audit_count="$(psql "$restore_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT count(*) FROM audit_logs;')"
ledger_count="$(psql "$restore_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT count(*) FROM ledger_events;')"
raw_file_count="$(psql "$restore_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT count(*) FROM raw_files WHERE is_voided=false;')"
if (( table_count < 40 )); then
  integrity_fail 'restore_drill_application_table_count_too_low'
  exit 1
fi

application_read_smoke='database_read_and_empty_bucket_passed'
if (( raw_file_count > 0 )); then
  first_key_base64="$(jq -r '.[0].keyBase64' --slurp "$backup_dir/database-object-refs.jsonl")"
  first_expected_sha="$(jq -r '.[0].sha256' --slurp "$backup_dir/database-object-refs.jsonl")"
  first_key="$(printf '%s' "$first_key_base64" | base64 -d)"
  assert_storage_key "$first_key"
  first_actual_sha="$(mc cat "staging/$restore_bucket/$first_key" | sha256sum | awk '{print $1}')"
  [[ "$first_actual_sha" == "$first_expected_sha" ]] || integrity_fail 'application_read_smoke_hash_mismatch'
  application_read_smoke='database_and_object_read_passed'
fi

migration_fault_manifest="$(mktemp)"
psql "$restore_url" --set=ON_ERROR_STOP=1 --command \
  'DELETE FROM _prisma_migrations WHERE migration_name = (SELECT max(migration_name) FROM _prisma_migrations);' >/dev/null
generate_migration_manifest "$restore_url" "$migration_fault_manifest"
if cmp -s "$backup_dir/database-migrations.jsonl" "$migration_fault_manifest"; then
  rm -f "$migration_fault_manifest"
  integrity_fail 'migration_fault_injection_not_rejected'
  exit 1
fi
rm -f "$migration_fault_manifest"
migration_fault_injection='rejected'

database_reference_fault_injection='not_applicable_empty_dataset'
if (( raw_file_count > 0 )); then
  psql "$restore_url" --set=ON_ERROR_STOP=1 --command \
    "UPDATE raw_files SET sha256=repeat('f', 64) WHERE id=(SELECT id FROM raw_files WHERE is_voided=false ORDER BY id LIMIT 1);" >/dev/null
  if verify_database_object_refs "$restore_url" "$backup_dir/database-object-refs.jsonl" "$backup_dir/object-manifest.jsonl" >/dev/null 2>&1; then
    integrity_fail 'database_reference_fault_injection_not_rejected'
    exit 1
  fi
  database_reference_fault_injection='rejected'
fi

completed_epoch="$(date +%s)"
created_epoch="$(jq -r '.createdEpoch' "$backup_dir/manifest.json")"
rto_seconds="$((completed_epoch - started_epoch))"
rpo_seconds="$((started_epoch - created_epoch))"
object_count="$(jq -r '.objects.count' "$backup_dir/manifest.json")"
object_bytes="$(jq -r '.objects.totalBytes' "$backup_dir/manifest.json")"
manifest_sha256="$(sha256_file "$backup_dir/manifest.json")"
evidence="/backups/drills/restore-${backup_id}-$(date -u +%Y%m%dT%H%M%SZ).json"
jq -n \
  --arg backupId "$backup_id" \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg manifestSha256 "$manifest_sha256" \
  --arg applicationReadSmoke "$application_read_smoke" \
  --arg migrationFaultInjection "$migration_fault_injection" \
  --arg databaseReferenceFaultInjection "$database_reference_fault_injection" \
  --argjson rpoSeconds "$rpo_seconds" --argjson rtoSeconds "$rto_seconds" \
  --argjson tableCount "$table_count" --argjson auditRows "$audit_count" \
  --argjson ledgerRows "$ledger_count" --argjson rawFileRows "$raw_file_count" \
  --argjson objectCount "$object_count" --argjson objectBytes "$object_bytes" \
  '{
    status: "passed",
    scope: "isolated_database_and_temporary_bucket",
    backupId: $backupId,
    completedAt: $completedAt,
    manifestSha256: $manifestSha256,
    rpoSeconds: $rpoSeconds,
    rtoSeconds: $rtoSeconds,
    rpoRtoPolicyStatus: "pending_h14",
    checks: {
      databaseDump: "restored",
      databaseSchema: "matched",
      databaseMigrations: "matched",
      databaseObjectReferences: "matched",
      objectKeysSizesAndStrongHashes: "matched",
      objectFaultInjectionCases: 5,
      migrationFaultInjection: $migrationFaultInjection,
      databaseReferenceFaultInjection: $databaseReferenceFaultInjection,
      strongHashUnverifiedCount: 0,
      applicationReadSmoke: $applicationReadSmoke,
      tableCount: $tableCount,
      auditRows: $auditRows,
      ledgerRows: $ledgerRows,
      rawFileRows: $rawFileRows,
      objectCount: $objectCount,
      objectBytes: $objectBytes
    }
  }' > "$evidence"
cat > "$restore_metrics_file.tmp" <<METRICS
finance_agent_restore_drill_success 1
finance_agent_restore_drill_last_success_timestamp_seconds $completed_epoch
finance_agent_restore_drill_rpo_seconds $rpo_seconds
finance_agent_restore_drill_rto_seconds $rto_seconds
finance_agent_restore_drill_verified_object_count $object_count
finance_agent_restore_drill_unverified_object_count 0
METRICS
mv "$restore_metrics_file.tmp" "$restore_metrics_file"
cat "$evidence"
