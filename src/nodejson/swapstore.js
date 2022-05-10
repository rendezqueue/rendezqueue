"use strict";

const MAX_TTL_SECONDS = 20;

class SwapStore {

  constructor() {
    // key -> {id, value, expiry}
    // If expiry is 0, this is not an actual entry.
    this.unmatched_offer_map = new Map();
    // key -> id -> {original, value, expiry}
    this.swapped_answer_multimap = new Map();

    this.ttl = MAX_TTL_SECONDS;
  }

  print_unmatched() {
    console.log(this.unmatched_offer_map);
  }

  print_swapped() {
    console.log(this.swapped_answer_multimap);
  }

  /** Nobody has the answers.**/
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

  /** Offers gonna die.**/
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


  /** It's just so funky.*/
  swap_that(key, id, value, now_ms) {
    this.expire_unmatched_offers(now_ms);
    let answer_map = this.swapped_answer_multimap.get(key);
    let ttl = this.ttl;

    if (answer_map) {
      let answer = answer_map.get(id);
      if (answer) {
        if (answer.original == value) {
          return {key: key, value: answer.value}
        } else {
          return 404;
        }
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
      this.unmatched_offer_map.set(key, {
        id: id,
        value: value,
        expiry_ms: now_ms + ttl * 1000,
      });
      return {key: key, id: id, ttl: ttl}
    }

    // Still no match? Might as well reset expiry.
    if (offer.id == id) {
      if (offer.value == value) {
        this.unmatched_offer_map.delete(key);
        this.unmatched_offer_map.set(key, {
          id: id,
          value: value,
          expiry_ms: now_ms + ttl * 1000,
        });
        return {key: key, id: id, ttl: ttl}
      }
    }
    // Reached this line? Got a match!

    if (!answer_map) {
      answer_map = new Map();
      this.swapped_answer_multimap.set(key, answer_map);
    }
    answer_map.set(id, {
      original: value,
      value: offer.value,
      expiry_ms: now_ms + ttl * 1000,
    });
    answer_map.set(offer.id, {
      original: offer.value,
      value: value,
      expiry_ms: now_ms + ttl * 1000,
    });
    this.unmatched_offer_map.delete(key);
    this.unmatched_offer_map.set(key, {
      expiry_ms: 0,
    });
    return {key: key, id: id, value: offer.value}
  }
}

exports.SwapStore = SwapStore;

