#!/bin/sh

set -e

url="http://127.0.0.1:5480/"

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

tryswap() {
  curl -i -X POST -H 'Content-Type: application/json' -d "$1" "$url"
  printf "\n\n\n"
}

tryswap '{"key":"test_key","sid":"Alice","ttl":5,"values":["aa"]}'
tryswap '{"key":"test_key","sid":"Alice","ttl":5,"offset":1}'
tryswap '{"key":"test_key","sid":"Bob","ttl":5,"values":["bbbb"]}'
tryswap '{"b64":1,"key":"test_key","sid":"Alice","ttl":5,"offset":1}'
