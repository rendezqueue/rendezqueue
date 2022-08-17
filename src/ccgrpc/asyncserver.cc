/* Asynchronous version of gRPC Rendezqueue server.
 * It's single-threaded, but it's the fastest version.
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


class ServerImpl final {
 private:
  std::unique_ptr<grpc::ServerCompletionQueue> cq_;
  rendezqueue::RendezqueueService::AsyncService service_;
  std::unique_ptr<grpc::Server> server_;

 public:
  ~ServerImpl() {
    server_->Shutdown();
    cq_->Shutdown();
  }

  void Run(grpc::ServerBuilder& builder) {
    builder.RegisterService(&service_);
    cq_ = builder.AddCompletionQueue();
    server_ = builder.BuildAndStart();

    HandleRpcs();
  }

 private:
  struct TrySwapState {
    rendezqueue::TrySwapRequest req;
    rendezqueue::TrySwapResponse res;
    grpc::ServerContext ctx;
    grpc::ServerAsyncResponseWriter<rendezqueue::TrySwapResponse> writer;
    bool processed;

    TrySwapState() : writer(&ctx), processed(false) {}
  };

  void HandleRpcs() {
    rendezqueue::RendezqueueProtobufImpl rendezqueue_protobuf_impl;
    std::vector<std::unique_ptr<TrySwapState>> v(10);
    for (auto& e : v) {
      e.reset(new TrySwapState());
      service_.RequestTrySwap(
          &e->ctx, &e->req, &e->writer, cq_.get(), cq_.get(), &e);
    }
    void* tag;
    bool ok;
    while (true) {
      GPR_ASSERT(cq_->Next(&tag, &ok));
      GPR_ASSERT(ok);
      auto& e = *static_cast<std::unique_ptr<TrySwapState>*>(tag);
      if (e->processed) {
        e.reset(nullptr);
        e.reset(new TrySwapState());
        service_.RequestTrySwap(
            &e->ctx, &e->req, &e->writer, cq_.get(), cq_.get(), &e);
      }
      else {
        // std::cerr << "Handling key: " << e->req.key() << std::endl;
        unsigned http_status_code = rendezqueue_protobuf_impl.TrySwap(
            &e->req, &e->res);
        e->processed = true;
        if (http_status_code == 0) {
          e->writer.Finish(e->res, grpc::Status::OK, &e);
        }
        else if (http_status_code == 404) {
          e->writer.Finish(e->res, grpc::Status(grpc::StatusCode::NOT_FOUND, ""), &e);
        }
        else {
          e->writer.Finish(e->res, grpc::Status(grpc::StatusCode::UNKNOWN, ""), &e);
        }
      }
    }
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
  std::cout << "Server going to listen on " << server_address << std::endl;
  ServerImpl server;
  server.Run(builder);
  return 0;
}

