FROM nginx:mainline-alpine

VOLUME /etc/letsencrypt

RUN apk add certbot nodejs

WORKDIR /etc/nginx/conf.d
COPY pkg/rendezqueue.com/nginx_app.conf ./

WORKDIR /app/html
COPY pkg/rendezqueue.com/index.html ./

WORKDIR /app/html/demo/webdual
COPY src/webdual/index.html ./
COPY src/webdual/script.js ./

WORKDIR /app/nodejson
COPY src/nodejson/main.js ./
COPY src/nodejson/rendezqueue_json_impl.js ./
COPY src/nodejson/swapstore.js ./

WORKDIR /app
COPY pkg/rendezqueue.com/entrypoint.sh ./

ENTRYPOINT /app/entrypoint.sh
CMD []

