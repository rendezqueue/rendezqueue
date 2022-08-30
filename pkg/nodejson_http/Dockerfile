FROM gcr.io/distroless/nodejs:latest
# Docs say to use a version number like "18" instead of "latest",
# but we don't pin the nodejs version anywhere else, so why start now?

WORKDIR /app

COPY main.js ./
COPY rendezqueue_json_impl.js ./
COPY swapstore.js ./

ENTRYPOINT ["/nodejs/nodejs", "/app/main.js"]
CMD ["--hostname=0.0.0.0", "--port=80"]

