
#include "swapstore.hh"

namespace rendezqueue {

  void
SwapStore::expire_entries(uint64_t now_ms)
{
  auto& q = this->entry_list_;
  while (!q.empty() && q.front().expiry <= now_ms) {
    const auto e = q.front();
    if (e.answer_id.empty()) {
      this->entry_map_.erase({e.key, ""});
    }
    else {
      this->entry_map_.erase({e.key, e.answer_id});
    }
    this->entry_map_.erase({e.key, e.offer_id});
    q.pop_front();
  }
}

  bool
SwapStore::matches_original(
    const std::vector<std::string>& original_values,
    unsigned offset,
    const google::protobuf::RepeatedPtrField<std::string>& values)
{
  if (original_values.size() < offset) {
    return false;  // Too far ahead. Out of place.
  }
  if (original_values.size() > offset + values.size()) {
    return false;  // Too short. Out of place.
  }
  for (unsigned i = offset; i < original_values.size(); ++i) {
    if (values[i-offset] != original_values[i]) {
      return false;
    }
  }
  return true;
}

  void
SwapStore::reset_entry_ttl(std::list<SwapStoreEntry>::iterator entry_it,
                           unsigned ttl, uint64_t now_ms)
{
  auto& entry_list = this->entry_list_;
  entry_list.splice(entry_list.end(), entry_list, entry_it);

  uint64_t expiry = now_ms + (uint64_t) ttl * 1000;
  if (entry_it->expiry < expiry) {
    entry_it->expiry = expiry;
  }
}

  unsigned
SwapStore::tryswap(
    std::string_view key,
    std::string_view id,
    unsigned ttl,
    unsigned offset,
    const google::protobuf::RepeatedPtrField<std::string>& values,
    uint64_t now_ms,
    TrySwapResponse* res)
{
  this->expire_entries(now_ms);
  if (ttl == 0 || ttl > this->MAX_TTL_SECONDS) {
    ttl = this->MAX_TTL_SECONDS;
  }
  auto& entry_map = this->entry_map_;

  auto answer_kv = entry_map.find({key, id});
  if (answer_kv == entry_map.end()) {
    if (offset > 0) {
      // There's no existing (key,id) pair yet,
      // so the only sensible offset is zero!
      return 404;
    }
    auto offer_kv = entry_map.find(
        std::pair<std::string_view,std::string_view>(key, ""));
    if (offer_kv == entry_map.end()) {
      // Create new offer.
      this->entry_list_.emplace_back();
      auto entry_it = std::prev(this->entry_list_.end());
      entry_it->key = key;
      entry_it->offer_id = id;
      entry_it->offer_values = {values.begin(), values.end()};
      entry_it->expiry = now_ms + (uint64_t) ttl * 1000;

      res->set_key(key.data(), key.size());
      res->set_id(id.data(), id.size());
      res->set_ttl(ttl);
      res->set_offset(values.size());

      const SwapStore::key_type lone_key(entry_it->key, "");
      const SwapStore::key_type offer_key(entry_it->key, entry_it->offer_id);
      this->entry_map_[lone_key] = entry_it;
      this->entry_map_[offer_key] = entry_it;
    }
    else {
      // Give answer.
      auto entry_it = offer_kv->second;
      this->reset_entry_ttl(entry_it, ttl, now_ms);

      entry_it->answer_id = id;
      entry_it->answer_values = {values.begin(), values.end()};

      res->set_key(key.data(), key.size());
      res->set_id(id.data(), id.size());
      res->set_offset(entry_it->offer_values.size());
      *res->mutable_values() = {
        entry_it->offer_values.begin(),
        entry_it->offer_values.end(),
      };

      this->entry_map_.erase(offer_kv);
      const SwapStore::key_type answer_key(entry_it->key, entry_it->answer_id);
      this->entry_map_[answer_key] = entry_it;
    }
  }
  else {
    auto entry_it = answer_kv->second;
    if (entry_it->offer_id == id) {
      // I made the offer.
      if (!SwapStore::matches_original(entry_it->offer_values, offset, values)) {
        return 404;
      }

      res->set_key(key.data(), key.size());
      res->set_id(id.data(), id.size());
      if (entry_it->answer_id.empty()) {
        // No answer yet.
        this->reset_entry_ttl(entry_it, ttl, now_ms);
        while (entry_it->offer_values.size() < offset + values.size()) {
          entry_it->offer_values.push_back(
              values[entry_it->offer_values.size() - offset]);
        }
        res->set_ttl(ttl);
        res->set_offset(entry_it->offer_values.size());
      }
      else {
        // Answer found!
        res->set_offset(entry_it->answer_values.size());
        *res->mutable_values() = {
          entry_it->answer_values.begin(),
          entry_it->answer_values.end(),
        };
      }
    }
    else {
      // Answer found. I gave it before.
      if (!SwapStore::matches_original(entry_it->answer_values, offset, values)) {
        return 404;
      }
      res->set_key(key.data(), key.size());
      res->set_id(id.data(), id.size());
      res->set_offset(entry_it->offer_values.size());
      *res->mutable_values() = {
        entry_it->offer_values.begin(),
        entry_it->offer_values.end(),
      };
    }
  }

  return 0;
}

}  // namespace rendezqueue
