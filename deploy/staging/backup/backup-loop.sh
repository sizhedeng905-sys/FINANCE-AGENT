#!/bin/bash
set -Eeuo pipefail

interval="${BACKUP_INTERVAL_SECONDS:-21600}"
if [[ ! "$interval" =~ ^[0-9]+$ ]] || (( interval < 300 )); then
  echo "BACKUP_INTERVAL_SECONDS must be at least 300" >&2
  exit 1
fi

while true; do
  /opt/staging/run-backup.sh || true
  sleep "$interval" &
  wait $!
done
