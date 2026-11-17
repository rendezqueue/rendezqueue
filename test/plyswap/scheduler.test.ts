import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test, vi } from "vitest";
import { RendezqueueClient } from "../../src/client.js";
import { Message } from "../../src/plyswap.js";
import { PlySwapCache } from "../../src/plyswap_cache.js";
import { decodeRequest, encodeResponse, REJECTION } from "../../src/plyswap_wire.js";

function harness() {
  let cache = new PlySwapCache();
  const clients: RendezqueueClient[] = [];
  const requests: Message[] = [];
  const h = {
    clients, requests,
    after: (_request: Message, response: Response): Response => response,
    clearCache() {
      cache = new PlySwapCache(); 
    },
    client(hue: string) {
      const received: string[][] = [];
      const errors: unknown[] = [];
      const client = new RendezqueueClient({
        url: "http://unused/", room: "r", hue, poll_interval_ms: 1000,
        on_data: values => received.push(values), on_error: error => errors.push(error),
      });
      clients.push(client);
      return { client, received, errors };
    },
    holdBody() {
      let release!: () => void;
      const after = h.after;
      h.after = (_request, response) => {
        h.after = after;
        assert.ok(response.body);
        const reader = response.body.getReader();
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            release = () => {
              void (async () => {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
                controller.close();
              })();
            };
          },
        }), { status: response.status, headers: response.headers });
      };
      return () => release();
    },
  };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { room, message } = decodeRequest(init.body as string);
    requests.push(message);
    const reply = cache.serve(room, message);
    return h.after(message, new Response(reply ? encodeResponse(reply, 7) : REJECTION, {
      status: reply ? 200 : 409, headers: { "Content-Type": "application/json" },
    }));
  });
  return h;
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  h = harness();
});
afterEach(() => {
  h.clients.forEach(client => client.stop());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Allow immediate timer turns, without reaching the 1000 ms polling interval.
const settle = () => vi.advanceTimersByTimeAsync(10);
async function opening(a: RendezqueueClient, b: RendezqueueClient) {
  await a._poll();
  await b._poll();
  await a._poll();
}
async function readyCompletion() {
  const a = h.client("a"), b = h.client("b");
  a.client.send("a");
  b.client.send("b");
  await opening(a.client, b.client);
  await b.client._poll();
  return { a, b };
}

test("discovery, receipt and callback reply all publish before idle", async () => {
  const a = h.client("a"), b = h.client("b");
  await b.client._poll();
  await a.client._poll();
  a.client.send("request");
  await a.client._poll();
  b.client.on_data = values => {
    b.received.push(values);
    b.client.send("response");
  };
  const before = h.requests.length;
  b.client.start();
  await settle();
  const requests = h.requests.slice(before);
  assert.ok(requests.some(request => request.values[0] === "response"));
  assert.deepEqual(b.received, [["request"]]);
  for (let i = 0; i < 4; i++) await a.client._poll();
  assert.deepEqual(a.received.flat(), ["response"]);
  assert.deepEqual([...a.errors, ...b.errors], []);
  const parked = h.requests.length;
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(h.requests.length, parked);
});

test.each([false, true])("input wakes idle or pending EMPTY body (held=%s)", async held => {
  const a = h.client("a"), b = h.client("b");
  await opening(a.client, b.client);
  const release = held ? h.holdBody() : () => {};
  a.client.start();
  await settle();
  const before = h.requests.length;
  a.client.send("first");
  a.client.send("second");
  if (held) {
    await a.client._poll();
    assert.equal(h.requests.length, before);
    assert.equal(a.client.is_polling, true);
  }
  release();
  await settle();
  assert.deepEqual(h.requests.at(-1)?.values, ["first", "second"]);
  assert.equal(h.requests.length, before + 1);
  a.client.send("behind frozen batch");
  await settle();
  assert.equal(h.requests.length, before + 1);
  assert.deepEqual(a.errors, []);
});

test("idle private polls and unmatched input do not create speculative retries", async () => {
  const a = h.client("a");
  a.client.start();
  await settle();
  for (let i = 0; i < 5; i++) {
    a.client.send("waiting for peer");
    await a.client._poll();
  }
  await settle();
  assert.equal(h.requests.length, 1);
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(h.requests.length, 2);
});

test("new input and legacy private poll nudges cannot bypass an error delay", async () => {
  const a = h.client("a"), b = h.client("b");
  await opening(a.client, b.client);
  h.after = () => new Response("unavailable", { status: 503 });
  a.client.start();
  await settle();
  const before = h.requests.length;
  a.client.send("fresh input");
  await a.client._poll();
  await settle();
  assert.equal(h.requests.length, before);
  assert.equal(a.errors.length, 1);
  h.after = (_request, response) => response;
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(h.requests.at(-1)?.values, ["fresh input"]);
  assert.equal(h.requests.length, before + 1);
});

test.each(["stop", "restart", "throw"])("callback %s preserves ownership and pacing", async action => {
  const { a } = await readyCompletion();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  a.client.on_data = values => {
    a.received.push(values);
    a.client.send("tail");
    void a.client._poll();
    if (action !== "stop") queueMicrotask(() => {
      void a.client._poll(); 
    });
    if (action === "throw") throw new Error("data observer");
    a.client.stop();
    if (action === "restart") a.client.start();
  };
  a.client.on_error = error => {
    a.errors.push(error);
    a.client.stop();
    a.client.start();
    queueMicrotask(() => {
      void a.client._poll(); 
    });
    throw new Error("error observer");
  };
  const before = h.requests.length;
  a.client.start();
  await settle();
  assert.deepEqual(a.received, [["b"]]);
  assert.equal(h.requests.length, before + 1);
  assert.equal(a.errors.length, action === "throw" ? 1 : 0);
  assert.equal(consoleError.mock.calls.length, action === "throw" ? 1 : 0);
  const parked = h.requests.length;
  await vi.advanceTimersByTimeAsync(1000);
  if (action === "stop") {
    assert.equal(h.requests.length, parked);
    assert.equal(vi.getTimerCount(), 0);
  } else {
    assert.deepEqual(h.requests.slice(before + 1).map(request => request.values), [["tail"]]);
  }
});

test.each([false, true])("stop during owned body still delivers; replacement=%s", async restart => {
  const { a } = await readyCompletion();
  const release = h.holdBody();
  a.client.start();
  await settle();
  const before = h.requests.length;
  a.client.send("tail");
  a.client.stop();
  if (restart) a.client.start();
  await a.client._poll();
  assert.equal(h.requests.length, before);
  release();
  await settle();
  assert.deepEqual(a.received, [["b"]]);
  assert.equal(h.requests.length, before);
  assert.equal(a.client.is_polling, false);
  await vi.advanceTimersByTimeAsync(1000);
  if (restart) assert.deepEqual(h.requests.at(-1)?.values, ["tail"]);
  else assert.equal(h.requests.length, before);
});

test("reference repair precedes input queued during its response", async () => {
  const { a } = await readyCompletion();
  a.client.start();
  await settle();
  h.clearCache();
  const release = h.holdBody();
  const before = h.requests.length;
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(h.requests.at(-1)?.isReference(), true);
  a.client.send("fresh input");
  release();
  await settle();
  const requests = h.requests.slice(before);
  assert.equal(requests[0].isReference(), true);
  assert.equal(requests[1].self, requests[0].self);
  assert.deepEqual(requests[1].values, ["a"]);
  assert.deepEqual(requests[2].values, ["fresh input"]);
  assert.deepEqual(a.errors, []);
});

test("paused clients retain their batch and tail across complete cache expiry", async () => {
  const a = h.client("a"), b = h.client("b");
  await opening(a.client, b.client);
  a.client.send("first");
  a.client.start();
  await settle();
  a.client.send("tail");
  a.client.stop();
  const before = h.requests.length;
  await vi.advanceTimersByTimeAsync(21_000);
  assert.equal(h.requests.length, before);
  a.client.start();
  b.client.start();
  await vi.advanceTimersByTimeAsync(5000);
  assert.deepEqual(b.received.flat(), ["first", "tail"]);
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test("a stale timer cannot poll or orphan a replacement run's timer", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const { client } = h.client("a");
  client.start();
  await settle();
  const stale = timers.mock.calls.at(-1)?.[0];
  assert.equal(typeof stale, "function");
  client.stop();
  client.start();
  await settle();
  const before = h.requests.length;
  (stale as () => void)();
  await settle();
  assert.equal(h.requests.length, before);
  assert.equal(vi.getTimerCount(), 1);
  client.stop();
  assert.equal(vi.getTimerCount(), 0);
});

test("long intervals do not overflow into repeated short timer wakes", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const { client } = h.client("a");
  client.poll_interval_ms = 2 ** 32;
  client.start();
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(timers.mock.calls.length, 1);
});

test("poll intervals must be finite and positive", () => {
  const { client } = h.client("a");
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => {
      client.poll_interval_ms = value; 
    });
  }
  assert.equal(client.poll_interval_ms, 1000);
});
