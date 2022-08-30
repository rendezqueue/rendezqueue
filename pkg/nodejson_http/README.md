# JSON-over-HTTP Rendezqueue Server

[How to push to gcloud](https://cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)

## Build and Run

### With Docker Compose
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

### With Docker CLI

```shell
# Build.
(cd ../../src/nodejson && docker build . -t rendezqueue_nodejson_http -f ../../pkg/nodejson_http/Dockerfile)
```

## Deploy to Google Compute Engine

### Initialize Users

```shell
# Create user ${USER}-for-gcloud to run gcloud things.
useradd -g $(id -g -n) -G docker --shell /bin/false "${USER}-for-gcloud"
printf "permit nopass %s as %s\n" ${USER} "${USER}-for-gcloud" >> "/etc/doas.conf"

alias gcloud="doas -u ${USER}-for-gcloud gcloud"
gcloud auth configure-docker us-central1-docker.pkg.dev
# Not sure if this was necessary...
gcloud auth application-default login
```

### Build and Push

```shell
# Path to my container image in the Artifact Registry.
gcloud_container_image="us-central1-docker.pkg.dev/intrawake/intrawake-dock/rendezqueue_nodejson_http"

# Alias for running `docker` as a different user.
alias gcloud-docker="doas -u ${USER}-for-gcloud docker"

gcloud-docker compose build
gcloud-docker tag rendezqueue_nodejson_http ${gcloud_container_image}
gcloud-docker push ${gcloud_container_image}

# Then go to Artifact Registry, find the new image, and "Deploy to GCE".
# During creation, remember to:
# * Choose a Service Account with enough permission to pull & run the container.
# * Enable HTTP in the Firewall section.
# If you can't access the service on port 80, then SSH in and look through logs.
```

