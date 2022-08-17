"use strict";
const RENDEZQUEUE_IMPL_PATH = __dirname + "/../../src/nodejson/rendezqueue_json_impl";

const assert = require("assert").strict;
const fs = require("fs");
const rendezqueue_json_impl_exports = require(RENDEZQUEUE_IMPL_PATH);

const RendezqueueJsonImpl = rendezqueue_json_impl_exports.RendezqueueJsonImpl;
const inplace_decode_tryswap_message = rendezqueue_json_impl_exports.inplace_decode_tryswap_message;

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
  let sstat = inplace_decode_tryswap_message(e.req);
  assert.strictEqual(sstat, "");
  if (Number.isInteger(e.delta_ms)) {
    timestamp_ms += e.delta_ms;
  }
  const debug_string = JSON.stringify(e);
  const result = rendezqueue_json_impl.TrySwap(e.req, timestamp_ms);
  if (Number.isInteger(result)) {
    assert.equal(result, e.http_status_code, debug_string);
  } else if (e.res !== undefined) {
    sstat = inplace_decode_tryswap_message(e.res);
    assert.strictEqual(sstat, "");
    if (e.res.ttl == 0) {
      delete e.res.ttl;
    }
    if (e.res.offset == 0) {
      delete e.res.offset;
    }
    if (e.res.values.length == 0) {
      delete e.res.values;
    }
    assert.deepStrictEqual(result, e.res, debug_string);
  } else {
    sstat = inplace_decode_tryswap_message(e.has);
    assert.strictEqual(sstat, "");
    if (e.has.key) {
      assert.strictEqual(result.key, e.has.key, debug_string);
    }
    if (e.has.id) {
      assert.strictEqual(result.id, e.has.id, debug_string);
    }
    if (e.has.ttl) {
      assert.strictEqual(result.ttl, e.has.ttl, debug_string);
    }
    if (e.has.offset) {
      assert.strictEqual(result.offset, e.has.offset, debug_string);
    }
    if (e.has.values.length > 0) {
      assert.deepStrictEqual(result.values, e.has.values, debug_string);
    }
  }
}
