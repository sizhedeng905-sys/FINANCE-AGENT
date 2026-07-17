#!/bin/bash
set -Eeuo pipefail

migration_password="$(cat /run/secrets/migration_password)"
runtime_password="$(cat /run/secrets/runtime_password)"
backup_password="$(cat /run/secrets/backup_password)"

for value in "$migration_password" "$runtime_password" "$backup_password"; do
  if [[ ! "$value" =~ ^[a-f0-9]{64,128}$ ]]; then
    echo "Staging database secrets must be lowercase hexadecimal" >&2
    exit 1
  fi
done

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE finance_migrator LOGIN PASSWORD '$migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE finance_runtime LOGIN PASSWORD '$runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE finance_backup LOGIN REPLICATION PASSWORD '$backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
CREATE DATABASE finance_agent_staging OWNER finance_migrator;
REVOKE ALL ON DATABASE finance_agent_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE finance_agent_staging TO finance_migrator, finance_runtime, finance_backup;
GRANT pg_read_all_data TO finance_backup;
SQL

cat >> "$PGDATA/pg_hba.conf" <<'HBA'
hostssl finance_agent_staging finance_migrator all scram-sha-256
hostssl finance_agent_staging finance_runtime all scram-sha-256
hostssl finance_agent_staging finance_backup all scram-sha-256
hostssl replication finance_backup all scram-sha-256
HBA
