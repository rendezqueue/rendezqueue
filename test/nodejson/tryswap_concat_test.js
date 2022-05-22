"use strict";
const SWAPSTORE_PATH = __dirname + "/../../src/nodejson/swapstore";

const assert = require("assert").strict;
const SwapStore = require(SWAPSTORE_PATH).SwapStore;

var swapstore = new SwapStore();

var res;
res = swapstore.tryswap("mykey", "9id", 0, ["a", "b"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 2);

res = swapstore.tryswap("mykey", "9id", 2, [], 1);
assert.equal(typeof res, "object");
assert.equal(res.key, "mykey");
assert.equal(res.offset, 2);

res = swapstore.tryswap("mykey", "9id", 1, [], 1);
assert.equal(res, 404);

res = swapstore.tryswap("mykey", "9id", 1, ["b"], 1);
assert.equal(typeof res, "object");
assert.equal(res.offset, 2);

// Doesn't match.
res = swapstore.tryswap("mykey", "9id", 1, ["c"], 1);
assert.equal(res, 404);


res = swapstore.tryswap("mykey", "9id", 2, ["c", "d"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 4);

res = swapstore.tryswap("mykey", "9id", 2, ["c", "d"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 4);

res = swapstore.tryswap("mykey", "9id", 2, ["c", "d", "e"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "9id", 2, ["c", "d"], 1);
assert.equal(res, 404);

res = swapstore.tryswap("mykey", "9id", 2, ["c", "d", "e"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "9id", 5, [], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "2id", 0, [], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 0);
assert.equal(res.values.length, 5);


swapstore.expire_unmatched_offers(30000);

swapstore.print_unmatched();
swapstore.print_swapped();
