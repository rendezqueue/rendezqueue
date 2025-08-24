"use strict";
const SWAPSTORE_PATH = __dirname + "/../../src/nodejson/swapstore";

const assert = require("assert").strict;
const SwapStore = require(SWAPSTORE_PATH).SwapStore;

var swapstore = new SwapStore();

function tryswap_single(key, sid, value) {
  return swapstore.tryswap(key, sid, 0, [value], 1);
}

var res;
res = tryswap_single("mykey", "5sid", "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.sid, "5sid");
assert(res.ttl > 0);

res = tryswap_single("mykey", "5sid", "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.sid, "5sid");

res = tryswap_single("mykey", "6sid", "my6value");
assert.equal(res.key, "mykey");
assert.equal(res.sid, "6sid");
assert.equal(res.values[0], "my5value");

swapstore.print_unmatched();
swapstore.print_swapped();

res = tryswap_single("mykey", "5sid", "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.values[0], "my6value");

res = tryswap_single("mykey", "8sid", "my8value");
assert.equal(res.key, "mykey");
assert.equal(res.sid, "8sid");

res = swapstore.tryswap("mykey", "9sid", 0, ["my9value"], swapstore.ttl + 2);
assert.equal(res.key, "mykey");
assert.equal(res.values[0], "my8value");


res = swapstore.tryswap("kk", "1sid", 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.sid, "1sid");
assert.equal(res.offset, 0);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", "2sid", 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.sid, "2sid");
assert.equal(res.offset, 0);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", "1sid", 0, ["hii"], 1);
assert.equal(res.key, "kk");
assert.equal(res.sid, "1sid");
assert.equal(res.offset, 1);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", "2sid", 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.sid, "2sid");
assert.equal(res.offset, 0);
assert.equal(res.values.length, 1);
res = swapstore.tryswap("kk", "1sid", 1, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.sid, "1sid");
assert.equal(res.offset, 1);
assert.ok(!("values" in res));

swapstore.expire_unmatched_offers(30000);

swapstore.print_unmatched();
swapstore.print_swapped();
