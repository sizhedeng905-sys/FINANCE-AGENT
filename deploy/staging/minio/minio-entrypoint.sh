#!/bin/sh
set -eu

read_secret() {
  target_name="$1"
  file_name="$2"
  if [ -z "$file_name" ] || [ ! -f "$file_name" ] || [ ! -r "$file_name" ]; then
    printf '%s\n' "required MinIO secret file is unavailable" >&2
    exit 1
  fi
  value="$(cat "$file_name")"
  if [ -z "$value" ] || printf '%s' "$value" | grep -q '[[:cntrl:]]'; then
    printf '%s\n' "required MinIO secret is empty or contains control characters" >&2
    exit 1
  fi
  export "$target_name=$value"
  unset value
}

read_secret MINIO_ROOT_USER "${MINIO_ROOT_USER_FILE:-}"
read_secret MINIO_ROOT_PASSWORD "${MINIO_ROOT_PASSWORD_FILE:-}"
unset MINIO_ROOT_USER_FILE MINIO_ROOT_PASSWORD_FILE

exec /usr/local/bin/minio "$@"
