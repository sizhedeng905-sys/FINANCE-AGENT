#!/bin/bash
set -Eeuo pipefail

source /opt/staging/integrity-lib.sh
require_integrity_tools

if [[ "$(id -u)" != '999' ]]; then
  integrity_fail 'backup_must_run_as_postgres_uid_999'
  exit 1
fi

lock_file="${BACKUP_LOCK_FILE:-/backups/logical/.backup.lock}"
exec 9> "$lock_file"
if ! flock -w 1200 9; then
  integrity_fail 'backup_lock_timeout'
  exit 1
fi

required_after_epoch="${BACKUP_REQUIRED_AFTER_EPOCH:-}"
if [[ -n "$required_after_epoch" ]]; then
  if [[ ! "$required_after_epoch" =~ ^[0-9]+$ ]]; then
    integrity_fail 'backup_required_after_epoch_invalid'
    exit 1
  fi
  latest_complete="$(find /backups/logical -mindepth 2 -maxdepth 2 -name complete -print | sort | tail -1)"
  if [[ -n "$latest_complete" ]]; then
    latest_manifest="$(dirname "$latest_complete")/manifest.json"
    latest_created_epoch="$(jq -r '.createdEpoch // empty' "$latest_manifest" 2>/dev/null || true)"
    if [[ "$latest_created_epoch" =~ ^[0-9]+$ ]] && (( latest_created_epoch >= required_after_epoch )); then
      echo 'A complete post-deploy backup already satisfies the release gate'
      exit 0
    fi
  fi
fi

started_epoch="$(date +%s)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
assert_backup_id "$timestamp"
metrics_file="${BACKUP_METRICS_FILE:-/metrics/finance_agent_backup.prom}"
logical_dir="/backups/logical/$timestamp"
failed_dir="/backups/failed/$timestamp"
base_dir="/backups/base/$timestamp"
remote_snapshot="staging/finance-agent-backups/raw/$timestamp"
minio_configured=false
remote_snapshot_started=false
backup_completed=false

record_failure() {
  set +e
  local failed_epoch temporary last_success
  failed_epoch="$(date +%s)"
  temporary="$metrics_file.tmp"
  last_success="$(sed -n 's/^finance_agent_backup_last_success_timestamp_seconds //p' "$metrics_file" 2>/dev/null | tail -1)"
  {
    echo 'finance_agent_backup_success 0'
    echo "finance_agent_backup_last_failure_timestamp_seconds $failed_epoch"
    if [[ "$last_success" =~ ^[0-9]+$ ]]; then
      echo "finance_agent_backup_last_success_timestamp_seconds $last_success"
    fi
  } > "$temporary"
  mv "$temporary" "$metrics_file"
}

cleanup_failed_backup() {
  set +e
  if [[ "$remote_snapshot_started" == true && "$minio_configured" == true ]]; then
    mc rm --recursive --force --dangerous "$remote_snapshot" >/dev/null 2>&1 || true
  fi
  if [[ -d "$logical_dir" ]]; then
    mkdir -p /backups/failed
    rm -f "$logical_dir/complete"
    mv "$logical_dir" "$failed_dir" 2>/dev/null || true
  fi
}

record_exit() {
  local status="$?"
  trap - EXIT
  if (( status != 0 )) || [[ "$backup_completed" != true ]]; then
    cleanup_failed_backup
    record_failure
    if (( status == 0 )); then
      status=1
    fi
    exit "$status"
  fi
}
trap record_exit EXIT

backup_url="$(cat "${BACKUP_DATABASE_URL_FILE:?}")"
database_name="$(psql "$backup_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$database_name" != 'finance_agent_staging' ]]; then
  integrity_fail 'backup_source_database_must_be_finance_agent_staging'
  exit 1
fi
environment_label="${BACKUP_SOURCE_ENVIRONMENT_ID:?BACKUP_SOURCE_ENVIRONMENT_ID is required}"
anonymous_environment_id="$(printf '%s' "$environment_label" | sha256sum | awk '{print $1}')"
database_name_hash="$(printf '%s' "$database_name" | sha256sum | awk '{print $1}')"

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null
minio_configured=true

mkdir -p "$logical_dir"
generate_database_object_refs "$backup_url" "$logical_dir/database-object-refs.before.jsonl"
generate_migration_manifest "$backup_url" "$logical_dir/database-migrations.jsonl"
generate_schema_snapshot "$backup_url" "$logical_dir/database-schema.sql"

pg_dump "$backup_url" --format=custom --compress=6 --no-owner --no-acl --file "$logical_dir/database.dump"
if [[ ! -s "$logical_dir/database.dump" ]]; then
  integrity_fail 'database_dump_empty'
  exit 1
fi
pg_restore --list "$logical_dir/database.dump" >/dev/null
generate_database_object_refs "$backup_url" "$logical_dir/database-object-refs.after-dump.jsonl"
if ! cmp -s "$logical_dir/database-object-refs.before.jsonl" "$logical_dir/database-object-refs.after-dump.jsonl"; then
  integrity_fail 'database_object_refs_changed_during_dump'
  exit 1
fi

generate_object_manifest staging/finance-agent-raw "$logical_dir/source-object-manifest.jsonl"
object_count="$(jq -s 'length' "$logical_dir/source-object-manifest.jsonl")"
object_verification_root="$remote_snapshot"
if (( object_count > 0 )); then
  remote_snapshot_started=true
  mc mirror --overwrite staging/finance-agent-raw "$remote_snapshot" >/dev/null
  generate_object_manifest "$remote_snapshot" "$logical_dir/object-manifest.jsonl"
  compare_object_manifests "$logical_dir/source-object-manifest.jsonl" "$logical_dir/object-manifest.jsonl"
else
  : > "$logical_dir/object-manifest.jsonl"
  object_verification_root='staging/finance-agent-raw'
fi
verify_database_object_refs_file "$logical_dir/database-object-refs.before.jsonl" "$logical_dir/object-manifest.jsonl"

generate_database_object_refs "$backup_url" "$logical_dir/database-object-refs.after-objects.jsonl"
if ! cmp -s "$logical_dir/database-object-refs.before.jsonl" "$logical_dir/database-object-refs.after-objects.jsonl"; then
  integrity_fail 'database_object_refs_changed_during_object_snapshot'
  exit 1
fi
mv "$logical_dir/database-object-refs.before.jsonl" "$logical_dir/database-object-refs.jsonl"
rm -f "$logical_dir/database-object-refs.after-dump.jsonl" "$logical_dir/database-object-refs.after-objects.jsonl"

generate_migration_manifest "$backup_url" "$logical_dir/database-migrations.after.jsonl"
generate_schema_snapshot "$backup_url" "$logical_dir/database-schema.after.sql"
if ! cmp -s "$logical_dir/database-migrations.jsonl" "$logical_dir/database-migrations.after.jsonl"; then
  integrity_fail 'database_migrations_changed_during_backup'
  exit 1
fi
if ! cmp -s "$logical_dir/database-schema.sql" "$logical_dir/database-schema.after.sql"; then
  integrity_fail 'database_schema_changed_during_backup'
  exit 1
fi
rm -f "$logical_dir/database-migrations.after.jsonl" "$logical_dir/database-schema.after.sql"

dump_sha256="$(sha256_file "$logical_dir/database.dump")"
dump_bytes="$(file_bytes "$logical_dir/database.dump")"
schema_sha256="$(sha256_file "$logical_dir/database-schema.sql")"
schema_bytes="$(file_bytes "$logical_dir/database-schema.sql")"
migrations_sha256="$(sha256_file "$logical_dir/database-migrations.jsonl")"
migrations_bytes="$(file_bytes "$logical_dir/database-migrations.jsonl")"
migration_count="$(jq -s 'length' "$logical_dir/database-migrations.jsonl")"
refs_sha256="$(sha256_file "$logical_dir/database-object-refs.jsonl")"
refs_bytes="$(file_bytes "$logical_dir/database-object-refs.jsonl")"
active_ref_count="$(jq -s 'length' "$logical_dir/database-object-refs.jsonl")"
distinct_ref_count="$(jq -s 'map(.keyBase64) | unique | length' "$logical_dir/database-object-refs.jsonl")"
active_ref_bytes="$(jq -s 'map(.sizeBytes) | add // 0' "$logical_dir/database-object-refs.jsonl")"
voided_ref_count="$(psql "$backup_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT count(*) FROM raw_files WHERE is_voided=true;')"
source_manifest_sha256="$(sha256_file "$logical_dir/source-object-manifest.jsonl")"
source_manifest_bytes="$(file_bytes "$logical_dir/source-object-manifest.jsonl")"
object_manifest_sha256="$(sha256_file "$logical_dir/object-manifest.jsonl")"
object_manifest_bytes="$(file_bytes "$logical_dir/object-manifest.jsonl")"
object_total_bytes="$(jq -s 'map(.sizeBytes) | add // 0' "$logical_dir/object-manifest.jsonl")"
metadata_digest_matched_count="$(jq -s 'map(select(.declaredSha256Status == "matched")) | length' "$logical_dir/object-manifest.jsonl")"
metadata_digest_missing_count="$(jq -s 'map(select(.declaredSha256Status == "missing")) | length' "$logical_dir/object-manifest.jsonl")"
metadata_digest_mismatch_count="$(jq -s 'map(select(.declaredSha256Status == "mismatch")) | length' "$logical_dir/object-manifest.jsonl")"
unreferenced_object_count="$(jq -s --slurpfile refs "$logical_dir/database-object-refs.jsonl" '
  ($refs | map(.keyBase64) | unique) as $referenced |
  [ .[] | select(.keyBase64 as $key | ($referenced | index($key) | not)) ] | length
' "$logical_dir/object-manifest.jsonl")"

jq -cnS \
  --arg schemaVersion "$BACKUP_MANIFEST_SCHEMA" \
  --arg toolVersion "$BACKUP_TOOL_VERSION" \
  --arg backupId "$timestamp" \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson createdEpoch "$started_epoch" \
  --arg anonymousEnvironmentId "$anonymous_environment_id" \
  --arg databaseNameHash "$database_name_hash" \
  --arg dumpSha "$dump_sha256" --argjson dumpBytes "$dump_bytes" \
  --arg schemaSha "$schema_sha256" --argjson schemaBytes "$schema_bytes" \
  --arg migrationsSha "$migrations_sha256" --argjson migrationsBytes "$migrations_bytes" --argjson migrationCount "$migration_count" \
  --arg refsSha "$refs_sha256" --argjson refsBytes "$refs_bytes" --argjson activeRefCount "$active_ref_count" \
  --argjson distinctRefCount "$distinct_ref_count" --argjson activeRefBytes "$active_ref_bytes" --argjson voidedRefCount "$voided_ref_count" \
  --arg sourceManifestSha "$source_manifest_sha256" --argjson sourceManifestBytes "$source_manifest_bytes" \
  --arg objectManifestSha "$object_manifest_sha256" --argjson objectManifestBytes "$object_manifest_bytes" \
  --argjson objectCount "$object_count" --argjson objectTotalBytes "$object_total_bytes" \
  --argjson metadataDigestMatchedCount "$metadata_digest_matched_count" \
  --argjson metadataDigestMissingCount "$metadata_digest_missing_count" \
  --argjson metadataDigestMismatchCount "$metadata_digest_mismatch_count" \
  --argjson unreferencedObjectCount "$unreferenced_object_count" \
  '{
    schemaVersion: $schemaVersion,
    toolVersion: $toolVersion,
    backupId: $backupId,
    createdAt: $createdAt,
    createdEpoch: $createdEpoch,
    anonymousEnvironmentId: $anonymousEnvironmentId,
    source: {
      databaseNameHash: $databaseNameHash,
      objectBucket: "finance-agent-raw"
    },
    database: {
      dump: {path: "database.dump", format: "pg_dump_custom", sha256: $dumpSha, bytes: $dumpBytes},
      schema: {path: "database-schema.sql", sha256: $schemaSha, bytes: $schemaBytes},
      migrations: {path: "database-migrations.jsonl", sha256: $migrationsSha, bytes: $migrationsBytes, count: $migrationCount},
      objectReferences: {
        path: "database-object-refs.jsonl",
        sha256: $refsSha,
        bytes: $refsBytes,
        activeCount: $activeRefCount,
        distinctObjectCount: $distinctRefCount,
        activeBytes: $activeRefBytes,
        voidedCount: $voidedRefCount
      }
    },
    sourceObjects: {
      path: "source-object-manifest.jsonl",
      sha256: $sourceManifestSha,
      bytes: $sourceManifestBytes
    },
    objects: {
      path: "object-manifest.jsonl",
      manifestPath: "object-manifest.jsonl",
      bucket: "finance-agent-raw",
      snapshotPrefix: ("raw/" + $backupId),
      sha256: $objectManifestSha,
      bytes: $objectManifestBytes,
      count: $objectCount,
      totalBytes: $objectTotalBytes,
      unreferencedObjectCount: $unreferencedObjectCount,
      strongHashAlgorithm: "sha256",
      strongHashVerifiedCount: $objectCount,
      strongHashUnverifiedCount: 0,
      metadataDigestMatchedCount: $metadataDigestMatchedCount,
      metadataDigestMissingCount: $metadataDigestMissingCount,
      metadataDigestMismatchCount: $metadataDigestMismatchCount,
      etagIsStrongHash: false
    },
    integrity: {
      manifestSidecar: "manifest.sha256",
      canonicalization: "jq-sort-keys-compact-v1"
    },
    storagePolicy: {
      encryption: "pending_h14",
      immutability: "pending_h14",
      offsiteReplication: "pending_h13_h14",
      retention: "pending_h14"
    }
  }' > "$logical_dir/manifest.json"
write_sha256_sidecar "$logical_dir/manifest.json" "$logical_dir/manifest.sha256"
verify_backup_bundle "$logical_dir" "$object_verification_root"

for artifact in \
  database.dump database-schema.sql database-migrations.jsonl database-object-refs.jsonl \
  source-object-manifest.jsonl object-manifest.jsonl manifest.json manifest.sha256; do
  mc cp "$logical_dir/$artifact" "staging/finance-agent-backups/logical/$timestamp/$artifact" >/dev/null
done
touch "$logical_dir/complete"
mc cp "$logical_dir/complete" "staging/finance-agent-backups/logical/$timestamp/complete" >/dev/null

latest_base_epoch="$(find /backups/base -mindepth 2 -maxdepth 2 -name complete -printf '%T@\n' 2>/dev/null | sort -nr | head -1 | cut -d. -f1)"
latest_base_epoch="${latest_base_epoch:-0}"
if (( started_epoch - latest_base_epoch >= 86400 )); then
  mkdir -p "$base_dir"
  pg_basebackup --dbname="$backup_url" --pgdata="$base_dir" --format=tar --gzip --wal-method=stream --checkpoint=fast
  touch "$base_dir/complete"
  for archive in "$base_dir"/*.tar.gz; do
    mc cp "$archive" "staging/finance-agent-backups/base/$timestamp/$(basename "$archive")" >/dev/null
  done
fi

completed_epoch="$(date +%s)"
duration="$((completed_epoch - started_epoch))"
temporary="$metrics_file.tmp"
cat > "$temporary" <<METRICS
finance_agent_backup_success 1
finance_agent_backup_last_success_timestamp_seconds $completed_epoch
finance_agent_backup_duration_seconds $duration
finance_agent_backup_database_bytes $dump_bytes
finance_agent_backup_object_count $object_count
finance_agent_backup_object_bytes $object_total_bytes
finance_agent_backup_object_strong_hash_verified_count $object_count
finance_agent_backup_object_strong_hash_unverified_count 0
finance_agent_backup_object_metadata_digest_matched_count $metadata_digest_matched_count
finance_agent_backup_object_metadata_digest_missing_count $metadata_digest_missing_count
finance_agent_backup_object_metadata_digest_mismatch_count $metadata_digest_mismatch_count
METRICS
mv "$temporary" "$metrics_file"
backup_completed=true
trap - EXIT
echo "Backup $timestamp completed in ${duration}s with $object_count strongly verified objects"
