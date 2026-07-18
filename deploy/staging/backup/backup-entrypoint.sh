#!/bin/bash
set -Eeuo pipefail

install -d -o postgres -g postgres -m 0700 /backups/logical /backups/base /backups/drills /backups/failed /backups/restore-authorizations /backups/restore-compensation
install -d -o postgres -g postgres -m 0750 /metrics
exec gosu postgres /opt/staging/backup-loop.sh
