
import { strict as assert } from "assert";
import { SwapStore } from "../../src/server/swapstore.js";
import { test } from "vitest";

test("tryswap concatenation tests", () => {
  const swapstore = new SwapStore();

  // Helper to cast result to expected object type for testing
  function asObj(res: any) {
    if (typeof res === "number") {
      throw new Error(`Expected object but got number: ${res}`);
    }
    return res;
  }

  let res: any;
  res = swapstore.tryswap("mykey", "9sid", 0, ["a", "b"], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 2);

  res = swapstore.tryswap("mykey", "9sid", 2, [], 1);
  assert.equal(typeof res, "object");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 2);

  res = swapstore.tryswap("mykey", "9sid", 1, [], 1);
  assert.equal(res, 404);

  res = swapstore.tryswap("mykey", "9sid", 1, ["b"], 1);
  assert.equal(typeof res, "object");
  assert.equal(asObj(res).offset, 2);

  // Doesn't match.
  res = swapstore.tryswap("mykey", "9sid", 1, ["c"], 1);
  assert.equal(res, 404);


  res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 4);

  res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 4);

  res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d", "e"], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 5);

  res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d"], 1);
  assert.equal(res, 404);

  res = swapstore.tryswap("mykey", "9sid", 2, ["c", "d", "e"], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 5);

  res = swapstore.tryswap("mykey", "9sid", 5, [], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 5);

  res = swapstore.tryswap("mykey", "2sid", 0, [], 1);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).offset, 0);
  assert.equal(asObj(res).values.length, 5);


  swapstore.expire_unmatched_offers(30000);

  swapstore.print_unmatched();
  swapstore.print_swapped();
});
