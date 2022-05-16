"use strict";
const SWAPSTORE_PATH = __dirname + "/../../src/nodejson/swapstore";

const assert = require("assert").strict;
const SwapStore = require(SWAPSTORE_PATH).SwapStore;

var swapstore = new SwapStore();

function tryswap_single(key, id, value) {
  return swapstore.tryswap(key, id, 0, [value], 1);
}

var res;
res = tryswap_single("mykey", 5, "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.id, 5);
assert(res.ttl > 0);

res = tryswap_single("mykey", 5, "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.id, 5);

res = tryswap_single("mykey", 6, "my6value");
assert.equal(res.key, "mykey");
assert.equal(res.id, 6);
assert.equal(res.values[0], "my5value");

swapstore.print_unmatched();
swapstore.print_swapped();

res = tryswap_single("mykey", 5, "my5value");
assert.equal(res.key, "mykey");
assert.equal(res.values[0], "my6value");

res = tryswap_single("mykey", 8, "my8value");
assert.equal(res.key, "mykey");
assert.equal(res.id, 8);

res = swapstore.tryswap("mykey", 9, 0, ["my9value"], swapstore.ttl + 2);
assert.equal(res.key, "mykey");
assert.equal(res.values[0], "my8value");


res = swapstore.tryswap("kk", 1, 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.id, 1);
assert.equal(res.offset, 0);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", 2, 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.id, 2);
assert.equal(res.offset, 0);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", 1, 0, ["hii"], 1);
assert.equal(res.key, "kk");
assert.equal(res.id, 1);
assert.equal(res.offset, 1);
assert.ok(!("values" in res));
res = swapstore.tryswap("kk", 2, 0, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.id, 2);
assert.equal(res.offset, 0);
assert.equal(res.values.length, 1);
res = swapstore.tryswap("kk", 1, 1, [], 1);
assert.equal(res.key, "kk");
assert.equal(res.id, 1);
assert.equal(res.offset, 1);
assert.equal(res.values.length, 0);

swapstore.expire_unmatched_offers(30000);

swapstore.print_unmatched();
swapstore.print_swapped();
