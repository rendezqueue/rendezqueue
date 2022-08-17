#ifndef SSL_CRED_HH_
#define SSL_CRED_HH_
#include <memory>
#include <string>
#include <grpcpp/security/credentials.h>
#include <grpcpp/security/server_credentials.h>

std::shared_ptr<grpc::ChannelCredentials>
get_ssl_client_credentials(const std::string& root_crt_filename);
std::shared_ptr<grpc::ServerCredentials>
get_ssl_server_credentials(const std::string& signed_crt_filename,
                           const std::string& private_key_filename);

#endif
