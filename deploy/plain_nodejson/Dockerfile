FROM gcr.io/distroless/nodejs:18

WORKDIR /app

COPY main.js ./
COPY swapstore.js ./

EXPOSE 8080
CMD ["main.js", "--hostname=0.0.0.0", "--port=80"]

