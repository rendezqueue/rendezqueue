
import { strict as assert } from "assert";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "url";
import { RendezqueueClient } from "../../src/client.js";
import { test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nodejson_server_path = process.argv[2] || path.join(__dirname, "../../dist/src/server/main.js");

async function waitForFile(filePath: string) {
  while (true) {
    try {
      if (fs.readFileSync(filePath, "utf8").trim() !== "") {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Helper to wait for a specific number of messages to be received.
async function waitForMessages(received_array: string[], count: number) {
  while (received_array.length < count) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function main() {
  const tmpDir = process.env.TEST_TMPDIR || os.tmpdir();
  const nodejson_port_file = path.join(tmpDir, `nodejson_portfile.${process.pid}`);

  let nodejson_server: ChildProcess | undefined;
  let alice_client: RendezqueueClient | undefined;
  let bob_client: RendezqueueClient | undefined;

  try {
    // Start nodejson server
    const http_host = "127.0.0.1";
    const http_path = "/test-tryswap-path";
    nodejson_server = spawn(
      process.execPath, // node executable
      [nodejson_server_path, "--http_port=0", `--o-http-port=${nodejson_port_file}`, `--http_host=${http_host}`, `--http_path=${http_path}`],
      { stdio: "ignore" }
    );

    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_file);
    const nodejson_port = fs.readFileSync(nodejson_port_file, "utf8").trim();

    const backend_url = `http://${http_host}:${nodejson_port}${http_path}`;
    const room_key = "test-room-" + Math.random();

    const alice_received: string[] = [];
    const bob_received: string[] = [];

    alice_client = new RendezqueueClient({
      url: backend_url,
      key: room_key,
      hue: "Alice",
      on_data: (data: string[]) => {
        alice_received.push(...data);
      },
      poll_interval_ms: 200, // Use a slightly longer poll interval for stability
    });

    bob_client = new RendezqueueClient({
      url: backend_url,
      key: room_key,
      hue: "Bob",
      on_data: (data: string[]) => {
        bob_received.push(...data);
      },
      poll_interval_ms: 200,
    });

    alice_client.start();
    bob_client.start();

    // Steps 1 & 2: Alice sends "A1", then "A2".
    alice_client.send("A1");
    alice_client.send("A2");

    // Step 3: Bob sends "B1", swaps with Alice's offer.
    bob_client.send("B1");
    await waitForMessages(bob_received, 2);
    assert.deepStrictEqual(bob_received, ["A1", "A2"]);

    // Step 7 (implicit): Alice polls and gets Bob's "B1".
    await waitForMessages(alice_received, 1);
    assert.deepStrictEqual(alice_received, ["B1"]);

    // At this point, the first exchange is complete. Both clients have started a new session.

    // Step 5 & 6: Bob sends "B2", then "B3".
    bob_client.send("B2");
    bob_client.send("B3");

    // Step 8: Alice sends "A3" and gets Bob's pending messages.
    alice_client.send("A3");
    await waitForMessages(alice_received, 3); // B1 + B2 + B3
    assert.deepStrictEqual(alice_received.sort(), ["B1", "B2", "B3"].sort());

    // Step 11: Bob polls and gets Alice's "A3".
    await waitForMessages(bob_received, 3); // A1 + A2 + A3
    assert.deepStrictEqual(bob_received.sort(), ["A1", "A2", "A3"].sort());

    // Second exchange complete.

    // Step 9 & 10: Alice sends "A4", then "A5".
    alice_client.send("A4");
    alice_client.send("A5");

    // Step 12: Bob polls, starts a new session, and swaps with Alice's pending offer.
    // Bob's client will do this automatically. We just need to wait for the messages.
    await waitForMessages(bob_received, 5); // A1-A3 + A4 + A5
    assert.deepStrictEqual(bob_received.sort(), ["A1", "A2", "A3", "A4", "A5"].sort());

    // Step 13: Alice polls to get the result of her swap. She gets nothing back, but the session is closed.
    // The client should handle this and start a new session. We can't directly test this part without
    // more introspection into the client, but the next step will fail if it's not working.

  } finally {
    if (alice_client) alice_client.stop();
    if (bob_client) bob_client.stop();
    if (nodejson_server) {
      nodejson_server.kill();
    }
    if (fs.existsSync(nodejson_port_file)) {
      fs.unlinkSync(nodejson_port_file);
    }
  }
}

test("client integration tests", main);

test("terminal response preserves an unacknowledged snapshot tail", async () => {
  const original_fetch = globalThis.fetch;
  const received: string[][] = [];
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      offset: 1,
      values: [btoa("peer")],
      b64: 1,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    const client = new RendezqueueClient({
      url: "http://unused",
      key: "key",
      hue: "hue",
      on_data: values => received.push(values),
    });
    client.offset = 1;
    client.send("queued-after-offer");
    const old_sid = client.sid;

    await client._poll();

    assert.notEqual(client.sid, old_sid);
    assert.equal(client.offset, 0);
    assert.deepStrictEqual(client.outgoing_queue, ["queued-after-offer"]);
    assert.deepStrictEqual(received, [["peer"]]);
  } finally {
    globalThis.fetch = original_fetch;
  }
});

test("a response from a superseded session is ignored", async () => {
  const original_fetch = globalThis.fetch;
  const received: string[][] = [];
  try {
    let replacement_sid = "";
    let client: RendezqueueClient;
    globalThis.fetch = async () => {
      client._start_new_session();
      replacement_sid = client.sid;
      return new Response(JSON.stringify({
        offset: 1,
        values: [btoa("stale-peer")],
        b64: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    client = new RendezqueueClient({
      url: "http://unused",
      key: "key",
      hue: "hue",
      on_data: values => received.push(values),
    });
    client.send("pending");

    await client._poll();

    assert.equal(client.sid, replacement_sid);
    assert.equal(client.offset, 0);
    assert.deepStrictEqual(client.outgoing_queue, ["pending"]);
    assert.deepStrictEqual(received, []);
  } finally {
    globalThis.fetch = original_fetch;
  }
});

test("404 reports an error without changing session state", async () => {
  const original_fetch = globalThis.fetch;
  const errors: any[] = [];
  try {
    globalThis.fetch = async () => new Response("gone", { status: 404 });

    const client = new RendezqueueClient({
      url: "http://unused",
      key: "key",
      hue: "hue",
      on_data: () => {},
      on_error: error => errors.push(error),
    });
    client.offset = 1;
    client.send("still-pending");
    const old_sid = client.sid;

    await client._poll();

    assert.equal(client.sid, old_sid);
    assert.equal(client.offset, 1);
    assert.deepStrictEqual(client.outgoing_queue, ["still-pending"]);
    assert.equal(errors.length, 1);
  } finally {
    globalThis.fetch = original_fetch;
  }
});
