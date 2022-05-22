"use strict";

const MAX_TTL_SECONDS = 20;

class SwapStore {

  constructor() {
    // key -> {id, values, expiry}
    // If expiry is 0, this is not an actual entry.
    this.unmatched_offer_map = new Map();
    // key -> id -> {original_values, values, expiry}
    this.swapped_answer_multimap = new Map();

    this.ttl = MAX_TTL_SECONDS;
  }

  print_unmatched() {
    console.log(this.unmatched_offer_map);
  }

  print_swapped() {
    console.log(this.swapped_answer_multimap);
  }

  /** Presumably, data was exchanged.**/
  expire_swapped_answers(key, now_ms) {
    let expiring_answers = [];
    let answer_map = this.swapped_answer_multimap.get(key);
    if (!answer_map) {
      return true;
    }
    for (const [id, v] of answer_map) {
      if (v.expiry_ms > now_ms) {
        break;
      }
      expiring_answers.push(id);
    }
    if (expiring_answers.length == answer_map.size) {
      this.swapped_answer_multimap.delete(key);
      return true;
    }

    for (const id of expiring_answers) {
      answer_map.delete(id);
    }
    return false;
  }

  /** No takers.**/
  expire_unmatched_offers(now_ms) {
    let expiring_offers = []
    for (const [key, v] of this.unmatched_offer_map) {
      if (v.expiry_ms > now_ms) {
        break;
      }
      if (!this.expire_swapped_answers(key, now_ms)) {
        break;
      }
      expiring_offers.push(key);
    }
    for (const key of expiring_offers) {
      this.unmatched_offer_map.delete(key);
    }
  }

  static matches_original(original_values, offset, values) {
    if (original_values.length < offset) {
      return false;  // Too far ahead. Out of place.
    }
    if (original_values.length > offset + values.length) {
      return false;  // Too short. Out of place.
    }
    const original_slice = original_values.slice(offset);
    return original_slice.every((v, i) => values[i] == v);
  }

  tryswap(key, id, offset, values, now_ms) {
    this.expire_unmatched_offers(now_ms);
    let answer_map = this.swapped_answer_multimap.get(key);
    let ttl = this.ttl;

    if (answer_map) {
      let answer = answer_map.get(id);
      if (answer) {
        if (SwapStore.matches_original(answer.original_values, offset, values)) {
          return {
            key: key,
            id: id,
            offset: answer.original_values.length,
            values: answer.values,
          };
        }
        return 404;
      }
    }
    // Reached this line? No answer.

    let offer = this.unmatched_offer_map.get(key);
    if (offer && offer.expiry_ms == 0) {
      this.unmatched_offer_map.delete(key);
      offer = null;  // Fall through to next case.
      this.expire_swapped_answers(key, now_ms);  // Ensure stuff would expire.
    }

    // We'll need to make an offer.
    if (!offer) {
      if (offset != 0) {
        return 404;
      }
      if (values.length > 0) {
        this.unmatched_offer_map.set(key, {
          id: id,
          values: values,
          expiry_ms: now_ms + ttl * 1000,
        });
      }
      return {
        key: key,
        id: id,
        offset: values.length,
        ttl: ttl,
      };
    }

    // Still no match? Might as well reset expiry.
    if (offer.id == id) {
      let original_values = offer.values;
      if (SwapStore.matches_original(original_values, offset, values)) {
        this.unmatched_offer_map.delete(key);
        this.unmatched_offer_map.set(key, {
          id: id,
          values: original_values.slice(0, offset).concat(values),
          expiry_ms: now_ms + ttl * 1000,
        });
        return {
          key: key,
          id: id,
          offset: offset + values.length,
          ttl: ttl,
        };
      }
      return 404;
    }
    // Reached this line? Got a match!

    if (offset != 0) {
      // Invalid offset. We had no existing data!
      return 404;
    }

    if (!answer_map) {
      answer_map = new Map();
      this.swapped_answer_multimap.set(key, answer_map);
    }
    answer_map.set(id, {
      original_values: values,
      values: offer.values,
      expiry_ms: now_ms + ttl * 1000,
    });
    answer_map.set(offer.id, {
      original_values: offer.values,
      values: values,
      expiry_ms: now_ms + ttl * 1000,
    });
    this.unmatched_offer_map.delete(key);
    this.unmatched_offer_map.set(key, {
      expiry_ms: 0,
    });
    return {
      key: key,
      id: id,
      offset: values.length,
      values: offer.values,
    };
  }
}

exports.SwapStore = SwapStore;

