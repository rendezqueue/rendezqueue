#!/bin/sh

set -e

certbot certonly --standalone --cert-name app \
  -d rendezqueue.com,www.rendezqueue.com \
  --agree-tos --no-eff-email -n --email rendezqueue@gmail.com

node /app/server/main.js \
  --http_host=127.0.0.1 --http_port=5000 --http_path=/tryswap \
  "$@" &

exec nginx -g "daemon off;" &

wait -n
exit $?
