#!/bin/sh

set -e

backend_url="http://127.0.0.1:5480/"
if [ -n "$1" ]; then
  backend_url="$1"
fi

tryswap() {
  curl -i -X POST -H 'Content-Type: application/json' -d "$1" "$backend_url"
  printf "\n\n\n"
}

# These strings are all base64.
tryswap '{"key":"aw==","id":"QWxpY2U=","ttl":5,"values":["YWE="]}'
tryswap '{"key":"aw==","id":"QWxpY2U=","ttl":5,"offset":1}'
tryswap '{"key":"aw==","id":"Qm9i","ttl":5,"values":["YmJiYg=="]}'
tryswap '{"key":"aw==","id":"QWxpY2U=","ttl":5,"offset":1}'
