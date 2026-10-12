
const MAX_TTL_SECONDS = 20;

interface UnmatchedOffer {
  sid?: string;
  values?: string[];
  ack: string;
  expiry_ms: number;
}

interface SwappedAnswer {
  original_values: string[];
  peer_sid: string;
  values: string[];
  peer_acked: boolean;
  expiry_ms: number;
}

export interface TrySwapResponse {
  key: string;
  sid: string;
  offset: number;
  ack?: string;
  values?: string[];
  ttl?: number;
}

function make_response(a: TrySwapResponse): TrySwapResponse {
  const result: TrySwapResponse = {
    key: a.key,
    sid: a.sid,
    offset: a.offset,
  };
  if (a.ack !== undefined && a.ack !== "") {
    result.ack = a.ack;
  }
  if (a.values !== undefined && a.values.length > 0) {
    result.values = a.values;
  }
  if (a.ttl !== undefined && a.ttl !== 0) {
    result.ttl = a.ttl;
  }
  return result;
}

class SwapStore {
  unmatched_offer_map: Map<string, UnmatchedOffer>;
  swapped_answer_multimap: Map<string, Map<string, SwappedAnswer>>;
  ttl: number;

  constructor() {
    // key -> {sid, values, expiry}
    // If expiry is 0, this is not an actual entry.
    this.unmatched_offer_map = new Map();
    // key -> sid -> {original_values, values, expiry}
    this.swapped_answer_multimap = new Map();

    this.ttl = MAX_TTL_SECONDS;
  }

  print_unmatched(): void {
    console.log(this.unmatched_offer_map);
  }

  print_swapped(): void {
    console.log(this.swapped_answer_multimap);
  }

  /** Presumably, data was exchanged.**/
  expire_swapped_answers(key: string, now_ms: number): boolean {
    let expiring_answers: string[] = [];
    let answer_map = this.swapped_answer_multimap.get(key);
    if (!answer_map) {
      return true;
    }
    for (const [sid, v] of answer_map) {
      if (v.expiry_ms > now_ms) {
        break;
      }
      expiring_answers.push(sid);
    }
    if (expiring_answers.length == answer_map.size) {
      this.swapped_answer_multimap.delete(key);
      return true;
    }

    for (const sid of expiring_answers) {
      answer_map.delete(sid);
    }
    return false;
  }

  /** No takers.**/
  expire_unmatched_offers(now_ms: number): void {
    let expiring_offers: string[] = [];
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

  static matches_original(original_values: string[], offset: number, values: string[]): boolean {
    if (original_values.length < offset) {
      return false;  // Too far ahead. Out of place.
    }
    if (original_values.length > offset + values.length) {
      return false;  // Too short. Out of place.
    }
    const original_slice = original_values.slice(offset);
    return original_slice.every((v, i) => values[i] == v);
  }

  static matches_ack_payload(original_values: string[], offset: number, values: string[]): boolean {
    return (offset === 0 && values.length === original_values.length &&
      SwapStore.matches_original(original_values, 0, values)) ||
      (values.length === 0 && offset === original_values.length);
  }

  private forget_pair(key: string, sid: string, peer_sid: string, now_ms: number): boolean {
    const answer_map = this.swapped_answer_multimap.get(key);
    if (!answer_map) {
      return true;
    }
    const peer = answer_map.get(peer_sid);
    if (peer && peer.expiry_ms > now_ms && peer.peer_sid !== sid) {
      return false;
    }
    answer_map.delete(sid);
    answer_map.delete(peer_sid);
    if (answer_map.size === 0) {
      this.swapped_answer_multimap.delete(key);
    }
    return true;
  }

  tryswap(key: string, sid: string, offset: number, ack: string, values: string[], now_ms: number, ttl: number = 0): number | TrySwapResponse {
    if (!Number.isInteger(now_ms)) {
      return 500;
    }
    this.expire_unmatched_offers(now_ms);
    let answer_map = this.swapped_answer_multimap.get(key);
    if (ttl === 0 || ttl > this.ttl) {
      ttl = this.ttl;
    }

    if (answer_map) {
      let answer = answer_map.get(sid);
      if (answer && answer.expiry_ms <= now_ms) {
        answer_map.delete(sid);
        if (answer_map.size == 0) {
          this.swapped_answer_multimap.delete(key);
          answer_map = undefined;
        }
        answer = undefined;
      }
      if (answer) {
        if (ack === "" &&
            SwapStore.matches_original(answer.original_values, offset, values)) {
          return make_response({
            key: key,
            sid: sid,
            offset: answer.original_values.length,
            ack: answer.peer_sid,
            values: answer.values,
          });
        }
        if (ack !== "" &&
            SwapStore.matches_ack_payload(answer.original_values, offset, values)) {
          if (ack !== answer.peer_sid) {
            return 404;
          }
          const peer = (answer_map as Map<string, SwappedAnswer>).get(ack) as SwappedAnswer;
          if (peer.peer_sid === sid && peer.expiry_ms > now_ms) {
            peer.peer_acked = true;
          }
          return make_response({
            key: key,
            sid: sid,
            offset: answer.original_values.length,
            ack: answer.peer_acked ? sid : answer.peer_sid,
          });
        }
        return 404;
      }
    }
    let offer = this.unmatched_offer_map.get(key);
    if (offer && offer.expiry_ms <= now_ms) {
      this.unmatched_offer_map.delete(key);
      offer = undefined;  // Fall through to next case.
      this.expire_swapped_answers(key, now_ms);  // Best-effort cleanup for this key.
    }

    // We'll need to make an offer.
    if (!offer) {
      if (offset !== 0) {
        return 404;
      }
      if (ack !== "" && !this.forget_pair(key, sid, ack, now_ms)) {
        return 404;
      }
      if (values.length > 0 || ack !== "") {
        this.unmatched_offer_map.set(key, {
          sid: sid,
          values: values,
          ack: ack,
          expiry_ms: now_ms + ttl * 1000,
        });
      }
      return make_response({
        key: key,
        sid: sid,
        offset: values.length,
        ack: ack,
        ttl: ack === "" ? ttl : 0,
      });
    }

    if (!offer.sid) {
      return 500;  // Unexpected.
    }

    let original_values = offer.values || [];
    if (offer.sid === sid && ack !== "") {
      if (!SwapStore.matches_ack_payload(original_values, offset, values)) {
        return 404;
      }
      if (offer.ack !== "" && offer.ack !== ack) {
        return 404;
      }
      if (!this.forget_pair(key, sid, ack, now_ms)) {
        return 404;
      }
      offer.ack = ack;
      return make_response({
        key: key,
        sid: sid,
        offset: original_values.length,
        ack: ack,
      });
    }

    // Still no match? Might as well reset expiry.
    if (offer.sid === sid) {
      if (offer.ack !== "") {
        // No changes allowed while acking,
        // but permit a repeated recovery initialization.
        if (values.length !== original_values.length ||
            !SwapStore.matches_original(original_values, 0, values)) {
          return 404;
        }
        return make_response({
          key: key,
          sid: sid,
          offset: values.length,
          ttl: ttl,
        });
      }
      if (SwapStore.matches_original(original_values, offset, values)) {
        this.unmatched_offer_map.delete(key);
        this.unmatched_offer_map.set(key, {
          sid: sid,
          values: original_values.slice(0, offset).concat(values),
          ack: "",
          expiry_ms: now_ms + ttl * 1000,
        });
        return make_response({
          key: key,
          sid: sid,
          offset: offset + values.length,
          ttl: ttl,
        });
      }
      return 404;
    }

    if (offset !== 0) {
      // Invalid offset. We had no existing data!
      return 404;
    }
    if (offer.ack !== "" && offer.ack !== sid) {
      return 404;
    }
    if (ack !== "") {
      if (ack !== offer.sid) {
        return 404;
      }
      if (!this.forget_pair(key, sid, ack, now_ms)) {
        return 404;
      }
      answer_map = this.swapped_answer_multimap.get(key);
    }

    if (!answer_map) {
      answer_map = new Map();
      this.swapped_answer_multimap.set(key, answer_map);
    }
    answer_map.set(sid, {
      original_values: values,
      peer_sid: offer.sid,
      values: offer.values || [],
      peer_acked: offer.ack !== "" && offer.ack === sid,
      expiry_ms: now_ms + ttl * 1000,
    });
    // @ts-ignore: offer is guaranteed to exist and offer.sid != sid here.
    if (offer.sid) {
      answer_map.set(offer.sid, {
        original_values: offer.values || [],
        peer_sid: sid,
        values: values,
        peer_acked: ack !== "" && ack === offer.sid,
        expiry_ms: now_ms + ttl * 1000,
      });
    }

    this.unmatched_offer_map.delete(key);
    this.unmatched_offer_map.set(key, {
      ack: "",
      expiry_ms: 0,
    });
    return make_response({
      key: key,
      sid: sid,
      offset: values.length,
      ack: ack !== "" && offer.ack !== "" && offer.ack === sid ? sid : offer.sid,
      values: ack === "" ? offer.values : undefined,
    });
  }
}

export { SwapStore };
