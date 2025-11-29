
Start the server in one shell.

```shell
node src/nodejson/main.js --http_port=5480
# Server running at http://127.0.0.1:5480/
```

In another shell, send some requests.

```shell
./src/nodejson/some_requests.sh --url http://127.0.0.1:5480/
```
