#!/bin/sh
set -eu

password="$(cat /run/secrets/redis_password)"
case "$password" in
  *[!a-f0-9]*|'')
    echo "Redis secret must be lowercase hexadecimal" >&2
    exit 1
    ;;
esac

exec redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --save 900 1 \
  --save 300 10 \
  --protected-mode yes \
  --requirepass "$password"
