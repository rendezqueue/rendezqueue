
Start the server in one shell.

```shell
nodejs main.js
# Server running at http://127.0.0.1:5480/
```

In another shell, send some requests.

```shell
function tryswap() {
  curl -X POST http://127.0.0.1:5480/ -H 'Content-Type: application/json' -d "$1"
  echo ""
}

tryswap '{"key":"greeting","id":"5","offset":0,"values":["hello"]}'
tryswap '{"key":"greeting","id":"5","offset":1,"values":["world"]}'
tryswap '{"key":"greeting","id":"4","offset":0,"values":[]}'
```
