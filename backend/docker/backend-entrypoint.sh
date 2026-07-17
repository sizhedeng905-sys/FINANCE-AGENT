#!/bin/sh
set -eu

load_secret() {
  name="$1"
  eval "file=\${${name}_FILE:-}"
  if [ -n "$file" ]; then
    if [ ! -r "$file" ]; then
      echo "Required secret file for $name is not readable" >&2
      exit 1
    fi
    value="$(cat "$file")"
    if [ -z "$value" ]; then
      echo "Required secret file for $name is empty" >&2
      exit 1
    fi
    export "$name=$value"
  fi
}

for secret_name in \
  DATABASE_URL JWT_SECRET REDIS_URL S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY \
  METRICS_TOKEN AI_API_KEY OCR_API_KEY MODEL_API_KEY
do
  load_secret "$secret_name"
done

exec "$@"
