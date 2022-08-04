"use strict";

const path = require("path");
const SwapStore = require(path.join(__dirname, "swapstore")).SwapStore;

const MAX_KEY_BYTES = 100;
const MAX_ID_BYTES = 100;
const MAX_VALUE_BYTES = 1000;


function btoa(s) {
  return Buffer.from(s, "latin1").toString("base64");
}
function atob(s) {
  return Buffer.from(s, "base64").toString("latin1");
}

function inplace_decode_tryswap_message(msg) {
  if (msg.key === undefined) {msg.key = "";}
  else if (typeof(msg.key) != "string") {return "key";}

  if (msg.id === undefined) {msg.id = "";}
  else if (typeof(msg.id) != "string") {return "id";}

  if (msg.ttl === undefined) {msg.ttl = 0;}
  else if (!Number.isInteger(msg.ttl) || msg.ttl < 0) {return "ttl";}

  if (msg.offset === undefined) {msg.offset = 0;}
  else if (!Number.isInteger(msg.offset) || msg.offset < 0) {return "offset";}

  if (msg.values === undefined) {msg.values = [];}
  else if (!Array.isArray(msg.values)) {return "values";}

  msg.key = atob(msg.key);
  msg.id = atob(msg.id);
  msg.values = msg.values.map(atob);
  return "";
}

class RendezqueueJsonImpl {
  constructor() {
    this.swapstore = new SwapStore();
  }

  TrySwap(msg, now_ms = null) {
    if (!msg) {
      return 400;
    }
    let key = msg.key;
    let id = msg.id;
    let offset = msg.offset;
    let values = msg.values;

    if (key.length > MAX_KEY_BYTES) {
      return 413;
    }

    if (id.length > MAX_ID_BYTES) {
      return 413;
    }

    if (values.reduce(((p, v) => p + v.length), 0) > MAX_VALUE_BYTES) {
      return 413;
    }

    if (now_ms !== null) {
      let hrtime_now = process.hrtime();
      let now_ms = hrtime_now[0] * 1e3 + hrtime_now[1] / 1.0e9;
      if (now_ms == 0) {
        // When would this actually return 0?
        return 500;
      }
    }

    return this.swapstore.tryswap(key, id, offset, values, now_ms, msg.ttl);
  }

  TrySwap_string(request_text) {
    let msg = undefined;
    try {
      msg = JSON.parse(request_text);
      const e = inplace_decode_tryswap_message(msg);
      if (e) {throw e;}
    }
    catch (e) {
      console.log(e);
      msg = null;
    }

    let result = this.TrySwap(msg);
    if (Number.isInteger(result)) {
      return result;
    }
    result.key = btoa(result.key);
    result.id = btoa(result.id);
    if (result.values) {
      result.values = result.values.map(btoa);
    }
    return JSON.stringify(result);
  }
}

exports.RendezqueueJsonImpl = RendezqueueJsonImpl;
exports.inplace_decode_tryswap_message = inplace_decode_tryswap_message;
