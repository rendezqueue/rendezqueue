
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>

#include <grpc/grpc.h>
#include <grpcpp/channel.h>
#include <grpcpp/client_context.h>
#include <grpcpp/create_channel.h>
#include <grpcpp/security/credentials.h>

#include "absl/flags/flag.h"
#include "absl/flags/parse.h"

#include "proto/rendezqueue.grpc.pb.h"

ABSL_FLAG(std::string, backend_ssl_root_crt, "", "Root cert. If server self-signs, use server.crt.");
ABSL_FLAG(std::string, backend_address, "127.0.0.1:50051", "Where the service is.");
ABSL_FLAG(std::string, key, "hello!", "Key to set.");
ABSL_FLAG(uint32_t, id, 5, "Id to set.");


using grpc::Status;
using rendezqueue::RendezqueueService;


std::shared_ptr<grpc::ChannelCredentials> get_ssl_channel_credentials()
{
  if (absl::GetFlag(FLAGS_backend_ssl_root_crt).empty()) {
    std::cerr << "Using insecure creds\n";
    return grpc::InsecureChannelCredentials();
  }

  std::ifstream crt_file(absl::GetFlag(FLAGS_backend_ssl_root_crt),
                         std::ios::in | std::ios::binary);

  std::ostringstream crt_data;
  if (crt_file) {crt_data << crt_file.rdbuf();}
  else {return nullptr;}

  grpc::SslCredentialsOptions options;
  options.pem_root_certs = crt_data.str();
  return grpc::SslCredentials(options);
}

int main(int argc, char** argv)
{
  absl::ParseCommandLine(argc, argv);

  std::shared_ptr<grpc::ChannelCredentials> channel_credentials =
    get_ssl_channel_credentials();

  RendezqueueService::Stub stub(
      grpc::CreateChannel(
          absl::GetFlag(FLAGS_backend_address),
          channel_credentials));

  rendezqueue::TrySwapRequest req;
  req.set_key(absl::GetFlag(FLAGS_key));
  req.set_id(absl::GetFlag(FLAGS_id));

  rendezqueue::TrySwapResponse res;

  grpc::ClientContext context;
  Status status = stub.TrySwap(&context, req, &res);
  if (status.ok()) {
    std::cout << "TrySwap worked." << std::endl;
    std::cout << res.key() << " " << res.id() << std::endl;
  }
  else {
    std::cout << "TrySwap failed." << std::endl;
  }
  return 0;
}

