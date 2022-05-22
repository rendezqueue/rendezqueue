#!/bin/sh

tryswap() {
  backend_url="http://127.0.0.1:5480/"
  curl -i -X POST -H 'Content-Type: application/json' -d "$1" "$backend_url"
  printf "\n\n\n"
}

# These strings are all base64.
tryswap '{"key":"Z3JlZXRpbmc=","id":"NP==","offset":0,"values":["aGVsbG8="]}'
tryswap '{"key":"Z3JlZXRpbmc=","id":"NP==","offset":1,"values":["d29ybGQ="]}'
tryswap '{"key":"Z3JlZXRpbmc=","id":"NQ==","offset":0,"values":[]}'
