#!/bin/sh
set -eu
umask 077

if [ "$#" -eq 0 ]; then
  set -- node server.js
fi
if [ "$1" = "node" ] && [ "${2:-}" = "server.js" ]; then
  mkdir -p /data/cache /data/tmp
  node /app/docker/preflight.mjs
fi
exec "$@"
