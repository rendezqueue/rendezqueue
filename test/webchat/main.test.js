
import { strict as assert } from "assert";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import url from "url";
import playwright from "playwright";
import { fileURLToPath } from "url";
import { test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodejson_server_path = process.argv[2] || path.join(__dirname, "../../src/nodejson/main.js");
const index_html_path = process.argv[3] || path.join(__dirname, "../../src/webchat/index.html");
const script_js_path = process.argv[4] || path.join(__dirname, "../../src/webchat/script.js");
const rendezqueue_client_js_path = process.argv[5] || path.join(__dirname, "../../src/rendezqueue_client.js");

async function waitForFile(filePath) {
  while (true) {
    try {
      if (fs.readFileSync(filePath, "utf8").trim() !== "") {
        return;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function createStaticServer(files) {
  return http.createServer((req, res) => {
    const req_path = url.parse(req.url).pathname;
    const lookup_path = req_path === "/" ? "/index.html" : req_path;
    const filePath = files[lookup_path];
    if (!filePath) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end(JSON.stringify(err));
        return;
      }
      if (lookup_path.endsWith(".js") || lookup_path.endsWith(".mjs")) {
        res.setHeader("Content-Type", "application/javascript");
      }
      res.writeHead(200);
      res.end(data);
    });
  });
}

async function get_text(page, selector) {
  return await page.$eval(selector, (el) => el.innerText);
}

test("webchat integration", async () => {
  const tmpDir = process.env.TEST_TMPDIR || "/tmp";
  const nodejson_port_file = path.join(tmpDir, `nodejson_portfile.${process.pid}`);

  let nodejson_server;
  let http_server;
  let browser;
  let alice_page;
  let bob_page;

  try {
    // Start nodejson server
    const http_path = "/tryswap";
    nodejson_server = spawn(
      process.execPath,
      [nodejson_server_path, "--http_port=0", `--o-http-port=${nodejson_port_file}`, `--http_path=${http_path}`],
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    // Start http-server
    const webchat_files = {
      "/index.html": index_html_path,
      "/script.js": script_js_path,
      "/rendezqueue_client.js": rendezqueue_client_js_path,
    };
    http_server = createStaticServer(webchat_files);
    await new Promise(resolve => http_server.listen(0, "127.0.0.1", resolve));
    const http_server_port = http_server.address().port;
    console.log(`http-server started on port ${http_server_port}`);


    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_file);
    const nodejson_port = fs.readFileSync(nodejson_port_file, "utf8").trim();
    console.log(`nodejson server started on port ${nodejson_port}`);


    // Run playwright test
    browser = await playwright.chromium.launch();
    const context = await browser.newContext();

    const backend_url = `http://127.0.0.1:${nodejson_port}${http_path}`;
    const room_key = "test-room-" + Math.random();

    alice_page = await browser.newPage();
    bob_page = await browser.newPage();

    alice_page.on("console", msg => console.log("ALICE:", msg.text()));
    bob_page.on("console", msg => console.log("BOB:", msg.text()));

    await alice_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room_key}&user=Alice`);
    await bob_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room_key}&user=Bob`);

    // Helper function to send message
    const sendMessage = async (page, message) => {
      await page.type("#message-input", message);
      await page.click("#chat-form button");
    };

    // Steps 1 & 2 from webchat.sxpb: Alice sends "A1", then "A2".
    await sendMessage(alice_page, "A1");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A1\")");
    await sendMessage(alice_page, "A2");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A2\")");

    // Step 3: Bob sends "B1", swaps with Alice's offer of "A1" and "A2".
    await sendMessage(bob_page, "B1");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B1\")");
    // Bob should immediately receive Alice's messages.
    await bob_page.waitForSelector(".message:has-text(\"Alice: A1\")");
    await bob_page.waitForSelector(".message:has-text(\"Alice: A2\")");

    // Step 7 (implicit): Alice's client will automatically poll and get Bob's "B1".
    // This happens because a swap occurred.
    await alice_page.waitForSelector(".message:has-text(\"Bob: B1\")");

    // At this point, the first exchange is complete. Both clients should have
    // automatically started a new session.

    // Step 5 & 6: Bob sends "B2", then "B3" on his new session.
    await sendMessage(bob_page, "B2");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B2\")");
    await sendMessage(bob_page, "B3");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B3\")");

    // Step 8: Alice sends "A3" on her new session and gets Bob's pending messages.
    await sendMessage(alice_page, "A3");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A3\")");
    await alice_page.waitForSelector(".message:has-text(\"Bob: B2\")");
    await alice_page.waitForSelector(".message:has-text(\"Bob: B3\")");

    // Let's add the graceful rejection test case from step 7.
    // To do this, we need to get Alice to send a message on an old, swapped session.
    // The library is designed to prevent this from failing by queueing and resending.
    // Let's verify the outcome is correct.
    // We'll add a new assertion helper for clarity.
    const assertChatContains = async (page, expected_messages, user) => {
      const chat_log = await get_text(page, "#chat-log");
      for (const msg of expected_messages) {
        assert(chat_log.includes(msg), `${user}'s chat should contain "${msg}". Log:\n${chat_log}`);
      }
    };

    // Final state verification
    await assertChatContains(alice_page, [
      "Alice: A1",
      "Alice: A2",
      "Bob: B1",
      "Alice: A3",
      "Bob: B2",
      "Bob: B3",
    ], "Alice");

    await assertChatContains(bob_page, [
      "Bob: B1",
      "Alice: A1",
      "Alice: A2",
      "Bob: B2",
      "Bob: B3",
    ], "Bob");

    // Bob's client will automatically poll and receive Alice's "A3" from the swap.
    await bob_page.waitForSelector(".message:has-text(\"Alice: A3\")");

    // Step 9 & 10: Alice sends "A4", then "A5".
    await sendMessage(alice_page, "A4");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A4\")");
    await sendMessage(alice_page, "A5");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A5\")");

    // Step 12: Bob's client is polling. It will start a new session and swap
    // with Alice's pending "A4" and "A5".
    await bob_page.waitForSelector(".message:has-text(\"Alice: A4\")");
    await bob_page.waitForSelector(".message:has-text(\"Alice: A5\")");

    // This is the end of the scenario described in webchat.sxpb.
    // Let's do a final check of the chat logs.
    await assertChatContains(alice_page, [
      "Alice: A1", "Alice: A2", "Bob: B1",
      "Alice: A3", "Bob: B2", "Bob: B3",
      "Alice: A4", "Alice: A5",
    ], "Alice");

    await assertChatContains(bob_page, [
      "Bob: B1", "Alice: A1", "Alice: A2",
      "Bob: B2", "Bob: B3", "Alice: A3",
      "Alice: A4", "Alice: A5",
    ], "Bob");

    console.log("--- Test passed ---");

  } catch (e) {
    if (alice_page) console.log("Alice page content on error:", await alice_page.content());
    if (bob_page) console.log("Bob page content on error:", await bob_page.content());
    throw e;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (nodejson_server) {
      nodejson_server.kill();
    }
    if (http_server) {
      http_server.close();
    }
    if (fs.existsSync(nodejson_port_file)) {
      fs.unlinkSync(nodejson_port_file);
    }
  }
});
