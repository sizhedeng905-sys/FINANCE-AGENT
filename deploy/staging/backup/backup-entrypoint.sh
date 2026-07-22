#!/bin/bash
set -Eeuo pipefail

install -d -o postgres -g postgres -m 0700 /backups/logical /backups/base /backups/drills /backups/failed /backups/restore-authorizations /backups/restore-compensation
install -d -o postgres -g postgres -m 0700 /tmp/backup-home /tmp/backup-home/.mc
install -d -o postgres -g postgres -m 0750 /metrics
exec runuser -u postgres -- /opt/staging/backup-loop.sh
