#!/bin/sh

set -e

certbot certonly --standalone --cert-name app \
  -d rendezqueue.com,www.rendezqueue.com \
  --agree-tos --no-eff-email -n --email rendezqueue@gmail.com

node main.js --hostname=127.0.0.1 --port=5000 "$@" &

exec nginx -g "daemon off;" &

wait -n
exit $?
