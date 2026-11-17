# Rendezqueue

A rendezvous service to exchange queued values.

The service acts as a data broker, but has fairly tight limits on how much data can be held.
It's enough to exchange a WebRTC offer and answer!

The default protocol is PlySwap at `/`: JSON with `room`, `self`, `peer`, `next`, and `values`, plus an optional `b64` bitmap (values=1, IDs=2, room=4; unflagged bytes use Latin-1, flagged bytes use base64).
The client library pins one endpoint and room for its lifetime and always sends `b64=7`.

## Demo

Spin up a server that hosts some demo chat apps that rely on the Rendezqueue API.
```shell
npm install
npm run build
npm run serve:demo -- --http_port=8080
```

That last command prints URLs of the demo apps.

You can also exercise the API directly with a script.
```shell
./src/server/plyswap_requests.sh --url=http://127.0.0.1:8080/plyswap
```

## Development

```shell
npm run lint
npm test
npm run test:browse
```
