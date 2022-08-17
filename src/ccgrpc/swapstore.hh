#ifndef RENDEZQUEUE_SWAPSTORE_HH_
#define RENDEZQUEUE_SWAPSTORE_HH_
#include "absl/container/flat_hash_map.h"
#include "proto/rendezqueue.pb.h"

namespace rendezqueue {

struct SwapStoreEntry {
  SwapStoreEntry() : expiry(0) {}

  std::string key;
  uint64_t expiry;
  std::string offer_id;
  std::string answer_id;
  std::vector<std::string> offer_values;
  std::vector<std::string> answer_values;
};

class SwapStore {
 public:
  static const unsigned MAX_TTL_SECONDS = 20;

 private:
  typedef std::pair<absl::string_view,absl::string_view> key_type;
  absl::flat_hash_map<key_type,std::list<SwapStoreEntry>::iterator> entry_map_;
  std::list<SwapStoreEntry> entry_list_;

 public:
  SwapStore() {}

  void expire_entries(uint64_t now_ms);

  static bool
  matches_original(
      const std::vector<std::string>& original_values,
      unsigned offset,
      const google::protobuf::RepeatedPtrField<std::string>& values);

  void
  reset_entry_ttl(std::list<SwapStoreEntry>::iterator entry_it,
                  unsigned ttl, uint64_t now_ms);

  unsigned
  tryswap(const std::string& key, const std::string& id, unsigned ttl,
          unsigned offset,
          const google::protobuf::RepeatedPtrField<std::string>& values,
          uint64_t now_ms, TrySwapResponse* res);
};

}  // namespace rendezqueue
#endif
