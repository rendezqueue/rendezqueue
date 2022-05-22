
Start the server in one shell.

```shell
bazel run //src/nodejson:rendezqueue_nodejson
```

In another shell, build this webpage and open it in a browser.

```shell
bazel build //src/webdual/...
chromium bazel-bin/src/webdual/pkg/index.html
```

It shows how many attempts 2 clients made to exchange their data "hello there" and "nowai".

Since the filesystem is serving the webpage, you might notice that an OPTIONS request happens before each POST.
This verifies that the server is cool with cross-domain requests.
It's fine, but the extra request is not ideal, so this test page may involve running a webserver in the future.

