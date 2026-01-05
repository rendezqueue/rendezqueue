FROM gcr.io/distroless/nodejs24-debian12

WORKDIR /app
COPY dist/src/server/main.js ./
COPY dist/src/server/rendezqueue_json_impl.js ./
COPY dist/src/server/swapstore.js ./
COPY src/server/package.json ./

CMD ["main.js", "--http_host=0.0.0.0", "--http_port=80"]
