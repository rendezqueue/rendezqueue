#include "ssl_cred.hh"
#include <fstream>
#include <sstream>

  std::shared_ptr<grpc::ChannelCredentials>
get_ssl_client_credentials(const std::string& root_crt_filename)
{
  if (root_crt_filename.empty()) {
    grpc::SslCredentialsOptions options;
    return grpc::SslCredentials(options);
  }

  std::ifstream crt_file(root_crt_filename,
                         std::ios::in | std::ios::binary);

  std::ostringstream crt_data;
  if (crt_file) {crt_data << crt_file.rdbuf();}
  else {return nullptr;}

  grpc::SslCredentialsOptions options;
  options.pem_root_certs = crt_data.str();
  return grpc::SslCredentials(options);
}


  std::shared_ptr<grpc::ServerCredentials>
get_ssl_server_credentials(const std::string& signed_crt_filename,
                           const std::string& private_key_filename)
{
  if (signed_crt_filename.empty() && private_key_filename.empty()) {
    std::cerr << "Using insecure creds\n";
    return grpc::InsecureServerCredentials();
  }

  std::ifstream crt_file(signed_crt_filename,
                         std::ios::in | std::ios::binary);
  std::ifstream key_file(private_key_filename,
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

