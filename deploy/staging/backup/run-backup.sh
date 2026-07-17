#!/bin/bash
set -Eeuo pipefail

started_epoch="$(date +%s)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
metrics_file="${BACKUP_METRICS_FILE:-/metrics/finance_agent_backup.prom}"

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
record_exit() {
  local status="$?"
  trap - EXIT
  if (( status != 0 )); then
    record_failure
  fi
  exit "$status"
}
trap record_exit EXIT

backup_url="$(cat "${BACKUP_DATABASE_URL_FILE:?}")"
root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
logical_dir="/backups/logical/$timestamp"
base_dir="/backups/base/$timestamp"
mkdir -p "$logical_dir"

mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null
pg_dump "$backup_url" --format=custom --compress=6 --no-owner --no-acl --file "$logical_dir/database.dump"
if [[ ! -s "$logical_dir/database.dump" ]]; then
  echo "Database dump is empty" >&2
  exit 1
fi
pg_restore --list "$logical_dir/database.dump" >/dev/null
psql "$backup_url" --tuples-only --no-align --command \
  "SELECT COALESCE(MAX(finished_at)::text, 'none') FROM _prisma_migrations WHERE rolled_back_at IS NULL;" \
  > "$logical_dir/latest_migration.txt"
mc find staging/finance-agent-raw --json > "$logical_dir/object-inventory.jsonl"
mc mirror --overwrite staging/finance-agent-raw "staging/finance-agent-backups/raw/$timestamp" >/dev/null

dump_sha256="$(sha256sum "$logical_dir/database.dump" | awk '{print $1}')"
inventory_sha256="$(sha256sum "$logical_dir/object-inventory.jsonl" | awk '{print $1}')"
database_bytes="$(stat -c %s "$logical_dir/database.dump")"
object_count="$(wc -l < "$logical_dir/object-inventory.jsonl" | tr -d ' ')"
cat > "$logical_dir/manifest.json" <<JSON
{
  "backupId": "$timestamp",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "createdEpoch": $started_epoch,
  "database": {
    "format": "pg_dump_custom",
    "sha256": "$dump_sha256",
    "bytes": $database_bytes
  },
  "objects": {
    "bucket": "finance-agent-raw",
    "snapshotPrefix": "raw/$timestamp",
    "count": $object_count,
    "inventorySha256": "$inventory_sha256"
  }
}
JSON

mc cp "$logical_dir/database.dump" "staging/finance-agent-backups/logical/$timestamp/database.dump" >/dev/null
mc cp "$logical_dir/latest_migration.txt" "staging/finance-agent-backups/logical/$timestamp/latest_migration.txt" >/dev/null
mc cp "$logical_dir/object-inventory.jsonl" "staging/finance-agent-backups/logical/$timestamp/object-inventory.jsonl" >/dev/null
mc cp "$logical_dir/manifest.json" "staging/finance-agent-backups/logical/$timestamp/manifest.json" >/dev/null

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
finance_agent_backup_database_bytes $database_bytes
finance_agent_backup_object_count $object_count
METRICS
mv "$temporary" "$metrics_file"
trap - EXIT
echo "Backup $timestamp completed in ${duration}s"
