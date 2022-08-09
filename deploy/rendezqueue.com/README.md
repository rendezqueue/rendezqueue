# HTTPS rendezqueue.com

## Build

```shell
# Create an image named rendezqueue_dot_com.
docker compose build
```

This will only run from a rendezqueue.com server,
See the compose file for how to run, but it'll only work from a rendezqueue.com server (due to the SSL certificate signing step).

## Deploy to Google Compute Engine

### Build and Push

```shell
# Path to my container image in the Artifact Registry.
gcloud_container_image="us-central1-docker.pkg.dev/intrawake/intrawake-dock/rendezqueue_dot_com"

# Alias for running `docker` as a different user.
alias gcloud-docker="doas -u ${USER}-for-gcloud docker"

gcloud-docker compose build
gcloud-docker tag rendezqueue_dot_com ${gcloud_container_image}
gcloud-docker push ${gcloud_container_image}
```

Then go to Artifact Registry, find the new image, and "Deploy to GCE".
During creation, remember to:
* Choose a Service Account with enough permission to pull & run the container.
* Enable HTTP and HTTPS in the Firewall section.
* Declare a Disk for the container's persistent data.
* Declare that disk/volume to be mounted to `/etc/letsencrypt` in the Container.
