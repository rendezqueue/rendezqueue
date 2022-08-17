#ifndef RENDEZQUEUE_PROTOBUF_IMPL_HH_
#define RENDEZQUEUE_PROTOBUF_IMPL_HH_

#include <chrono>
#include "swapstore.hh"
#include "proto/rendezqueue.pb.h"

namespace rendezqueue {

class RendezqueueProtobufImpl
{
 private:
   SwapStore swapstore_;
   std::chrono::steady_clock::time_point initial_time_point;


 public:
  RendezqueueProtobufImpl();

  unsigned
  TrySwap(const TrySwapRequest* req, uint64_t now_ms, TrySwapResponse* res);
  unsigned
  TrySwap(const TrySwapRequest* req, TrySwapResponse* res);
};

}  // namespace rendezqueue
#endif
