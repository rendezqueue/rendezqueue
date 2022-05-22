
Start the server in one shell.

```shell
bazel run //src/nodejson:rendezqueue_nodejson
# Or just run `nodejs main.js` in this directory.
# Server running at http://127.0.0.1:5480/
```

In another shell, send some requests.

```shell
bazel run //src/nodejson:some_requests_sh
```
