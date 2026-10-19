import { strict as assert } from "assert";
import { test } from "vitest";
import { RendezqueueJsonImpl } from "../../src/server/rendezqueue_json_impl.js";

test("rejects non-string values before decoding or changing store state", () => {
  for (const b64 of [0, 1]) {
    for (const value of [null, 1, true, {}, []]) {
      const impl = new RendezqueueJsonImpl();
      impl.TrySwap_string(JSON.stringify({ key: "room", sid: "A", values: ["seed"] }));
      const offers = structuredClone(impl.swapstore.unmatched_offer_map);
      const answers = structuredClone(impl.swapstore.swapped_answer_multimap);
      const result = impl.TrySwap_string(JSON.stringify({
        key: "room", sid: "B", values: ["YQ", value], b64: b64,
      }));
      assert.equal(result, 400);
      assert.deepStrictEqual(impl.swapstore.unmatched_offer_map, offers);
      assert.deepStrictEqual(impl.swapstore.swapped_answer_multimap, answers);
    }
  }
});

test("still accepts empty batches and empty string values", () => {
  for (const b64 of [0, 1]) {
    const impl = new RendezqueueJsonImpl();
    const offered = impl.TrySwap_string(JSON.stringify({
      key: "room", sid: "A", values: [""], b64: b64,
    }));
    assert.equal(typeof offered, "string");
    const paired = impl.TrySwap_string(JSON.stringify({
      key: "room", sid: "B", values: [], b64: b64,
    }));
    assert.equal(typeof paired, "string");
    assert.deepStrictEqual(JSON.parse(paired as string).values, [""]);
  }
});
