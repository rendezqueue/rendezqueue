
"use strict";

const assert = require("assert").strict;
const SwapStore = require("./swapstore").SwapStore;

var swapstore = new SwapStore();

var res;
res = swapstore.swap_that("mykey", "5", "my5value", 1);
assert.equal(res.key, "mykey");
assert.equal(res.id, "5");
assert(res.ttl > 0);

res = swapstore.swap_that("mykey", "5", "my5value", 1);
assert.equal(res.key, "mykey");
assert.equal(res.id, "5");

res = swapstore.swap_that("mykey", "6", "my6value", 1);
assert.equal(res.key, "mykey");
assert.equal(res.id, "6");
assert.equal(res.value, "my5value");

swapstore.print_unmatched();
swapstore.print_swapped();

res = swapstore.swap_that("mykey", "5", "my5value", 1);
assert.equal(res.key, "mykey");
assert.equal(res.value, "my6value");

res = swapstore.swap_that("mykey", "8", "my8value", 1);
assert.equal(res.key, "mykey");
assert.equal(res.id, "8");

res = swapstore.swap_that("mykey", "9", "my9value", swapstore.ttl + 2);
assert.equal(res.key, "mykey");
assert.equal(res.value, "my8value");

swapstore.expire_unmatched_offers(30000);

swapstore.print_unmatched();
swapstore.print_swapped();
