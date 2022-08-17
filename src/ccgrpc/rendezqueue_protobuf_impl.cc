#include "rendezqueue_protobuf_impl.hh"

namespace rendezqueue {

RendezqueueProtobufImpl::RendezqueueProtobufImpl()
{
  this->initial_time_point = std::chrono::steady_clock::now();
}

  unsigned
RendezqueueProtobufImpl::TrySwap(const TrySwapRequest* req, uint64_t now_ms, TrySwapResponse* res)
{
  return this->swapstore_.tryswap(
      req->key(), req->id(), req->ttl(),
      req->offset(), req->values(),
      now_ms, res);
}

  unsigned
RendezqueueProtobufImpl::TrySwap(const TrySwapRequest* req, TrySwapResponse* res)
{
  auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - this->initial_time_point);
  return this->TrySwap(req, now_ms.count(), res);
}

}  // namespace rendezqueue
