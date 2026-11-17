import { strict as assert } from "assert";
import { describe, it } from "vitest";
import { Message, PlySwap, Record as PlySwapRecord } from "../../src/plyswap.js";
import {
  decodeBytes,
  decodeMessage,
  decodeRequest,
  decodeResponse,
  encodeBytes,
  encodeMessage,
  encodeRequest,
  queryFromTarget,
  InvalidWireError,
  UnknownEndpointError,
} from "../../src/plyswap_wire.js";

const ALL_BYTES = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("");

describe("plyswap wire", () => {
  for (let flags = 0; flags < 8; flags++) {
    it(`bitmap ${flags} preserves all bytes and presence`, () => {
      const message = new Message({
        self: ALL_BYTES,
        peer: "\x00",
        next: "\x00\xff",
        values: ["", [...ALL_BYTES].reverse().join("")],
      });
      const room = ALL_BYTES;
      const body = encodeRequest(message, room, flags);
      const envelope = decodeRequest(body);
      assert.equal(envelope.room, room);
      assert.ok(envelope.message.equals(message));
      assert.equal(envelope.b64, flags);
      assert.ok(decodeMessage(encodeMessage(message, flags)).equals(message));
      const obj = JSON.parse(body) as globalThis.Record<string, unknown>;
      assert.deepStrictEqual(
        Object.keys(obj),
        [...(flags !== 0 ? ["b64"] : []), "room", "self", "peer", "next", "values"],
      );
      assert.equal(obj["b64"] ?? 0, flags);
      const idsEncoded = (flags & 2) !== 0;
      const valuesEncoded = (flags & 1) !== 0;
      assert.equal(obj["self"], idsEncoded ? encodeBytes(message.self) : message.self);
      assert.equal(obj["peer"], idsEncoded ? encodeBytes(message.peer) : message.peer);
      assert.equal(obj["next"], idsEncoded ? encodeBytes(message.next) : message.next);
      assert.equal(obj["room"], (flags & 4) !== 0 ? encodeBytes(room) : room);
      assert.deepStrictEqual(
        obj["values"],
        valuesEncoded
          ? message.values.map(v => encodeBytes(v))
          : [...message.values],
      );
    });
  }

  it("emits fields in b64,room,self,peer,next,values order", () => {
    const message = new Message({ self: "a", peer: "b", next: "a1", values: ["hi"] });
    assert.equal(
      encodeRequest(message, "room"),
      "{\"room\":\"room\",\"self\":\"a\",\"peer\":\"b\",\"next\":\"a1\",\"values\":[\"hi\"]}",
    );
    assert.equal(
      encodeRequest(message, "room", 7),
      "{\"b64\":7,\"room\":\"cm9vbQ\",\"self\":\"YQ\",\"peer\":\"Yg\",\"next\":\"YTE\",\"values\":[\"aGk\"]}",
    );
    assert.equal(
      encodeMessage(new Message({ self: "a", next: "b1", values: ["hi"] })),
      "{\"self\":\"a\",\"next\":\"b1\",\"values\":[\"hi\"]}",
    );
    assert.equal(
      encodeMessage(new Message({ self: "a", next: "b1", values: ["hi"] }), 3),
      "{\"b64\":3,\"self\":\"YQ\",\"next\":\"YjE\",\"values\":[\"aGk\"]}",
    );
  });

  for (const value of ["", "\x00\xff\x80", "hello", ALL_BYTES]) {
    it(`codec roundtrips ${JSON.stringify(value.slice(0, 8))}`, () => {
      assert.equal(decodeBytes(encodeBytes(value)), value);
      const original = new Message({ self: "a", values: ["", value] });
      assert.ok(decodeMessage(encodeMessage(original)).equals(original));
    });
  }

  it("omits empty values and empty peer/next", () => {
    assert.ok(
      decodeMessage("{\"self\":\"a\"}").equals(decodeMessage("{\"self\":\"a\",\"values\":[]}")),
    );
    assert.deepStrictEqual(decodeMessage("{\"self\":\"a\",\"values\":[\"\"]}").values, [""]);
    assert.equal(encodeMessage(new Message({ self: "a" })), "{\"self\":\"a\"}");
  });

  for (
    const body of [
      "null",
      "[]",
      "\"\"",
      "{}",
      "{\"self\":\"\"}",
      "{\"self\":null}",
      "{\"self\":true}",
      "{\"self\":0}",
      "{\"self\":[]}",
      "{\"self\":\"YQ\",\"self\":\"Yg\"}",
      "{\"self\":\"YQ\",\"peer\":\"Yg\",\"peer\":\"Yg\"}",
      "{\"self\":\"YQ\",\"values\":[],\"values\":[]}",
      "{\"self\":\"YQ\",\"next\":\"Yg\",\"next\":\"Yg\"}",
      "{\"self\":\"YQ\",\"values\":null}",
      "{\"self\":\"YQ\",\"values\":\"\"}",
      "{\"self\":\"YQ\",\"values\":[0]}",
      "{\"self\":\"YQ\",\"peer\":null}",
      "{\"self\":\"YQ\",\"next\":false}",
      "{\"self\":\"YQ\",\"ttl\":20}",
      "{\"self\":\"YQ\",\"room\":\"\"}",
      "{\"self\":\"YQ\",\"offset\":0}",
      "{\"self\":\"YQ\"} trailing",
    ]
  ) {
    it(`rejects ${body.slice(0, 40)}`, () => {
      assert.throws(() => decodeMessage(body), InvalidWireError);
    });
  }

  it("rejects raw non-UTF-8 and non-Latin-1 payloads", () => {
    assert.throws(() => decodeMessage(Buffer.from([0x7b, 0x22, 0xff, 0x7d])), InvalidWireError);
    assert.throws(() => decodeMessage(Buffer.from("{\"self\":\"YQ\"}", "utf-16le")), InvalidWireError);
    assert.throws(() => decodeMessage(Buffer.from("\uFEFF" + "{\"self\":\"YQ\"}")), InvalidWireError);
    assert.throws(() => decodeMessage("{\"self\":\"\\u0100\"}"), InvalidWireError);
    assert.throws(() => decodeMessage("{\"self\":\"\\ud800\"}"), InvalidWireError);
    assert.throws(() => decodeMessage("{\"self\":\"a\",\"b64\":0,\"b64\":0}"), InvalidWireError);
  });

  it("rejects non-byte strings instead of truncating them during encoding", () => {
    assert.throws(() => encodeBytes("\u0100"), InvalidWireError);
    assert.throws(() => encodeBytes("\u0100", false), InvalidWireError);
  });

  it("does not guess plain strings as base64", () => {
    assert.ok(
      decodeMessage("{\"self\":\"YQ\",\"values\":[\"aGk\"]}").equals(
        new Message({ self: "YQ", values: ["aGk"] }),
      ),
    );
    assert.ok(
      decodeMessage("{\"self\":\"YQ\",\"values\":[\"aGk\"],\"b64\":3}").equals(
        new Message({ self: "a", values: ["hi"] }),
      ),
    );
  });

  for (const value of ["/w==", "/w", "_w==", "_w"]) {
    it(`accepts base64 variant ${value}`, () => {
      assert.equal(decodeBytes(value), "\xff");
      assert.equal(
        decodeMessage(JSON.stringify({ self: value, b64: 2 })).self,
        "\xff",
      );
      assert.equal(decodeMessage(JSON.stringify({ self: value })).self, value);
    });
  }

  for (const value of ["YR", "_x", "_x==", "A", "YQ=", "YQ===", "YQ\n", "Y=Q=", "@w"]) {
    it(`rejects base64 ${JSON.stringify(value)}`, () => {
      assert.throws(() => decodeBytes(value), InvalidWireError);
      assert.throws(
        () => decodeMessage(JSON.stringify({ b64: 2, self: value })),
        InvalidWireError,
      );
    });
  }

  for (const flags of [true, false, -1, 8, null, "3"]) {
    it(`rejects bitmap ${JSON.stringify(flags)}`, () => {
      assert.throws(
        () => decodeMessage(JSON.stringify({ self: "a", b64: flags })),
        InvalidWireError,
      );
      assert.throws(
        () => encodeRequest(new Message({ self: "a" }), "room", flags as number),
        InvalidWireError,
      );
    });
  }

  it("reads the room from JSON, query, or encoded equivalents", () => {
    const raw = decodeRequest("{\"room\":\"\\u00ff\",\"self\":\"a\"}");
    const encoded = decodeRequest("{\"room\":\"/w==\",\"self\":\"YQ\",\"b64\":6}");
    const query = decodeRequest("{\"self\":\"a\"}", queryFromTarget("/?room=%C3%BF"));
    for (const envelope of [raw, encoded, query]) {
      assert.equal(envelope.room, "\xff");
      assert.ok(envelope.message.equals(new Message({ self: "a" })));
    }
    assert.equal(
      decodeRequest("{\"self\":\"a\",\"b64\":4}", queryFromTarget("/?room=%2Fw%3D%3D")).room,
      "\xff",
    );
    assert.equal(queryFromTarget("/?room=a+b%2Bc%2520"), "a b+c%20");
  });

  for (
    const [body, query] of [
      ["{\"self\":\"a\"}", null],
      ["{\"room\":\"\",\"self\":\"a\"}", null],
      ["{\"room\":null,\"self\":\"a\"}", null],
      ["{\"room\":\"room\",\"room\":\"room\",\"self\":\"a\"}", null],
      ["{\"room\":\"room\",\"self\":\"a\"}", "room"],
      ["{\"self\":\"a\"}", ""],
      ["{\"room\":\"room\",\"self\":\"a\",\"extra\":1}", null],
    ] as Array<[string, string | null]>
  ) {
    it(`rejects room envelope ${body} query=${query}`, () => {
      assert.throws(() => decodeRequest(body, query), InvalidWireError);
    });
  }

  for (
    const target of [
      "/?",
      "/?room",
      "/?key=room",
      "/?room=x&key=x",
      "/?room=x&room=x",
      "/?room=x&extra=y",
      "/?extra=x",
      "/?room=%",
      "/?room=%0G",
      "/?room=%FF",
      "/?room=ÿ",
    ]
  ) {
    it(`rejects query ${target}`, () => {
      assert.throws(() => queryFromTarget(target), InvalidWireError);
    });
  }

  it("routes only the exact endpoint path", () => {
    assert.equal(queryFromTarget("/", "/"), null);
    assert.equal(queryFromTarget("/?room=r", "/"), "r");
    assert.throws(() => queryFromTarget("/other", "/"), UnknownEndpointError);
    assert.throws(() => queryFromTarget("//", "/"), UnknownEndpointError);
    assert.throws(() => queryFromTarget("/#frag", "/"), UnknownEndpointError);
  });

  it("rejects invalid reply shapes", () => {
    assert.throws(
      () => decodeResponse("{\"room\":\"r\",\"self\":\"a\",\"peer\":\"b\",\"next\":\"c\"}"),
      InvalidWireError,
    );
    assert.throws(
      () => decodeResponse("{\"room\":\"r\",\"self\":\"a\",\"values\":[\"x\"]}"),
      InvalidWireError,
    );
  });
});

describe("plyswap core", () => {
  it("discovers newest-first without reordering open polls", () => {
    const core = new PlySwap();
    core.serve(new Message({ self: "a" }));
    core.serve(new Message({ self: "b" }));
    core.serve(new Message({ self: "a" }));
    assert.ok(
      (core.serve(new Message({ self: "c" })) as Message).equals(
        new Message({ self: "c", peer: "b" }),
      ),
    );
    assert.ok([...core.rows.values()].every(row => row.peer === ""));
    core.serve(new Message({ self: "bound", peer: "a" }));
    assert.ok(
      (core.serve(new Message({ self: "bound" })) as Message).equals(
        new Message({ self: "bound", peer: "a" }),
      ),
    );
  });

  it("prefers the first eligible candidate, not the pair minimum", () => {
    const core = new PlySwap();
    core.rows.set("last", new PlySwapRecord({ self: "last" }));
    core.rows.set("directed", new PlySwapRecord({ self: "directed", peer: "own" }));
    core.rows.set("first", new PlySwapRecord({ self: "first" }));
    core.rows.set("blocked", new PlySwapRecord({ self: "blocked", peer: "other" }));
    assert.ok(
      (core.serve(new Message({ self: "own" })) as Message).equals(
        new Message({ self: "own", peer: "first" }),
      ),
    );
    core.rows.delete("first");
    assert.ok(
      (core.serve(new Message({ self: "own" })) as Message).equals(
        new Message({ self: "own", peer: "directed" }),
      ),
    );
  });

  it("requires nonempty IDs and keeps empty payloads sealable", () => {
    assert.throws(() => new Message({ self: "" }), /nonempty/);
    const core = new PlySwap();
    assert.ok(
      (core.serve(new Message({ self: "\x00" })) as Message).equals(
        new Message({ self: "\x00" }),
      ),
    );
  });
});
