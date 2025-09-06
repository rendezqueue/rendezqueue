
Start the server in one shell.

```shell
bazel run //src/nodejson:rendezqueue_nodejson -- --http_port=5480
# Or just run `nodejs main.js --http_port=5480` in this directory.
# Server running at http://127.0.0.1:5480/
```

In another shell, send some requests.

```shell
bazel run //src/nodejson:some_requests_sh -- --url http://127.0.0.1:5480/
```
