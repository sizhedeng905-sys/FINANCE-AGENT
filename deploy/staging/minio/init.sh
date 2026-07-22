#!/bin/sh
set -eu

root_user="$(cat /run/secrets/minio_root_user)"
root_password="$(cat /run/secrets/minio_root_password)"
runtime_user="$(cat /run/secrets/s3_access_key_id)"
runtime_password="$(cat /run/secrets/s3_secret_access_key)"

if ! mc alias set staging http://minio:9000 "$root_user" "$root_password" >/dev/null 2>&1; then
  echo 'minio_init_alias_failed' >&2
  exit 1
fi
mc mb --ignore-existing staging/finance-agent-raw
mc mb --ignore-existing staging/finance-agent-backups
mc anonymous set none staging/finance-agent-raw
mc anonymous set none staging/finance-agent-backups
mc version enable staging/finance-agent-raw
mc version enable staging/finance-agent-backups
mc ilm rule add --abort-incomplete-upload-days 7 staging/finance-agent-raw >/dev/null 2>&1 || true
mc ilm rule add --abort-incomplete-upload-days 7 staging/finance-agent-backups >/dev/null 2>&1 || true

if ! mc admin user add staging "$runtime_user" "$runtime_password" >/dev/null 2>&1; then
  if ! mc admin user enable staging "$runtime_user" >/dev/null 2>&1; then
    echo 'minio_init_runtime_user_failed' >&2
    exit 1
  fi
fi
mc admin policy create staging finance-agent-runtime /opt/staging/runtime-policy.json >/dev/null 2>&1 \
  || mc admin policy info staging finance-agent-runtime >/dev/null
if ! mc admin policy attach staging finance-agent-runtime --user "$runtime_user" >/dev/null 2>&1; then
  echo 'minio_init_policy_attach_failed' >&2
  exit 1
fi

mc stat staging/finance-agent-raw >/dev/null
mc stat staging/finance-agent-backups >/dev/null
