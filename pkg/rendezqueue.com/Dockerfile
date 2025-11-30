FROM nginx:mainline-alpine

VOLUME /etc/letsencrypt

RUN apk add certbot nodejs

WORKDIR /etc/nginx/conf.d
COPY pkg/rendezqueue.com/nginx_app.conf ./

WORKDIR /app/html
COPY pkg/rendezqueue.com/index.html ./

WORKDIR /app/html/demo/webdual
COPY demo/webdual/index.html ./
COPY demo/webdual/app.ts ./app.js

RUN sed -i 's/app.ts/app.js/g' index.html

WORKDIR /app/nodejson
COPY src/server/main.ts ./main.js
COPY src/server/rendezqueue_json_impl.ts ./rendezqueue_json_impl.js
COPY src/server/swapstore.ts ./swapstore.js
COPY src/server/package.json ./package.json

WORKDIR /app
COPY pkg/rendezqueue.com/entrypoint.sh ./

ENTRYPOINT /app/entrypoint.sh
CMD []
