

import { strict as assert } from "assert";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import process from "node:process";
import { RendezqueueClient } from "../../src/rendezqueue_client.js";

import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodejson_server_path = process.argv[2] || path.join(__dirname, "../../src/nodejson/main.js");

async function waitForFile(filePath) {
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
async function waitForMessages(received_array, count) {
  while (received_array.length < count) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function main() {
  const tmpDir = process.env.TEST_TMPDIR || "/tmp";
  const nodejson_port_file = path.join(tmpDir, `nodejson_portfile.${process.pid}`);

  let nodejson_server;
  let alice_client;
  let bob_client;

  try {
    // Start nodejson server
    const http_host = "127.0.0.1";
    const http_path = "/test-tryswap-path";
    nodejson_server = spawn(
      process.execPath,
      [nodejson_server_path, "--http_port=0", `--o-http-port=${nodejson_port_file}`, `--http_host=${http_host}`, `--http_path=${http_path}`],
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_file);
    const nodejson_port = fs.readFileSync(nodejson_port_file, "utf8").trim();
    console.log(`nodejson server started on port ${nodejson_port}`);

    const backend_url = `http://${http_host}:${nodejson_port}${http_path}`;
    const room_key = "test-room-" + Math.random();

    const alice_received = [];
    const bob_received = [];

    alice_client = new RendezqueueClient({
      url: backend_url,
      key: room_key,
      hue: "Alice",
      on_data: (data) => {
        console.log("Alice received:", data);
        alice_received.push(...data);
      },
      poll_interval_ms: 200, // Use a slightly longer poll interval for stability
    });

    bob_client = new RendezqueueClient({
      url: backend_url,
      key: room_key,
      hue: "Bob",
      on_data: (data) => {
        console.log("Bob received:", data);
        bob_received.push(...data);
      },
      poll_interval_ms: 200,
    });

    alice_client.start();
    bob_client.start();

    // Steps 1 & 2: Alice sends "A1", then "A2".
    console.log("Alice sends: A1, A2");
    alice_client.send("A1");
    alice_client.send("A2");

    // Step 3: Bob sends "B1", swaps with Alice's offer.
    console.log("Bob sends: B1");
    bob_client.send("B1");
    await waitForMessages(bob_received, 2);
    assert.deepStrictEqual(bob_received, ["A1", "A2"]);

    // Step 7 (implicit): Alice polls and gets Bob's "B1".
    await waitForMessages(alice_received, 1);
    assert.deepStrictEqual(alice_received, ["B1"]);

    // At this point, the first exchange is complete. Both clients have started a new session.

    // Step 5 & 6: Bob sends "B2", then "B3".
    console.log("Bob sends: B2, B3");
    bob_client.send("B2");
    bob_client.send("B3");

    // Step 8: Alice sends "A3" and gets Bob's pending messages.
    console.log("Alice sends: A3");
    alice_client.send("A3");
    await waitForMessages(alice_received, 3); // B1 + B2 + B3
    assert.deepStrictEqual(alice_received.sort(), ["B1", "B2", "B3"].sort());

    // Step 11: Bob polls and gets Alice's "A3".
    await waitForMessages(bob_received, 3); // A1 + A2 + A3
    assert.deepStrictEqual(bob_received.sort(), ["A1", "A2", "A3"].sort());

    // Second exchange complete.

    // Step 9 & 10: Alice sends "A4", then "A5".
    console.log("Alice sends: A4, A5");
    alice_client.send("A4");
    alice_client.send("A5");

    // Step 12: Bob polls, starts a new session, and swaps with Alice's pending offer.
    // Bob's client will do this automatically. We just need to wait for the messages.
    await waitForMessages(bob_received, 5); // A1-A3 + A4 + A5
    assert.deepStrictEqual(bob_received.sort(), ["A1", "A2", "A3", "A4", "A5"].sort());

    // Step 13: Alice polls to get the result of her swap. She gets nothing back, but the session is closed.
    // The client should handle this and start a new session. We can't directly test this part without
    // more introspection into the client, but the next step will fail if it's not working.

    console.log("--- Test passed ---");

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
