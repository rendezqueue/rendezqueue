import { strict as assert } from "assert";
import { test } from "vitest";
import { SwapStore } from "../../src/server/swapstore.js";
import { RendezqueueJsonImpl } from "../../src/server/rendezqueue_json_impl.js";

function pair(store: SwapStore) {
  store.tryswap("room", "A", 0, "", ["a1", "a2"], 0, 5);
  store.tryswap("room", "B", 0, "", ["b"], 0, 5);
}

test("zero-offset recovery returns normal pending status and permits ACK-only polls", () => {
  const store = new SwapStore();
  assert.equal(store.tryswap("room", "A", 2, "B", [], 0, 5), 404);
  const pending = { key: "room", sid: "A", ack: "B", offset: 2 };
  assert.deepStrictEqual(store.tryswap("room", "A", 0, "B", ["a1", "a2"], 0, 5), pending);
  const seeded = structuredClone([store.unmatched_offer_map, store.swapped_answer_multimap]);
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 0, 5), pending);
  assert.deepStrictEqual([store.unmatched_offer_map, store.swapped_answer_multimap], seeded);
  assert.equal(store.tryswap("room", "B", 1, "A", [], 0, 5), 404);
  assert.deepStrictEqual(store.tryswap("room", "B", 0, "A", ["b"], 0, 5), {
    key: "room", sid: "B", ack: "B", offset: 1,
  });
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 0, 5), {
    key: "room", sid: "A", ack: "A", offset: 2,
  });
});

test("ACKs use own lengths and record reciprocal peer evidence", () => {
  const store = new SwapStore();
  pair(store);
  assert.equal(store.tryswap("room", "A", 1, "B", [], 0, 5), 404);
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 0, 5), {
    key: "room", sid: "A", ack: "B", offset: 2,
  });
  assert.deepStrictEqual(store.tryswap("room", "B", 1, "A", [], 0, 5), {
    key: "room", sid: "B", ack: "B", offset: 1,
  });
});

test.each(["offer", "recovery", "answer"])("rejects changed payloads transactionally in %s", state => {
  const store = new SwapStore();
  store.tryswap("room", "A", 0,
    state === "recovery" ? "B" : "", ["a1", "a2"], 0, 5);
  if (state === "answer") store.tryswap("room", "B", 0, "", ["b"], 0, 5);
  const before = structuredClone([store.unmatched_offer_map, store.swapped_answer_multimap]);
  const invalid: [number, string[]][] = [
    [0, ["wrong", "a2"]], [1, []], [0, []], [0, ["a1"]], [2, ["a1", "a2"]], [1, ["a2"]],
  ];
  for (const ack of ["B", "C"]) {
    for (const [offset, values] of invalid) {
      assert.equal(store.tryswap("room", "A", offset, ack, values, 0, 5), 404);
      assert.deepStrictEqual([store.unmatched_offer_map, store.swapped_answer_multimap], before);
    }
  }
});

test("a mismatched cached peer returns 404 without changing live state", () => {
  const store = new SwapStore();
  pair(store);
  store.tryswap("room", "X", 0, "", ["x"], 0, 5);
  store.tryswap("room", "Y", 0, "", ["y"], 0, 5);
  const before = structuredClone([store.unmatched_offer_map, store.swapped_answer_multimap]);
  for (const values of [[], ["a1", "a2"]]) {
    assert.equal(store.tryswap("room", "A", values.length === 0 ? 2 : 0, "C", values, 0, 5), 404);
    assert.deepStrictEqual([store.unmatched_offer_map, store.swapped_answer_multimap], before);
  }
  // The original pair still needs and can receive both directed ACKs.
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 0, 5), {
    key: "room", sid: "A", ack: "B", offset: 2,
  });
  assert.deepStrictEqual(store.tryswap("room", "B", 1, "A", [], 0, 5), {
    key: "room", sid: "B", ack: "B", offset: 1,
  });
});

test.each(["both", "forward-only", "own-offer"])(
  "recovery does not delete a conflicting live pair: %s", state => {
    const store = new SwapStore();
    store.tryswap("room", "B", 0, "", ["b"], 0, 5);
    store.tryswap("room", "C", 0, "", ["c"], 0, 5);
    const answers = store.swapped_answer_multimap.get("room");
    assert.ok(answers);
    if (state === "forward-only") answers.delete("C");
    if (state === "own-offer") store.tryswap("room", "A", 0, "", ["a"], 0, 5);
    const before = structuredClone(store.swapped_answer_multimap);
    const offer = structuredClone(store.unmatched_offer_map.get("room"));

    assert.equal(store.tryswap("room", "A", 0, "B", ["a"], 0, 5), 404);
    assert.deepStrictEqual(store.swapped_answer_multimap, before);
    if (offer?.sid) assert.deepStrictEqual(store.unmatched_offer_map.get("room"), offer);
    else assert.ok(!store.unmatched_offer_map.get("room")?.sid);
  },
);

test("requests, recovery, expiry and SID reuse preserve live-pair invariants", () => {
  const store = new SwapStore();
  // sid, offset, ack, values, time, ttl, expected status.
  const steps: [string, number, string, string[], number, number, number][] = [
    ["X", 0, "", ["x"], 0, 20, 200],
    ["Y", 0, "", ["y"], 0, 20, 200],
    ["A", 0, "", ["a"], 0, 1, 200],
    ["B", 0, "", ["b"], 0, 1, 200],
    ["A", 1, "B", [], 500, 20, 200],
    ["B", 1, "A", [], 500, 20, 200],
    ["A", 1, "B", [], 1000, 1, 404],
    ["A", 0, "B", ["a"], 1000, 1, 200],
    ["B", 0, "A", ["b"], 1000, 1, 200],
    ["A", 1, "B", [], 1000, 1, 200],
    ["A", 0, "", ["a2"], 2000, 1, 200],
    ["C", 0, "", ["c"], 2000, 1, 200],
  ];
  for (const [sid, offset, ack, values, now_ms, ttl, status] of steps) {
    const result = store.tryswap("room", sid, offset, ack, values, now_ms, ttl);
    assert.equal(typeof result === "number" ? result : 200, status);
    const answers = store.swapped_answer_multimap.get("room");
    for (const [own_sid, answer] of answers ?? []) {
      if (answer.expiry_ms <= now_ms) continue;
      const peer = answers?.get(answer.peer_sid);
      assert.equal(peer?.peer_sid, own_sid);
      assert.equal(peer?.expiry_ms, answer.expiry_ms);
    }
    const offer = store.unmatched_offer_map.get("room");
    if (offer?.sid && offer.expiry_ms > now_ms) {
      const answer = answers?.get(offer.sid);
      assert.ok(!answer || answer.expiry_ms <= now_ms);
    }
  }
});

test("expired conflicting records do not block recovery", () => {
  const store = new SwapStore();
  // The live X/Y pair makes the existing best-effort sweep stop before B/C.
  store.tryswap("room", "X", 0, "", ["x"], 0, 20);
  store.tryswap("room", "Y", 0, "", ["y"], 0, 20);
  store.tryswap("room", "B", 0, "", ["b"], 0, 1);
  store.tryswap("room", "C", 0, "", ["c"], 0, 1);
  assert.deepStrictEqual(store.tryswap("room", "A", 0, "B", ["a"], 1000, 5), {
    key: "room", sid: "A", ack: "B", offset: 1,
  });
  assert.deepStrictEqual(store.tryswap("room", "B", 0, "A", ["b"], 1000, 5), {
    key: "room", sid: "B", ack: "B", offset: 1,
  });
});

test("a recovery offer accepts only its peer and cannot grow via a non-ACK retry", () => {
  const store = new SwapStore();
  store.tryswap("room", "A", 0, "B", ["a1", "a2"], 0, 5);
  const before = structuredClone(store.unmatched_offer_map);
  assert.equal(store.tryswap("room", "C", 0, "A", ["c"], 0, 5), 404);
  assert.equal(store.tryswap("room", "A", 2, "C", [], 0, 5), 404);
  assert.equal(store.tryswap("room", "A", 2, "", ["a3"], 0, 5), 404);
  assert.deepStrictEqual(store.unmatched_offer_map, before);
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 0, 5), {
    key: "room", sid: "A", ack: "B", offset: 2,
  });
});

test("genuinely empty payloads can recover and reach terminal evidence", () => {
  const store = new SwapStore();
  store.tryswap("room", "A", 0, "B", [], 0, 5);
  assert.deepStrictEqual(store.tryswap("room", "B", 0, "A", [], 0, 5), {
    key: "room", sid: "B", ack: "B", offset: 0,
  });
  assert.deepStrictEqual(store.tryswap("room", "A", 0, "B", [], 0, 5), {
    key: "room", sid: "A", ack: "A", offset: 0,
  });
});

test("ACK retries do not refresh a pair's expiry when cleanup is blocked", () => {
  const store = new SwapStore();
  // The older, live X/Y pair makes the best-effort sweep stop before A/B.
  store.tryswap("room", "X", 0, "", ["x"], 0, 20);
  store.tryswap("room", "Y", 0, "", ["y"], 0, 20);
  store.tryswap("room", "A", 0, "", ["a1", "a2"], 0, 1);
  store.tryswap("room", "B", 0, "", ["b"], 0, 1);
  assert.deepStrictEqual(store.tryswap("room", "A", 2, "B", [], 999, 20), {
    key: "room", sid: "A", ack: "B", offset: 2,
  });
  assert.deepStrictEqual(store.tryswap("room", "B", 1, "A", [], 999, 20), {
    key: "room", sid: "B", ack: "B", offset: 1,
  });
  assert.equal(store.tryswap("room", "A", 2, "B", [], 1000, 20), 404);
  assert.equal(store.tryswap("room", "B", 1, "A", [], 1000, 20), 404);
});

test("an expired recovery offer cannot authenticate or constrain an ACK", () => {
  const store = new SwapStore();
  store.tryswap("blocker", "X", 0, "", ["x"], 0, 20);
  store.tryswap("room", "A", 0, "B", ["a"], 0, 1);
  assert.equal(store.tryswap("room", "A", 1, "B", [], 1000, 5), 404);
  assert.deepStrictEqual(store.tryswap("room", "A", 0, "C", ["a"], 1000, 5), {
    key: "room", sid: "A", ack: "C", offset: 1,
  });
});

test("ACK pairing and cached retries omit data but retain it for non-ACK retrieval", () => {
  const store = new SwapStore();
  store.tryswap("room", "A", 0, "", ["a1", "a2"], 0, 5);
  for (let i = 0; i < 2; ++i) {
    const result = store.tryswap("room", "B", 0, "A", ["b"], 0, 5);
    assert.ok(typeof result !== "number");
    assert.equal(result.sid, "B");
    assert.equal(result.ack, "A");
    assert.equal(result.offset, 1);
    assert.equal(result.values, undefined);
  }
  assert.deepStrictEqual(store.tryswap("room", "B", 0, "", ["b"], 0, 5), {
    key: "room", sid: "B", ack: "A", offset: 1, values: ["a1", "a2"],
  });
});

test.each([0, 1])("empty peer payloads are omitted but empty-string values survive (b64=%s)", b64 => {
  for (const peer_values of [[], [""]]) {
    const impl = new RendezqueueJsonImpl();
    const request = (sid: string, ack: string, values: string[]) => {
      const result = impl.TrySwap_string(JSON.stringify({
        key: "room",
        sid: sid,
        offset: 0,
        ack: ack,
        values: values,
        b64: b64,
      }));
      assert.ok(typeof result === "string");
      return JSON.parse(result);
    };
    const pending: Record<string, unknown> = { key: "room", sid: "A", ack: "B" };
    if (peer_values.length > 0) pending.offset = peer_values.length;
    assert.deepStrictEqual(request("A", "B", peer_values), pending);
    const expected: Record<string, unknown> = { key: "room", sid: "B", offset: 1, ack: "A" };
    if (peer_values.length > 0) {
      expected.values = peer_values;
      if (b64 !== 0) expected.b64 = b64;
    }
    const own_values = b64 ? ["Yg"] : ["b"];
    assert.deepStrictEqual(request("B", "", own_values), expected);
    assert.deepStrictEqual(request("B", "", own_values), expected);
  }
});

test.each([0, 2])("empty and omitted ACKs stay non-ACK requests (b64=%s)", b64 => {
  for (const ack of [undefined, ""]) {
    const impl = new RendezqueueJsonImpl();
    const a = b64 ? "QQ" : "A";
    const b = b64 ? "Qg" : "B";
    const request = (sid: string, values: string[], offset = 0) => {
      const result = impl.TrySwap_string(JSON.stringify({ key: "room", sid, ack, offset, values, b64 }));
      return typeof result === "string" ? JSON.parse(result) : result;
    };
    const probe = request(a, []);
    assert.equal(probe.sid, a);
    assert.equal(probe.ack, undefined);
    assert.equal(impl.swapstore.unmatched_offer_map.has("room"), false);
    assert.equal(request(a, ["a"]).offset, 1);
    assert.equal(impl.swapstore.unmatched_offer_map.get("room")?.ack, "");
    assert.equal(request(a, ["tail"], 1).offset, 2);
    assert.equal(impl.swapstore.unmatched_offer_map.get("room")?.ack, "");
    assert.deepStrictEqual(request(b, ["b"]).values, ["a", "tail"]);
    const cached = request(a, ["a", "tail"]);
    assert.equal(cached.ack, b);
    assert.equal(cached.offset, 2);
    assert.deepStrictEqual(cached.values, ["b"]);
    assert.deepStrictEqual(
      [...(impl.swapstore.swapped_answer_multimap.get("room")?.values() ?? [])].map(answer => answer.peer_acked),
      [false, false],
    );
  }
});

test("JSON validates, decodes, and forwards ACKs", () => {
  const impl = new RendezqueueJsonImpl();
  const request = (msg: object) => {
    const result = impl.TrySwap_string(JSON.stringify({ key: "room", ...msg }));
    return typeof result === "string" ? JSON.parse(result) : result;
  };
  request({ sid: "A", values: ["a"] });
  request({ sid: "B", values: ["b"] });
  assert.equal(request({ sid: "A", ack: null }), 400);
  assert.equal(request({ sid: "A", ack: 123 }), 400);
  assert.equal(request({ sid: "A", ack: "x".repeat(101) }), 413);
  assert.deepStrictEqual(request({ b64: 2, sid: "QQ", ack: "Qg", offset: 1 }), {
    key: "room", b64: 2, sid: "QQ", ack: "Qg", offset: 1,
  });
  assert.deepStrictEqual(request({ b64: 2, sid: "Qg", ack: "QQ", offset: 1 }), {
    key: "room", b64: 2, sid: "Qg", ack: "Qg", offset: 1,
  });
});
