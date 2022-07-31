# Plain HTTP Rendezqueue Server

[How to push to gcloud](https://cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)

## Initialize Users

```shell
# Added users ${USER}-for-docker and ${USER}-for-gcloud just for fun.
useradd -g $(id -g -n) -G docker --shell /bin/false "${USER}-for-docker"
printf "permit nopass %s as %s\n" ${USER} "${USER}-for-docker" >> "/etc/doas.conf"

useradd -g $(id -g -n) -G docker --shell /bin/false "${USER}-for-gcloud"
printf "permit nopass %s as %s\n" ${USER} "${USER}-for-gcloud" >> "/etc/doas.conf"

alias gcloud="doas -u ${USER}-for-gcloud gcloud"
gcloud auth configure-docker us-central1-docker.pkg.dev
# Not sure if this was necessary...
gcloud auth application-default login
```

## Build and Push

```shell
# Temporary aliases.
alias docker-compose="doas -u ${USER}-for-docker docker-compose"
alias gcloud-docker="doas -u ${USER}-for-gcloud docker"

docker-compose build

gcloud-docker tag rendezqueue_plain_nodejson us-central1-docker.pkg.dev/intrawake/intrawake-dock/rendezqueue_nodejson
gcloud-docker push us-central1-docker.pkg.dev/intrawake/intrawake-dock/rendezqueue_nodejson
```
