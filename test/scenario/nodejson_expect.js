import { strict as assert } from "assert";
import * as fs from "fs";
import process from "node:process";
import {
  RendezqueueJsonImpl,
  inplace_decode_tryswap_message,
  inplace_encode_tryswap_message,
} from "../../src/nodejson/rendezqueue_json_impl.js";

let rendezqueue_json_impl = new RendezqueueJsonImpl();
let timestamp_ms = 0;
let expectations = undefined;

assert.equal(process.argv.length, 3);
try {
  const data = fs.readFileSync(process.argv[2], "utf8");
  const obj = JSON.parse(data);
  expectations = obj.expectations;
} catch (err) {
  assert.fail(err);
}

for (let e of expectations) {
  const debug_string = JSON.stringify(e);
  let sstat = inplace_decode_tryswap_message(e.req);
  assert.strictEqual(sstat, "");
  if (Number.isInteger(e.delta_ms)) {
    timestamp_ms += e.delta_ms;
  }
  let result = rendezqueue_json_impl.TrySwap(e.req, timestamp_ms);
  if (Number.isInteger(result)) {
    assert.equal(result, e.http_status_code, debug_string);
  } else {
    inplace_encode_tryswap_message(result);
    assert.deepStrictEqual(result, e.res, debug_string);
  }
}
