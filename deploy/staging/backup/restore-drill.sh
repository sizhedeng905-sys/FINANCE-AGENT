#!/bin/bash
set -Eeuo pipefail

started_epoch="$(date +%s)"
migration_url="$(cat "${MIGRATION_DATABASE_URL_FILE:?}")"
database_name="$(psql "$migration_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$database_name" != "finance_agent_staging" ]]; then
  echo "Restore drill source must be exactly finance_agent_staging" >&2
  exit 1
fi
latest_manifest="$(find /backups/logical -mindepth 2 -maxdepth 2 -name manifest.json -print | sort | tail -1)"
if [[ -z "$latest_manifest" ]]; then
  echo "No logical backup is available for restore drill" >&2
  exit 1
fi
backup_dir="$(dirname "$latest_manifest")"
dump_file="$backup_dir/database.dump"
if [[ ! -s "$dump_file" ]]; then
  echo "Database dump is empty" >&2
  exit 1
fi
expected_sha="$(sed -n 's/.*"sha256": "\([a-f0-9]*\)".*/\1/p' "$latest_manifest" | head -1)"
actual_sha="$(sha256sum "$dump_file" | awk '{print $1}')"
expected_bytes="$(sed -n 's/.*"bytes": \([0-9]*\).*/\1/p' "$latest_manifest" | head -1)"
actual_bytes="$(stat -c %s "$dump_file")"
if [[ -z "$expected_sha" || "$expected_sha" != "$actual_sha" || ! "$expected_bytes" =~ ^[1-9][0-9]*$ || "$expected_bytes" != "$actual_bytes" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 1
fi
pg_restore --list "$dump_file" >/dev/null

postgres_url="${migration_url/\/finance_agent_staging?/\/postgres?}"
restore_url="${migration_url/\/finance_agent_staging?/\/finance_agent_restore_drill_test?}"
if [[ "$postgres_url" == "$migration_url" || "$restore_url" == "$migration_url" ]]; then
  echo "Migration database URL does not contain the expected Staging database name" >&2
  exit 1
fi
dropdb --if-exists --force --maintenance-db="$postgres_url" finance_agent_restore_drill_test
createdb --maintenance-db="$postgres_url" --owner=finance_migrator finance_agent_restore_drill_test
cleanup() {
  dropdb --if-exists --force --maintenance-db="$postgres_url" finance_agent_restore_drill_test >/dev/null 2>&1 || true
}
trap cleanup EXIT

pg_restore --dbname="$restore_url" --no-owner --no-acl --exit-on-error --single-transaction "$dump_file"
table_count="$(psql "$restore_url" --tuples-only --no-align --command \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
audit_count="$(psql "$restore_url" --tuples-only --no-align --command 'SELECT count(*) FROM audit_logs;')"
ledger_count="$(psql "$restore_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger_events;')"
raw_file_count="$(psql "$restore_url" --tuples-only --no-align --command 'SELECT count(*) FROM raw_files WHERE is_voided=false;')"
if (( table_count < 40 )); then
  echo "Restore drill found too few application tables: $table_count" >&2
  exit 1
fi

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null
backup_id="$(basename "$backup_dir")"
expected_object_count="$(sed -n 's/.*"count": \([0-9]*\).*/\1/p' "$latest_manifest" | head -1)"
if [[ ! "$expected_object_count" =~ ^[0-9]+$ ]]; then
  echo "Backup object count is invalid" >&2
  exit 1
fi
if (( expected_object_count > 0 )); then
  object_backup_count="$(mc find "staging/finance-agent-backups/raw/$backup_id" --json | wc -l | tr -d ' ')"
else
  object_backup_count=0
fi
if [[ "$object_backup_count" != "$expected_object_count" ]]; then
  echo "Object backup count mismatch: expected=$expected_object_count actual=$object_backup_count" >&2
  exit 1
fi

completed_epoch="$(date +%s)"
created_epoch="$(sed -n 's/.*"createdEpoch": \([0-9]*\).*/\1/p' "$latest_manifest")"
rto_seconds="$((completed_epoch - started_epoch))"
rpo_seconds="$((started_epoch - created_epoch))"
evidence="/backups/drills/restore-${backup_id}-$(date -u +%Y%m%dT%H%M%SZ).json"
cat > "$evidence" <<JSON
{
  "status": "passed",
  "backupId": "$backup_id",
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "rpoSeconds": $rpo_seconds,
  "rtoSeconds": $rto_seconds,
  "checks": {
    "databaseSha256": "matched",
    "tableCount": $table_count,
    "auditRows": $audit_count,
    "ledgerRows": $ledger_count,
    "rawFileRows": $raw_file_count,
    "objectBackupCount": $object_backup_count
  }
}
JSON
restore_metrics_file="${RESTORE_METRICS_FILE:-/metrics/finance_agent_restore.prom}"
cat > "$restore_metrics_file.tmp" <<METRICS
finance_agent_restore_drill_success 1
finance_agent_restore_drill_last_success_timestamp_seconds $completed_epoch
finance_agent_restore_drill_rpo_seconds $rpo_seconds
finance_agent_restore_drill_rto_seconds $rto_seconds
METRICS
mv "$restore_metrics_file.tmp" "$restore_metrics_file"
cat "$evidence"
