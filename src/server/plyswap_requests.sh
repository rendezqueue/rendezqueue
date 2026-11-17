#!/bin/sh

set -e

url="http://127.0.0.1:5480/plyswap"

while [ 0 -lt "$#" ]; do
  arg="$1"
  case "${arg}" in
    --url=*)
      url="${arg#--url=}"
      ;;
    --url)
      shift
      url="$1"
      ;;
    *)
      echo "unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
  shift
done

plyswap() {
  curl -i -X POST -H 'Content-Type: application/json' -d "$1" "$url"
  printf "\n\n\n"
}

plyswap '{"room":"test_room","self":"Alice"}'
plyswap '{"room":"test_room","self":"Alice"}'
plyswap '{"room":"test_room","self":"Bob"}'
plyswap '{"room":"test_room","self":"Alice","peer":"Bob","next":"Alice-1","values":["hello"]}'
plyswap '{"b64":7,"room":"dGVzdF9yb29t","self":"Qm9i","peer":"QWxpY2U","next":"Qm9iLTE","values":["d29ybGQ"]}'
plyswap '{"room":"test_room","self":"Alice","next":"Alice-1"}'
