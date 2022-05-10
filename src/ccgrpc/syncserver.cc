
#include <chrono>
#include <fstream>
#include <iostream>
#include <memory>
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

#include "proto/rendezqueue.grpc.pb.h"

ABSL_FLAG(std::string, serve_ssl_signed_crt, "", "A server.crt file (signed).");
ABSL_FLAG(std::string, serve_ssl_private_key, "", "A server.key file (private).");
ABSL_FLAG(std::string, serve_address, "127.0.0.1:50051", "Address to listen on.");

using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::Status;
using rendezqueue::RendezqueueService;

struct RendezqueueOffer {
  uint32_t id;
  std::vector<std::string> values;
  std::chrono::time_point<std::chrono::steady_clock> expiry;
};

struct RendezqueueAnswer {
  uint32_t original_offset;
  std::vector<std::string> values;
  std::chrono::time_point<std::chrono::steady_clock> expiry;
};

class RendezqueueServiceImpl final : public RendezqueueService::Service
{
 private:
   typedef std::string offer_key_type;
   typedef std::pair<std::string, uint32_t> answer_key_type;
   absl::flat_hash_map<offer_key_type, RendezqueueOffer> offer_map_;
   absl::flat_hash_map<answer_key_type, RendezqueueAnswer> answer_map_;

 public:
    Status
  TrySwap(ServerContext* context,
          const rendezqueue::TrySwapRequest* req,
          rendezqueue::TrySwapResponse* res) override
  {
    res->set_key(req->key());
    res->set_id(req->id());
    return Status::OK;
  }
};

std::shared_ptr<grpc::ServerCredentials> get_ssl_server_credentials()
{
  if (absl::GetFlag(FLAGS_serve_ssl_signed_crt).empty() &&
      absl::GetFlag(FLAGS_serve_ssl_private_key).empty())
  {
    std::cerr << "Using insecure creds\n";
    return grpc::InsecureServerCredentials();
  }

  std::ifstream crt_file(absl::GetFlag(FLAGS_serve_ssl_signed_crt),
                         std::ios::in | std::ios::binary);
  std::ifstream key_file(absl::GetFlag(FLAGS_serve_ssl_private_key),
                         std::ios::in | std::ios::binary);

  std::ostringstream crt_data;
  std::ostringstream key_data;

  if (crt_file) {crt_data << crt_file.rdbuf();}
  else {return nullptr;}
  if (key_file) {key_data << key_file.rdbuf();}
  else {return nullptr;}

  grpc::SslServerCredentialsOptions::PemKeyCertPair key_crt_pair;
  key_crt_pair.cert_chain = crt_data.str();
  key_crt_pair.private_key = key_data.str();

  grpc::SslServerCredentialsOptions options;
  //options.pem_root_certs = crt_data.str();
  options.pem_key_cert_pairs.push_back(key_crt_pair);
  return grpc::SslServerCredentials(options);
}

int main(int argc, char** argv)
{
  absl::ParseCommandLine(argc, argv);
  const std::string server_address(absl::GetFlag(FLAGS_serve_address));

  std::shared_ptr<grpc::ServerCredentials> server_credentials =
    get_ssl_server_credentials();
  if (!server_credentials) {
    std::cerr << "Could not build credentials. Exiting.\n";
    return 64;
  }

  ServerBuilder builder;
  builder.AddListeningPort(server_address, server_credentials);

  RendezqueueServiceImpl service;
  builder.RegisterService(&service);
  std::unique_ptr<Server> server(builder.BuildAndStart());
  std::cout << "Server listening on " << server_address << std::endl;
  server->Wait();
  return 0;
}
