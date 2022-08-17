/* Synchronous version of gRPC Rendezqueue server.
 * Most of the request handling is in a critical section,
 * so it's essentially single-threaded.
 */

#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>

#include <grpc/grpc.h>
#include <grpcpp/security/server_credentials.h>
#include <grpcpp/server.h>
#include <grpcpp/server_builder.h>
#include <grpcpp/server_context.h>

#include "absl/container/flat_hash_map.h"
#include "absl/flags/flag.h"
#include "absl/flags/parse.h"

#include "rendezqueue_protobuf_impl.hh"
#include "ssl_cred.hh"
#include "proto/rendezqueue.grpc.pb.h"

ABSL_FLAG(std::string, serve_ssl_signed_crt, "", "A server.crt file (signed).");
ABSL_FLAG(std::string, serve_ssl_private_key, "", "A server.key file (private).");
ABSL_FLAG(std::string, serve_address, "127.0.0.1:50051", "Address to listen on.");


class RendezqueueServiceImpl final : public rendezqueue::RendezqueueService::Service
{
 private:
   rendezqueue::RendezqueueProtobufImpl rendezqueue_protobuf_impl_;
   std::mutex mutex_;

 public:
   grpc::Status
  TrySwap(grpc::ServerContext* context,
          const rendezqueue::TrySwapRequest* req,
          rendezqueue::TrySwapResponse* res) override
  {
    mutex_.lock();
    unsigned http_status_code = rendezqueue_protobuf_impl_.TrySwap(req, res);
    mutex_.unlock();
    if (http_status_code == 0) {
      return grpc::Status::OK;
    }
    if (http_status_code == 404) {
      return grpc::Status(grpc::StatusCode::NOT_FOUND, "");
    }
    return grpc::Status(grpc::StatusCode::UNKNOWN, "");
  }
};


int main(int argc, char** argv)
{
  absl::ParseCommandLine(argc, argv);
  const std::string server_address(absl::GetFlag(FLAGS_serve_address));

  std::shared_ptr<grpc::ServerCredentials> server_credentials =
    get_ssl_server_credentials(absl::GetFlag(FLAGS_serve_ssl_signed_crt),
                               absl::GetFlag(FLAGS_serve_ssl_private_key));
  if (!server_credentials) {
    std::cerr << "Could not build credentials. Exiting.\n";
    return 64;
  }

  grpc::ServerBuilder builder;
  builder.AddListeningPort(server_address, server_credentials);

  RendezqueueServiceImpl service;
  builder.RegisterService(&service);
  std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
  std::cout << "Server listening on " << server_address << std::endl;
  server->Wait();
  return 0;
}
