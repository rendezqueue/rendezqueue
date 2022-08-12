
Open this webpage in a browser.

```shell
chromium src/webdual/index.html
```

It should show how many attempts 2 clients (Alice and Bob) need to exchange their data to exchange their greeting messages.

The URL field can be changed to point at a local server as well.
For example, `http://127.0.0.1:5480` would use the local sever started as:

```shell
bazel run //src/nodejson:rendezqueue_nodejson -- --host=127.0.0.1 --port=5480
```

Since the filesystem is serving the webpage, you might notice that an OPTIONS request happens before each POST.
This verifies that the server is cool with cross-domain requests.
It's fine, but the extra request is not ideal, so this test page may involve running a webserver in the future.

