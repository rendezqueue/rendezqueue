
This is a C++ / gRPC version of the server, but it doesn't actually do swapping yet so the binaries and deps are marked as testonly.
I'd like to actually use gRPC but JavaScript in a browser cannot talk to it directly, so what's the point?
Maybe grpc-web is a path forward, but it requires a proxy.

Anyway, this gRPC code shouldn't add too much extra to the build because JSON tests will rely on a protobuf schema for sanity.

You can test out the SSL authentication like this:

```shell
mkdir -p tmp
ssl_private_key="$PWD/tmp/server.key"
ssl_signed_crt="$PWD/tmp/server.crt"
hostname="localhost"
port="50051"

# Generate self-signed key pair.
#  -nodes: No password.
openssl req -x509 -newkey rsa:4096 -keyout "$ssl_private_key" -out "$ssl_signed_crt" -sha256 -days 365 -subj "/CN=$hostname" -nodes

# Run server.
bazel run //src/ccgrpc:syncserver -- --serve_address="$hostname:$port" --serve_ssl_signed_crt="$ssl_signed_crt" --serve_ssl_private_key="$ssl_private_key"

# In another terminal, call the server.
bazel run //src/ccgrpc:syncclient -- --backend_address="$hostname:$port" --backend_ssl_root_crt="$ssl_signed_crt" --key=hello --id=6
```
