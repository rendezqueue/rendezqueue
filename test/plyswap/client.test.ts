import { strict as assert } from "assert";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "url";
import { test, vi } from "vitest";
import * as http from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { RendezqueueClient, ClientState } from "../../src/client.js";
import { Message } from "../../src/plyswap.js";
import { PlySwapCache } from "../../src/plyswap_cache.js";
import { RESPONSE_LIMIT, REJECTION, decodeRequest, encodeResponse } from "../../src/plyswap_wire.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server_path = path.join(__dirname, "../../dist/src/server/main.js");

async function waitForFile(filePath: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      if (fs.readFileSync(filePath, "utf8").trim() !== "") {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForMessages(received: string[], count: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (received.length >= count) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${count} messages (got ${received.length})`);
}

async function main(): Promise<void> {
  const tmpDir = process.env.TEST_TMPDIR || os.tmpdir();
  const portFile = path.join(tmpDir, `plyswap_client_portfile.${process.pid}`);
  try {
    fs.unlinkSync(portFile);
  } catch {
    // ignore
  }

  let server: ChildProcess | undefined;
  let alice: RendezqueueClient | undefined;
  let bob: RendezqueueClient | undefined;
  try {
    // Default server: PlySwap at /.
    server = spawn(
      process.execPath,
      [server_path, "--http_port=0", `--o-http-port=${portFile}`, "--http_host=127.0.0.1"],
      { stdio: "ignore" },
    );
    await waitForFile(portFile);
    const port = fs.readFileSync(portFile, "utf8").trim();
    const backend_url = `http://127.0.0.1:${port}/`;
    const room = "test-room-" + Math.random();

    const alice_received: string[] = [];
    const bob_received: string[] = [];
    const alice_deliveries: string[][] = [];
    const bob_deliveries: string[][] = [];
    alice = new RendezqueueClient({
      url: backend_url,
      room,
      hue: "Alice",
      on_data: data => {
        alice_received.push(...data);
        alice_deliveries.push(data);
      },
      poll_interval_ms: 200,
    });
    bob = new RendezqueueClient({
      url: backend_url,
      room,
      hue: "Bob",
      on_data: data => {
        bob_received.push(...data);
        bob_deliveries.push(data);
      },
      poll_interval_ms: 200,
    });
    alice.start();
    bob.start();

    alice.send("A1");
    alice.send("A2");
    bob.send("B1");

    await waitForMessages(bob_received, 2);
    assert.deepStrictEqual(bob_deliveries, [["A1", "A2"]]);
    await waitForMessages(alice_received, 1);
    assert.deepStrictEqual(alice_deliveries, [["B1"]]);

    // Second generation both ways.
    bob.send("B2");
    alice.send("A3");
    await waitForMessages(alice_received, 2);
    assert.deepStrictEqual(alice_deliveries[1], ["B2"]);
    await waitForMessages(bob_received, 3);
    assert.deepStrictEqual(bob_deliveries[1], ["A3"]);

    // Isolation: a client in another room hears nothing.
    const outsider_received: string[] = [];
    const outsider = new RendezqueueClient({
      url: backend_url,
      room: room + "-other",
      hue: "Eve",
      on_data: data => {
        outsider_received.push(...data);
      },
      poll_interval_ms: 200,
    });
    outsider.start();
    try {
      outsider.send("hello?");
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.deepStrictEqual(outsider_received, []);
    } finally {
      outsider.stop();
    }
  } finally {
    if (alice) alice.stop();
    if (bob) bob.stop();
    if (server) {
      server.kill();
    }
    try {
      fs.unlinkSync(portFile);
    } catch {
      // ignore
    }
  }
}

test("plyswap client integration", main);

test("retains a frozen batch and queued tail through reference expiry", () => {
  let now = 0;
  const cache = new PlySwapCache(20, () => now);
  const client = new ClientState("a");
  const turn = () => {
    const packet = client.send("current");
    assert.ok(packet);
    const reply = cache.serve("room", packet.request);
    return client.accept(packet, reply?.message ?? null);
  };
  cache.serve("room", new Message({ self: "b" }));
  turn();
  assert.equal(client.peer, "b");
  client.enqueue("");
  turn();
  assert.equal(client.currentCached, true);
  client.enqueue("tail");

  now = 21;
  cache.sweep();
  const reference = client.send("current");
  assert.ok(reference);
  assert.equal(reference.request.isReference(), true);
  assert.equal(cache.serve("room", reference.request), null);
  client.accept(reference, null);
  const recovery = client.send("current");
  assert.ok(recovery);
  assert.deepEqual(recovery.request.values, [""]);
  const recovered = cache.serve("room", recovery.request);
  assert.ok(recovered);
  client.accept(recovery, recovered.message);
  cache.serve("room", new Message({ self: "b", peer: "a#0", next: "b1", values: ["reply"] }));
  assert.deepEqual(turn(), { values: ["reply"], generation: 1 });
  assert.equal(client.currentAdvertised, false);
  assert.deepEqual(client.stored(), ["", "tail"]);
  const next = client.send("current");
  assert.ok(next);
  assert.deepEqual(next.request.values, ["tail"]);
  const nextReply = cache.serve("room", next.request);
  assert.ok(nextReply);
  client.accept(next, nextReply.message);
  assert.equal(client.currentAdvertised, true);
});

test("rejects non-byte input before it enters the retained queue", () => {
  const client = new ClientState("a");
  client.enqueue("\u0000\u00ff");
  assert.throws(() => client.enqueue("hello 👋"));
  assert.deepEqual(client.stored(), ["\u0000\u00ff"]);
});

test("does not redirect a retained request to another endpoint", async () => {
  let redirect = true;
  let forwarded = 0;
  const seen: string[] = [];
  const cache = new PlySwapCache();
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/other") forwarded++;
    const envelope = decodeRequest(body);
    seen.push(envelope.message.self);
    if (redirect) {
      res.writeHead(307, { Location: "/other" });
      res.end();
    } else {
      res.setHeader("Content-Type", "application/json");
      const reply = cache.serve(envelope.room, envelope.message);
      assert.ok(reply);
      res.end(encodeResponse(reply, 7));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const errors: unknown[] = [];
    const client = new RendezqueueClient({
      url: `http://127.0.0.1:${port}/fixed`, room: "r", hue: "a",
      on_data: () => assert.fail("unexpected delivery"), on_error: e => errors.push(e),
    });
    await client._poll();
    assert.equal(forwarded, 0);
    assert.equal(errors.length, 1);
    assert.equal(client.currentAdvertised, false);
    redirect = false;
    await client._poll();
    assert.equal(client.currentAdvertised, true);
    assert.deepEqual(seen, [seen[0], seen[0]]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("exchanges through HTTP compression using fetch's decoded response stream", async () => {
  const cache = new PlySwapCache();
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const envelope = decodeRequest(body);
    const reply = cache.serve(envelope.room, envelope.message);
    const encoded = gzipSync(reply ? encodeResponse(reply, 7) : REJECTION);
    res.writeHead(reply ? 200 : 409, {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "Content-Length": encoded.length,
    });
    res.end(encoded);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/`;
    const errors: unknown[] = [];
    const aliceReceived: string[] = [];
    const bobReceived: string[] = [];
    const alice = new RendezqueueClient({ url, room: "r", hue: "a",
      on_data: values => aliceReceived.push(...values), on_error: e => errors.push(e) });
    const bob = new RendezqueueClient({ url, room: "r", hue: "b",
      on_data: values => bobReceived.push(...values), on_error: e => errors.push(e) });
    alice.send("hello through compression");
    bob.send("reply through compression");
    await alice._poll();
    await bob._poll();
    await alice._poll();
    await bob._poll();
    await alice._poll();
    await bob._poll();
    assert.deepEqual(errors, []);
    assert.deepEqual(aliceReceived, ["reply through compression"]);
    assert.deepEqual(bobReceived, ["hello through compression"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("only the exact 409 body is a protocol rejection", async () => {
  let body = "\uFEFF" + REJECTION;
  vi.stubGlobal("fetch", async () => new Response(body, {
    status: 409, headers: { "Content-Type": "application/json" },
  }));
  try {
    const errors: unknown[] = [];
    const client = new RendezqueueClient({
      url: "http://localhost/", room: "r", hue: "a",
      on_data: () => assert.fail("unexpected delivery"), on_error: e => errors.push(e),
    });
    await client._poll();
    assert.equal(errors.length, 1);
    body = REJECTION;
    await client._poll();
    assert.equal(errors.length, 1);
    body = REJECTION + " ";
    await client._poll();
    assert.equal(errors.length, 2);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("cancels an oversized response before waiting for its end", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(RESPONSE_LIMIT));
      controller.enqueue(new Uint8Array(1));
      // Never closes: checking size only after text() would hang.
    },
    cancel() {
      cancelled = true;
    },
  });
  vi.stubGlobal("fetch", async () => new Response(stream, {
    headers: { "Content-Type": "application/json" },
  }));
  try {
    const errors: unknown[] = [];
    const client = new RendezqueueClient({
      url: "http://localhost/", room: "r", hue: "a",
      on_data: () => assert.fail("unexpected delivery"), on_error: e => errors.push(e),
    });
    await client._poll();
    assert.equal(cancelled, true);
    assert.equal(errors.length, 1);
    assert.equal(client.is_polling, false);
    assert.equal(client.currentAdvertised, false);
  } finally {
    vi.unstubAllGlobals();
  }
});
