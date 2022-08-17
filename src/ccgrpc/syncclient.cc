
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

#include "ssl_cred.hh"
#include "proto/rendezqueue.grpc.pb.h"

ABSL_FLAG(std::string, backend_ssl_root_crt, "", "Root cert. If server self-signs, use server.crt.");
ABSL_FLAG(bool, ssl_on, false, "Whether to use SSL. If server self-signs, use server.crt.");
ABSL_FLAG(std::string, backend_address, "127.0.0.1:50051", "Where the service is.");
ABSL_FLAG(std::string, key, "hello!", "Key to set.");
ABSL_FLAG(std::string, id, "generic client", "Id to set.");
ABSL_FLAG(std::string, value, "nothing", "Value to send.");
ABSL_FLAG(unsigned, count, 1, "Number of requests to send with different key suffixes.");


static
  grpc::Status
send_request(
    rendezqueue::RendezqueueService::Stub& stub,
    const std::string& key, const std::string& id,
    const std::string& value, unsigned i,
    rendezqueue::TrySwapResponse* ret_res)
{
  rendezqueue::TrySwapRequest req;
  req.set_key(key + (i == 0 ? "" : std::to_string(i)));
  req.set_id(id);
  req.mutable_values()->Add(absl::GetFlag(FLAGS_value));

  rendezqueue::TrySwapResponse res;
  grpc::ClientContext context;
  grpc::Status status = stub.TrySwap(
      &context, req,
      (ret_res ? ret_res : &res));
  return status;
}

int main(int argc, char** argv)
{
  absl::ParseCommandLine(argc, argv);
  if (absl::GetFlag(FLAGS_count) == 0) {
    return 0;
  }

  std::shared_ptr<grpc::ChannelCredentials> channel_credentials =
    absl::GetFlag(FLAGS_ssl_on) || !absl::GetFlag(FLAGS_backend_ssl_root_crt).empty()
    ? get_ssl_client_credentials(absl::GetFlag(FLAGS_backend_ssl_root_crt))
    : grpc::InsecureChannelCredentials();

  rendezqueue::RendezqueueService::Stub stub(
      grpc::CreateChannel(
          absl::GetFlag(FLAGS_backend_address),
          channel_credentials));

  rendezqueue::TrySwapResponse res;
  grpc::Status status = send_request(
      stub, absl::GetFlag(FLAGS_key), absl::GetFlag(FLAGS_id),
      absl::GetFlag(FLAGS_value), 0, &res);

  if (!status.ok()) {
    std::cout << "TrySwap failed. " << status.error_message() << std::endl;
  }
  else if (res.ttl() > 0) {
    std::cout << "TrySwap offer sent." << std::endl;
  }
  else {
    std::cout << "TrySwap got data!" << std::endl;
    for (unsigned i = 0; i < (unsigned)res.values_size(); ++i) {
      std::cout << "values[" << i << "]==" << res.values(i) << std::endl;
    }
  }

  for (unsigned i = 1; i < absl::GetFlag(FLAGS_count); ++i) {
    send_request(
        stub, absl::GetFlag(FLAGS_key), absl::GetFlag(FLAGS_id),
        absl::GetFlag(FLAGS_value), i, nullptr);
  }
  google::protobuf::ShutdownProtobufLibrary();
  return 0;
}

