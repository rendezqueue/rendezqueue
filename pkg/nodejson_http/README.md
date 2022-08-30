# JSON-over-HTTP Rendezqueue Server

## Prebuilt Public Image

A GitHub workflow builds and pushes that `ghcr.io/rendezqueue/rendezqueue_nodejson_http:latest` image whenever we merge to the `deploy` or `release` branch.
That workflow doesn't use `compose.yml`.

```shell
# Start.
container_id=$(docker run -d --rm -p 5000:80 ghcr.io/rendezqueue/rendezqueue_nodejson_http:latest)
# Test.
../../src/nodejson/some_requests.sh localhost:5000
# Stop.
docker kill ${container_id}
```

## Build with Docker Compose
I find `docker compose` more convenient, so we'll start with that.

```shell
# Creates rendezqueue_nodejson_http image. We don't really compose anything.
docker compose build
# Run it using the setup in compose.yaml.
container_id=$(docker compose run -d --service-ports app)
# Test it.
../../src/nodejson/some_requests.sh localhost:80
# Kill it.
docker kill ${container_id}
```

## Build with Docker CLI

```shell
# Build.
(cd ../../src/nodejson && docker build . -t rendezqueue_nodejson_http -f ../../pkg/nodejson_http/Dockerfile)
```

