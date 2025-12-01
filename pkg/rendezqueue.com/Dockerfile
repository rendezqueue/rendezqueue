FROM nginx:mainline-alpine

VOLUME /etc/letsencrypt

RUN apk add certbot nodejs

WORKDIR /etc/nginx/conf.d
COPY pkg/rendezqueue.com/nginx_app.conf ./

WORKDIR /app/html
COPY pkg/rendezqueue.com/index.html ./

WORKDIR /app/html/demo/webchat
COPY demo/webchat/index.html ./
COPY dist/demo/webchat/app.js ./app.js
WORKDIR /app/html/demo/webrtcchat
COPY demo/webrtcchat/index.html ./
COPY dist/demo/webrtcchat/app.js ./app.js
WORKDIR /app/html/demo/webdual
COPY demo/webdual/index.html ./
COPY dist/demo/webdual/app.js ./app.js

WORKDIR /app/nodejson
COPY dist/src/server/main.js ./main.js
COPY dist/src/server/rendezqueue_json_impl.js ./rendezqueue_json_impl.js
COPY dist/src/server/swapstore.js ./swapstore.js
COPY src/server/package.json ./package.json

WORKDIR /app
COPY pkg/rendezqueue.com/entrypoint.sh ./

ENTRYPOINT /app/entrypoint.sh
CMD []
