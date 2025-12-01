
import { Buffer } from "node:buffer";
import process from "node:process";
import { SwapStore, TrySwapResponse } from "./swapstore.js";

const MAX_KEY_BYTES = 100;
const MAX_ID_BYTES = 100;
const MAX_VALUE_BYTES = 65536;


function btoa(s: string): string {
  return Buffer.from(s, "latin1").toString("base64url");
}
function atob(s: string): string {
  return Buffer.from(s, "base64url").toString("latin1");
}

function inplace_decode_tryswap_message(msg: any): string {
  if (msg.b64 === undefined) {
    msg.b64 = 0;
  } else if (!Number.isInteger(msg.b64) || msg.b64 < 0) {
    return "b64";
  }

  if (msg.ttl === undefined) {
    msg.ttl = 0;
  } else if (!Number.isInteger(msg.ttl) || msg.ttl < 0) {
    return "ttl";
  }

  if (msg.key === undefined) {
    msg.key = "";
  } else if (typeof(msg.key) != "string") {
    return "key";
  }

  if (msg.sid === undefined) {
    msg.sid = "";
  } else if (typeof(msg.sid) != "string") {
    return "sid";
  }

  if (msg.offset === undefined) {
    msg.offset = 0;
  } else if (!Number.isInteger(msg.offset) || msg.offset < 0) {
    return "offset";
  }

  if (msg.values === undefined) {
    msg.values = [];
  } else if (!Array.isArray(msg.values)) {
    return "values";
  }

  if (msg.b64 & 4) {
    msg.key = atob(msg.key);
  }
  if (msg.b64 & 2) {
    msg.sid = atob(msg.sid);
  }
  if (msg.b64 & 1) {
    msg.values = msg.values.map(atob);
  }
  return "";
}

function inplace_encode_tryswap_message(msg: any): void {
  if (msg.b64 & 4) {
    msg.key = btoa(msg.key);
  }
  if (msg.b64 & 2) {
    msg.sid = btoa(msg.sid);
  }
  if (msg.b64 & 1) {
    if (msg.values === undefined) {
      msg.b64 &= ~1;
    } else {
      msg.values = msg.values.map(btoa);
    }
  }

  if (msg.b64 == 0) {
    delete msg.b64;
  }
  if (msg.ttl == 0) {
    delete msg.ttl;
  }
  if (msg.offset == 0) {
    delete msg.offset;
  }
}

class RendezqueueJsonImpl {
  swapstore: SwapStore;
  constructor() {
    this.swapstore = new SwapStore();
  }

  TrySwap(msg: any, now_ms: number | null = null): number | TrySwapResponse {
    if (!msg) {
      return 400;
    }
    let key = msg.key;
    let sid = msg.sid;
    let offset = msg.offset;
    let values = msg.values;

    if (key.length > MAX_KEY_BYTES) {
      return 413;
    }

    if (sid.length > MAX_ID_BYTES) {
      return 413;
    }

    if (values.reduce(((p: number, v: string) => p + v.length), 0) > MAX_VALUE_BYTES) {
      return 413;
    }

    if (now_ms === null) {
      let hrtime_now = process.hrtime();
      now_ms = hrtime_now[0] * 1e3 + hrtime_now[1] / 1.0e6;
      if (now_ms == 0) {
        return 500;
      }
      now_ms = Math.floor(now_ms);
    }

    let result: any = this.swapstore.tryswap(
      key, sid, offset, values,
      now_ms, msg.ttl,
    );
    if (!Number.isInteger(result)) {
      result.b64 = msg.b64;
    }
    return result;
  }

  TrySwap_string(request_text: string): number | string {
    let msg = undefined;
    try {
      msg = JSON.parse(request_text);
      const e = inplace_decode_tryswap_message(msg);
      if (e) {
        throw e;
      }
    } catch (e) {
      console.log(e);
      msg = null;
    }

    let result = this.TrySwap(msg);
    if (typeof result === "number") {
      return result;
    }
    inplace_encode_tryswap_message(result);
    return JSON.stringify(result);
  }
}

export {
  RendezqueueJsonImpl,
  inplace_decode_tryswap_message,
  inplace_encode_tryswap_message,
};
