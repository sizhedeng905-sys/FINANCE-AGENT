#!/bin/bash
set -Eeuo pipefail

backup_id="${1:-}"
if [[ ! "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Usage: restore-backup.sh <YYYYMMDDTHHMMSSZ>" >&2
  exit 1
fi
if [[ "${CONFIRM_DATABASE_RESTORE:-}" != "finance_agent_staging/$backup_id" ]]; then
  echo "Set CONFIRM_DATABASE_RESTORE=finance_agent_staging/$backup_id to authorize this destructive restore" >&2
  exit 1
fi
if [[ "${ALLOW_STAGING_RESTORE:-}" != "true" ]]; then
  echo "Set ALLOW_STAGING_RESTORE=true only after an approved Staging restore incident" >&2
  exit 1
fi

migration_url="$(cat "${MIGRATION_DATABASE_URL_FILE:?}")"
database_name="$(psql "$migration_url" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
if [[ "$database_name" != "finance_agent_staging" ]]; then
  echo "Restore target must be exactly finance_agent_staging" >&2
  exit 1
fi
backup_dir="/backups/logical/$backup_id"
manifest="$backup_dir/manifest.json"
dump_file="$backup_dir/database.dump"
if [[ ! -f "$manifest" || ! -s "$dump_file" ]]; then
  echo "Requested backup is not available locally" >&2
  exit 1
fi
expected_sha="$(sed -n 's/.*"sha256": "\([a-f0-9]*\)".*/\1/p' "$manifest" | head -1)"
actual_sha="$(sha256sum "$dump_file" | awk '{print $1}')"
expected_bytes="$(sed -n 's/.*"bytes": \([0-9]*\).*/\1/p' "$manifest" | head -1)"
actual_bytes="$(stat -c %s "$dump_file")"
if [[ -z "$expected_sha" || "$expected_sha" != "$actual_sha" || ! "$expected_bytes" =~ ^[1-9][0-9]*$ || "$expected_bytes" != "$actual_bytes" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 1
fi
pg_restore --list "$dump_file" >/dev/null

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
mc alias set staging "${MINIO_ENDPOINT:?}" "$root_user" "$root_password" >/dev/null
expected_object_count="$(sed -n 's/.*"count": \([0-9]*\).*/\1/p' "$manifest" | head -1)"
if [[ ! "$expected_object_count" =~ ^[0-9]+$ ]]; then
  echo "Backup object count is invalid" >&2
  exit 1
fi
if (( expected_object_count > 0 )); then
  mc stat "staging/finance-agent-backups/raw/$backup_id" >/dev/null
  object_backup_count="$(mc find "staging/finance-agent-backups/raw/$backup_id" --json | wc -l | tr -d ' ')"
else
  object_backup_count=0
fi
if [[ "$object_backup_count" != "$expected_object_count" ]]; then
  echo "Object backup count mismatch: expected=$expected_object_count actual=$object_backup_count" >&2
  exit 1
fi

pg_restore --dbname="$migration_url" --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction "$dump_file"
if (( expected_object_count > 0 )); then
  mc mirror --overwrite --remove "staging/finance-agent-backups/raw/$backup_id" staging/finance-agent-raw >/dev/null
else
  empty_dir="$(mktemp -d)"
  trap 'rm -rf "$empty_dir"' EXIT
  mc mirror --overwrite --remove "$empty_dir" staging/finance-agent-raw >/dev/null
fi
psql "$migration_url" --set=ON_ERROR_STOP=1 --command \
  "INSERT INTO audit_logs (id, action, resource_type, metadata, created_at) VALUES ('restore-$backup_id', 'staging.backup_restored', 'database', jsonb_build_object('backupId', '$backup_id'), now()) ON CONFLICT (id) DO NOTHING;"
echo "Staging database and raw object bucket restored from $backup_id"
