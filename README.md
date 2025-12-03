# Rendezqueue

A rendezvous service to exchange queued values.

The service acts as a data broker, but has fairly tight limits on how much data can be held.
It's enough to exchange a WebRTC offer and answer!

## Demo

Spin up a server that hosts some demo chat apps that rely on the Rendezqueue API at its /tryswap URL path.
```shell
npm install
npm run build
npm run serve:demo -- --http_port=8080
```

That last command prints URLs of the demo apps.

You can also exercise the API directly with a script.
```shell
./src/server/some_requests.sh --url=http://127.0.0.1:8080/tryswap
```
