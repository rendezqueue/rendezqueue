
import { strict as assert } from "assert";
import { SwapStore } from "../../src/nodejson/swapstore.js";

var swapstore = new SwapStore();

var res;
res = swapstore.tryswap("mykey", "9sid", 0, ["a", "b"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 2);

res = swapstore.tryswap("mykey", "9sid", 2, [], 1);
assert.equal(typeof res, "object");
assert.equal(res.key, "mykey");
assert.equal(res.offset, 2);

res = swapstore.tryswap("mykey", "9sid", 1, [], 1);
assert.equal(res, 404);

res = swapstore.tryswap("mykey", "9sid", 1, ["b"], 1);
assert.equal(typeof res, "object");
assert.equal(res.offset, 2);

// Doesn't match.
res = swapstore.tryswap("mykey", "9sid", 1, ["c"], 1);
assert.equal(res, 404);


res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 4);

res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 4);

res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d", "e"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
assert.equal(res, 404);

res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d", "e"], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "9sid", 5, [], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 5);

res = swapstore.tryswap("mykey", "2sid", 0, [], 1);
assert.equal(res.key, "mykey");
assert.equal(res.offset, 0);
assert.equal(res.values.length, 5);


swapstore.expire_unmatched_offers(30000);

swapstore.print_unmatched();
swapstore.print_swapped();
