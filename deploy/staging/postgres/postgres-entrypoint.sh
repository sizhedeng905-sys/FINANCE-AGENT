#!/bin/bash
set -Eeuo pipefail

install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/tls /backups/wal /backups/base /backups/logical
install -o postgres -g postgres -m 0644 /run/secrets/staging_ca_cert /var/lib/postgresql/tls/ca.crt
install -o postgres -g postgres -m 0644 /run/secrets/postgres_tls_cert /var/lib/postgresql/tls/server.crt
install -o postgres -g postgres -m 0600 /run/secrets/postgres_tls_key /var/lib/postgresql/tls/server.key
chown -R postgres:postgres /backups

exec /usr/local/bin/docker-entrypoint.sh "$@"
