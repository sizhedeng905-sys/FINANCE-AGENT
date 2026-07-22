#!/bin/bash
set -Eeuo pipefail

restore_password="$(cat /run/secrets/restore_password)"
if [[ ! "$restore_password" =~ ^[a-f0-9]{64,128}$ ]]; then
  echo 'Restore role secret must be lowercase hexadecimal' >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_restore') THEN
    CREATE ROLE finance_restore LOGIN PASSWORD '$restore_password' NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE finance_restore LOGIN PASSWORD '$restore_password' NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
\$\$;
SQL
