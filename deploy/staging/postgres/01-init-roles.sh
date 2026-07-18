#!/bin/bash
set -Eeuo pipefail

migration_password="$(cat /run/secrets/migration_password)"
runtime_password="$(cat /run/secrets/runtime_password)"
backup_password="$(cat /run/secrets/backup_password)"
restore_password="$(cat /run/secrets/restore_password)"

for value in "$migration_password" "$runtime_password" "$backup_password" "$restore_password"; do
  if [[ ! "$value" =~ ^[a-f0-9]{64,128}$ ]]; then
    echo "Staging database secrets must be lowercase hexadecimal" >&2
    exit 1
  fi
done

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE finance_migrator LOGIN PASSWORD '$migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE finance_runtime LOGIN PASSWORD '$runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE finance_backup LOGIN REPLICATION PASSWORD '$backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
CREATE ROLE finance_restore LOGIN PASSWORD '$restore_password' NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE finance_agent_staging OWNER finance_migrator;
REVOKE ALL ON DATABASE finance_agent_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE finance_agent_staging TO finance_migrator, finance_runtime, finance_backup;
GRANT pg_read_all_data TO finance_backup;
SQL

# The upstream entrypoint adds broad host rules. Staging permits remote database
# traffic only through the explicit TLS role rules below.
sed -i -E '/^[[:space:]]*host[[:space:]]/d' "$PGDATA/pg_hba.conf"
cat >> "$PGDATA/pg_hba.conf" <<'HBA'
hostnossl all all all reject
hostssl finance_agent_staging finance_migrator all scram-sha-256
hostssl finance_agent_staging finance_runtime all scram-sha-256
hostssl finance_agent_staging finance_backup all scram-sha-256
hostssl replication finance_backup all scram-sha-256
hostssl all finance_restore all scram-sha-256
HBA
