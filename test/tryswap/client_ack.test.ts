import { strict as assert } from "assert";
import { afterEach, test, vi } from "vitest";
import { RendezqueueClient } from "../../src/client.js";
import { RendezqueueJsonImpl } from "../../src/server/rendezqueue_json_impl.js";
import { SwapStore } from "../../src/server/swapstore.js";

interface RequestBody {
  key: string;
  sid: string;
  ack?: string;
  offset: number;
  values: string[];
  b64: number;
}

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const server = new RendezqueueJsonImpl();
  const requests: RequestBody[] = [];
  const transport = {
    after: (_request: RequestBody, response: Response): Response => response,
  };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const request: RequestBody = JSON.parse(body);
    requests.push(request);
    const result = server.TrySwap_string(body);
    const response = typeof result === "number"
      ? new Response("rejected", { status: result })
      : new Response(result, { status: 200 });
    return transport.after(request, response);
  });

  function makeClient(hue: string) {
    const state = { received: [] as string[][], completed: 0, errors: [] as unknown[] };
    const client = new RendezqueueClient({
      url: "http://unused", key: "room", hue: hue,
      on_data: values => state.received.push(values),
      on_complete: () => {
        state.completed++;
      },
      on_error: error => state.errors.push(error),
    });
    return { client: client, state: state };
  }
  return { server: server, requests: requests, transport: transport, makeClient: makeClient };
}

async function pair(a: RendezqueueClient, b: RendezqueueClient) {
  await a._poll();
  await b._poll();
  await a._poll();
}

test("ACK-before-next gates offers, retains the confirmed pair, then retires it", async () => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  const own_a = a.client.sid, own_b = b.client.sid;
  a.client.send("a1");
  a.client.send("a2");
  b.client.send("b");
  await pair(a.client, b.client);
  assert.deepStrictEqual(a.state.received, [["b"]]);
  assert.deepStrictEqual(b.state.received, [["a1", "a2"]]);

  a.client.send("tail");
  for (let i = 0; i < 3; ++i) await a.client._poll();
  assert.deepStrictEqual(f.requests.slice(3).map(r => [r.sid, r.ack, r.offset, r.values]), [
    [own_a, own_b, 2, []], [own_a, own_b, 2, []], [own_a, own_b, 2, []],
  ]);
  assert.equal(a.state.completed, 0);
  assert.deepStrictEqual(a.client.outgoing_queue, ["tail"]);

  await b.client._poll();
  await a.client._poll();
  assert.equal(a.state.completed, 1);
  assert.equal(b.state.completed, 1);
  await a.client._poll();
  const next_a = a.client.sid;
  assert.deepStrictEqual(f.requests.at(-1), {
    key: "room", sid: next_a, offset: 0, values: [btoa("tail")], b64: 1,
  });
  await a.client._poll();
  assert.equal(f.requests.at(-1)?.sid, own_a); // Still services the old pair.
  assert.equal(a.state.completed, 1);

  await b.client._poll(); // Next peer receipt, with an empty own batch.
  await a.client._poll(); // Accept that receipt and retire A0/B0.
  assert.deepStrictEqual(a.state.received, [["b"], []]);
  assert.deepStrictEqual(b.state.received, [["a1", "a2"], ["tail"]]);
  await a.client._poll();
  assert.equal(f.requests.at(-1)?.sid, next_a);
  assert.notEqual(f.requests.at(-1)?.ack, own_b);
  assert.deepStrictEqual(a.state.errors, []);
  assert.deepStrictEqual(b.state.errors, []);
});

test("an offered batch is immutable while later sends remain queued", async () => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  a.client.send("first");
  await a.client._poll();
  const offer = f.requests.at(-1);
  a.client.send("tail");
  await a.client._poll();
  assert.deepStrictEqual(f.requests.at(-1), offer);
  b.client.send("peer");
  await b.client._poll();
  await a.client._poll();
  assert.deepStrictEqual(a.client.outgoing_queue, ["tail"]);
  assert.deepStrictEqual(a.state.received, [["peer"]]);
});

test("a send during a lost empty probe waits for a safe reply before changing SID", async () => {
  const f = fixture();
  const a = f.makeClient("A");
  const old_sid = a.client.sid;
  let lost = false;
  f.transport.after = (_request, response) => {
    if (!lost) {
      lost = true;
      a.client.send("queued");
      throw new Error("lost empty probe");
    }
    return response;
  };
  await a.client._poll();
  await a.client._poll();
  assert.equal(f.requests.at(-1)?.sid, old_sid);
  assert.deepStrictEqual(f.requests.at(-1)?.values, []);
  await a.client._poll();
  assert.notEqual(f.requests.at(-1)?.sid, old_sid);
  assert.deepStrictEqual(f.requests.at(-1)?.values, [btoa("queued")]);
});

test("whole reset after asymmetric confirmation recovers the exact pair despite a lost upload reply", async () => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  const own_a = a.client.sid, own_b = b.client.sid;
  a.client.send("a1");
  a.client.send("a2");
  b.client.send("b");
  await pair(a.client, b.client);
  await a.client._poll(); // A gets pending status.
  await b.client._poll(); // Only B has terminal confirmation.
  assert.equal(a.state.completed, 0);
  assert.equal(b.state.completed, 1);
  a.client.send("a-tail");
  b.client.send("b-tail");
  f.server.swapstore = new SwapStore();
  let lost_upload = false;
  f.transport.after = (request, response) => {
    if (!lost_upload && request.sid === own_a && request.ack && request.values.length) {
      lost_upload = true;
      assert.equal(request.offset, 0);
      throw new Error("lost recovery reply");
    }
    return response;
  };

  await a.client._poll(); // ACK-only gets 404; this does not abandon A0/B0.
  await a.client._poll(); // Upload is stored, but its response is lost.
  assert.equal(lost_upload, true);
  assert.equal(a.state.completed, 0);
  await a.client._poll(); // Repeat the exact immutable upload, not a new offer.
  assert.deepStrictEqual(f.requests.at(-1), {
    key: "room", sid: own_a, ack: own_b, offset: 0,
    values: [btoa("a1"), btoa("a2")], b64: 1,
  });
  await b.client._poll(); // Next offer encounters the forced old pair and gets 404.
  await b.client._poll(); // B still has and uploads its old immutable batch.
  assert.deepStrictEqual(f.requests.at(-1), {
    key: "room", sid: own_b, ack: own_a, offset: 0, values: [btoa("b")], b64: 1,
  });
  await a.client._poll();
  assert.equal(a.state.completed, 1);
  assert.equal(b.state.completed, 1);
  assert.deepStrictEqual(a.state.received, [["b"]]);
  assert.deepStrictEqual(b.state.received, [["a1", "a2"]]);
  assert.deepStrictEqual(a.client.outgoing_queue, ["a-tail"]);
  assert.deepStrictEqual(b.client.outgoing_queue, ["b-tail"]);
});

test.each([
  { ack: "other" }, { key: "wrong" }, { sid: "stale" }, { offset: 2 },
  { ack: null }, { values: "" }, { values: {} }, { values: ["unexpected"] },
])("invalid terminal evidence cannot release the next offer: %j", async invalid => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  const own_a = a.client.sid;
  a.client.send("a");
  b.client.send("b");
  await pair(a.client, b.client);
  a.client.send("tail");
  f.transport.after = request => new Response(JSON.stringify({
    key: "room", sid: own_a, ack: own_a, offset: 1, ...invalid,
  }), { status: request.ack ? 200 : 500 });
  await a.client._poll();
  await a.client._poll();
  assert.equal(f.requests.at(-1)?.sid, own_a);
  assert.equal(a.state.completed, 0);
  assert.deepStrictEqual(a.state.received, [["b"]]);
  assert.deepStrictEqual(a.client.outgoing_queue, ["tail"]);
});

test("empty-own ACKs require self-labelled terminal evidence at length zero", async () => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  a.client.send("a");
  await pair(a.client, b.client);
  await b.client._poll(); // Peer-labelled, payload-free pending ACK.
  assert.equal(b.state.completed, 0);
  assert.deepStrictEqual(b.state.received, [["a"]]);
  await a.client._poll();
  await b.client._poll();
  assert.equal(a.state.completed, 1);
  assert.equal(b.state.completed, 1);
  assert.deepStrictEqual(a.state.received, [[]]);
});

test("callback failures do not undo receipt or terminal state", async () => {
  const f = fixture();
  const a = f.makeClient("A"), b = f.makeClient("B");
  a.client.send("a");
  b.client.send("b");
  a.client.on_data = values => {
    a.state.received.push(values);
    throw new Error("receipt callback");
  };
  a.client.on_complete = () => {
    a.state.completed++;
    throw new Error("completion callback");
  };
  await pair(a.client, b.client);
  await a.client._poll();
  await b.client._poll();
  await a.client._poll();
  await a.client._poll();
  await a.client._poll();
  assert.deepStrictEqual(a.state.received, [["b"]]);
  assert.equal(a.state.completed, 1);
  assert.equal(a.state.errors.length, 2);
});

test("base64url response values and SID/ACK flags decode before matching", async () => {
  const f = fixture();
  const a = f.makeClient("A");
  const own = a.client.sid;
  f.transport.after = () => new Response(JSON.stringify({
    key: btoa("room"), sid: btoa(own), ack: "-_8", offset: 1,
    values: ["-_8"], b64: 7,
  }), { status: 200 });
  a.client.send("a");
  await a.client._poll();
  assert.deepStrictEqual(a.state.received, [["\xfb\xff"]]);
  await a.client._poll();
  assert.equal(f.requests.at(-1)?.ack, "\xfb\xff");
});
