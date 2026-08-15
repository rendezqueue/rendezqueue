
import { strict as assert } from "assert";
import { SwapStore } from "../../src/server/swapstore.js";
import { test } from "vitest";

test("swapstore basic operations", () => {
  const swapstore = new SwapStore();

  function tryswap_single(key: string, sid: string, value: string) {
    return swapstore.tryswap(key, sid, 0, [value], 1);
  }

  // Helper to cast result to expected object type for testing
  function asObj(res: any) {
    if (typeof res === "number") {
      throw new Error(`Expected object but got number: ${res}`);
    }
    return res;
  }

  let res: any;
  res = tryswap_single("mykey", "5sid", "my5value");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).sid, "5sid");
  assert(asObj(res).ttl > 0);

  res = tryswap_single("mykey", "5sid", "my5value");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).sid, "5sid");

  res = tryswap_single("mykey", "6sid", "my6value");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).sid, "6sid");
  assert.equal(asObj(res).values[0], "my5value");

  res = tryswap_single("mykey", "5sid", "my5value");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).values[0], "my6value");

  res = tryswap_single("mykey", "8sid", "my8value");
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).sid, "8sid");

  res = swapstore.tryswap("mykey", "9sid", 0, ["my9value"], swapstore.ttl + 2);
  assert.equal(asObj(res).key, "mykey");
  assert.equal(asObj(res).values[0], "my8value");


  res = swapstore.tryswap("kk", "1sid", 0, [], 1);
  assert.equal(asObj(res).key, "kk");
  assert.equal(asObj(res).sid, "1sid");
  assert.equal(asObj(res).offset, 0);
  assert.ok(!("values" in asObj(res)));
  res = swapstore.tryswap("kk", "2sid", 0, [], 1);
  assert.equal(asObj(res).key, "kk");
  assert.equal(asObj(res).sid, "2sid");
  assert.equal(asObj(res).offset, 0);
  assert.ok(!("values" in asObj(res)));
  res = swapstore.tryswap("kk", "1sid", 0, ["hii"], 1);
  assert.equal(asObj(res).key, "kk");
  assert.equal(asObj(res).sid, "1sid");
  assert.equal(asObj(res).offset, 1);
  assert.ok(!("values" in asObj(res)));
  res = swapstore.tryswap("kk", "2sid", 0, [], 1);
  assert.equal(asObj(res).key, "kk");
  assert.equal(asObj(res).sid, "2sid");
  assert.equal(asObj(res).offset, 0);
  assert.equal(asObj(res).values.length, 1);
  res = swapstore.tryswap("kk", "1sid", 1, [], 1);
  assert.equal(asObj(res).key, "kk");
  assert.equal(asObj(res).sid, "1sid");
  assert.equal(asObj(res).offset, 1);
  assert.ok(!("values" in asObj(res)));

  swapstore.expire_unmatched_offers(30000);
});

test("an accessed expired offer is not swapped when cleanup is blocked", () => {
  const swapstore = new SwapStore();

  swapstore.tryswap("blocker", "a", 0, ["live"], 0, 20);
  swapstore.tryswap("target", "b", 0, ["stale"], 0, 1);

  const result = swapstore.tryswap("target", "c", 0, ["fresh"], 1000, 1);
  assert.notEqual(typeof result, "number");
  if (typeof result === "number") return;
  assert.equal(result.offset, 1);
  assert.equal(result.ttl, 1);
  assert.ok(!result.values);
  assert.equal(swapstore.unmatched_offer_map.get("target")?.sid, "c");
  assert.deepStrictEqual(swapstore.unmatched_offer_map.get("target")?.values, ["fresh"]);
});

test("an accessed expired answer is not returned when cleanup is blocked", () => {
  const swapstore = new SwapStore();

  swapstore.tryswap("blocker", "a", 0, ["live"], 0, 20);
  swapstore.tryswap("target", "b", 0, ["from-b"], 0, 1);
  swapstore.tryswap("target", "c", 0, ["from-c"], 0, 1);

  const result = swapstore.tryswap("target", "b", 1, [], 1000, 1);
  assert.equal(result, 404);
});
