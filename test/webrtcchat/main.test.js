

import { strict as assert } from "assert";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import url from "url";
import playwright from "playwright";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodejson_server_path = process.argv[2] || path.join(__dirname, "../../src/nodejson/main.js");
const index_html_path = process.argv[3] || path.join(__dirname, "../../src/webrtcchat/index.html");
const script_js_path = process.argv[4] || path.join(__dirname, "../../src/webrtcchat/script.js");
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

async function main() {
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
    const webrtcchat_files = {
      "/index.html": index_html_path,
      "/script.js": script_js_path,
      "/rendezqueue_client.js": rendezqueue_client_js_path,
    };
    http_server = createStaticServer(webrtcchat_files);
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

    await alice_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room_key}`);
    await bob_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room_key}`);

    // Wait for the WebRTC connection to be established
    await alice_page.waitForSelector("text=/WebRTC data channel is open/", {timeout: 30000});
    await bob_page.waitForSelector("text=/WebRTC data channel is open/", {timeout: 30000});

    // Alice sends first message
    await alice_page.type("#message-input", "Hello Bob!");
    await alice_page.click("#chat-form button");

    // Bob sends a reply
    await bob_page.type("#message-input", "Hi Alice!");
    await bob_page.click("#chat-form button");

    // Wait for messages to appear
    await bob_page.waitForSelector("div.message:has-text('Hello Bob!')");
    await alice_page.waitForSelector("div.message:has-text('Hi Alice!')");

    const alice_chat = await get_text(alice_page, "#chat-log");
    const bob_chat = await get_text(bob_page, "#chat-log");

    assert(alice_chat.includes("sent: Hello Bob!"), "Alice should see her own message");
    assert(alice_chat.includes("received: Hi Alice!"), "Alice should see Bob's message");
    assert(bob_chat.includes("received: Hello Bob!"), "Bob should see Alice's message");
    assert(bob_chat.includes("sent: Hi Alice!"), "Bob should see his own message");

    // --- Simulate a disconnect and reconnect ---
    console.log("--- Simulating disconnect ---");

    // Reload Alice's page to simulate a disconnect
    await alice_page.reload();
    alice_page.on("console", msg => console.log("ALICE:", msg.text()));

    // Wait for the reconnection to happen.
    // Alice's page is new, so we wait for the first "open" message.
    await alice_page.waitForSelector("text=/WebRTC data channel is open/", {timeout: 30000});

    // Bob's page is not reloaded, so we wait for the second "open" message.
    await bob_page.waitForFunction(() => {
      const messages = Array.from(document.querySelectorAll("#chat-log .message"));
      const openMessages = messages.filter(m => m.innerText.includes("WebRTC data channel is open"));
      return openMessages.length >= 2;
    }, {timeout: 30000});

    console.log("--- Reconnected ---");

    // Alice sends a message after reconnect
    await alice_page.type("#message-input", "Hello again, Bob!");
    await alice_page.click("#chat-form button");

    // Bob sends a reply after reconnect
    await bob_page.type("#message-input", "Hi again, Alice!");
    await bob_page.click("#chat-form button");

    // Wait for messages to appear
    await bob_page.waitForSelector("div.message:has-text('Hello again, Bob!')");
    await alice_page.waitForSelector("div.message:has-text('Hi again, Alice!')");

    const alice_chat_after_reconnect = await get_text(alice_page, "#chat-log");
    const bob_chat_after_reconnect = await get_text(bob_page, "#chat-log");

    assert(alice_chat_after_reconnect.includes("sent: Hello again, Bob!"), "Alice should see her own message after reconnect");
    assert(alice_chat_after_reconnect.includes("received: Hi again, Alice!"), "Alice should see Bob's message after reconnect");
    assert(bob_chat_after_reconnect.includes("received: Hello again, Bob!"), "Bob should see Alice's message after reconnect");
    assert(bob_chat_after_reconnect.includes("sent: Hi again, Alice!"), "Bob should see his own message after reconnect");

    console.log("--- Test passed ---");

  } catch (e) {
    if (alice_page) {
      console.log("--- Alice page content on error ---");
      console.log(await alice_page.content());
    }
    if (bob_page) {
      console.log("--- Bob page content on error ---");
      console.log(await bob_page.content());
    }
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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
