FROM gcr.io/distroless/nodejs20-debian12

WORKDIR /app

COPY src/server/main.ts ./main.js
COPY src/server/rendezqueue_json_impl.ts ./rendezqueue_json_impl.js
COPY src/server/swapstore.ts ./swapstore.js
COPY src/server/package.json ./package.json

CMD ["main.js", "--http_host=0.0.0.0", "--http_port=80"]
