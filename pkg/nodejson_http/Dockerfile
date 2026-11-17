FROM gcr.io/distroless/nodejs24-debian12

WORKDIR /app
COPY dist/src/ ./src/
COPY src/server/package.json ./package.json

CMD ["src/server/main.js", "--http_host=0.0.0.0", "--http_port=80"]
