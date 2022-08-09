FROM nginx:mainline-alpine

VOLUME /etc/letsencrypt

RUN apk add certbot nodejs

WORKDIR /etc/nginx/conf.d
COPY deploy/rendezqueue.com/nginx_app.conf ./

WORKDIR /app
COPY src/nodejson/main.js ./
COPY src/nodejson/rendezqueue_json_impl.js ./
COPY src/nodejson/swapstore.js ./
COPY deploy/rendezqueue.com/entrypoint.sh ./

ENTRYPOINT /app/entrypoint.sh
CMD []

