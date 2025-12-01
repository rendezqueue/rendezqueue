import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";
import * as os from "os";
import { chromium, Browser, Page, ConsoleMessage } from "playwright";
import { test, expect } from "vitest";

const nodejson_server_filepath = path.resolve(process.cwd(), "dist/src/server/main.js");
const index_html_filepath = path.resolve(process.cwd(), "demo/webrtcchat/index.html");
const app_js_filepath = path.resolve(process.cwd(), "dist/demo/webrtcchat/app.js");
const client_js_filepath = path.resolve(process.cwd(), "dist/src/client.js");

async function waitForFile(filepath: string): Promise<void> {
  while (true) {
    try {
      if (fs.readFileSync(filepath, "utf8").trim() !== "") {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function createStaticServer(files: Record<string, string>): http.Server {
  return http.createServer((req, res) => {
    const req_path = url.parse(req.url ?? "").pathname;
    const lookup_path = req_path === "/" ? "/index.html" : req_path;
    const filepath = files[lookup_path ?? ""];
    if (!filepath) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(filepath, (err: NodeJS.ErrnoException | null, data: Buffer) => {
      if (err) {
        res.writeHead(500);
        res.end(JSON.stringify(err));
        return;
      }

      let contentType = "text/plain";
      if (lookup_path?.endsWith(".html")) contentType = "text/html";
      else if (lookup_path?.endsWith(".js")) contentType = "application/javascript";

      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });
}

async function get_text(page: Page, selector: string): Promise<string> {
  return await page.$eval(selector, (el) => (el as HTMLElement).innerText);
}

test("webrtcchat room change reproduction", { timeout: 60000 }, async () => {
  const tmp_dirpath = process.env.TEST_TMPDIR ?? os.tmpdir();
  const nodejson_port_filepath = path.join(tmp_dirpath, `nodejson_portfile_repro.${process.pid}`);

  let nodejson_server: ChildProcess | undefined;
  let http_server: http.Server | undefined;
  let browser: Browser | undefined;
  let alice_page: Page | undefined;
  let bob_page: Page | undefined;

  try {
    // Start nodejson server
    const http_path = "/tryswap";
    nodejson_server = spawn(
      "node",
      [nodejson_server_filepath, "--http_port=0", `--o-http-port=${nodejson_port_filepath}`, `--http_path=${http_path}`],
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    // Start http-server
    const webrtcchat_files: Record<string, string> = {
      "/index.html": index_html_filepath,
      "/app.js": app_js_filepath,
      "/src/client.js": client_js_filepath,
    };
    http_server = createStaticServer(webrtcchat_files);
    await new Promise<void>(resolve => http_server?.listen(0, "127.0.0.1", resolve));
    // @ts-expect-error address() returns AddressInfo | string | null
    const http_server_port = http_server.address().port;
    console.log(`http-server started on port ${http_server_port}`);

    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_filepath);
    const nodejson_port = fs.readFileSync(nodejson_port_filepath, "utf8").trim();
    console.log(`nodejson server started on port ${nodejson_port}`);

    // Run playwright test
    browser = await chromium.launch();

    const backend_url = `http://127.0.0.1:${nodejson_port}${http_path}`;
    const room1 = "room-1-" + Math.random();
    const room2 = "room-2-" + Math.random();

    alice_page = await browser.newPage();
    bob_page = await browser.newPage();

    alice_page.on("console", (msg: ConsoleMessage) => console.log("ALICE:", msg.text()));
    bob_page.on("console", (msg: ConsoleMessage) => console.log("BOB:", msg.text()));

    // Open Alice in Room 1
    await alice_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room1}`);

    // Open Bob in Room 1
    await bob_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${room1}`);

    // Wait for connection in Room 1
    await alice_page.waitForSelector(".message:has-text(\"WebRTC data channel is open\")", { timeout: 30000 });
    await bob_page.waitForSelector(".message:has-text(\"WebRTC data channel is open\")", { timeout: 30000 });

    console.log("--- Connected in Room 1 ---");

    // Change Alice to Room 2
    console.log(`--- Switching Alice to ${room2} ---`);
    await alice_page.fill("#room-key-input", room2);
    await alice_page.dispatchEvent("#room-key-input", "change");

    // Change Bob to Room 2
    console.log(`--- Switching Bob to ${room2} ---`);
    await bob_page.fill("#room-key-input", room2);
    await bob_page.dispatchEvent("#room-key-input", "change");

    // Wait for reconnection.
    // We expect the "WebRTC data channel is open" message count to increase.
    const waitForNewConnection = async (page: Page) => {
      await page.waitForFunction(() => {
        const messages = Array.from(document.querySelectorAll(".message"));
        const openMessages = messages.filter(m => (m as HTMLElement).innerText.includes("WebRTC data channel is open"));
        return openMessages.length >= 2;
      }, undefined, { timeout: 30000 });
    };

    console.log("--- Waiting for connection in Room 2 ---");
    await waitForNewConnection(alice_page);
    await waitForNewConnection(bob_page);

    console.log("--- Connected in Room 2 ---");

    // Helper function to send message
    const sendMessage = async (page: Page, message: string) => {
      await page.type("#message-input", message);
      await page.click("#chat-form button");
    };

    // Alice sends "Hello Room 2!"
    await sendMessage(alice_page, "Hello Room 2!");

    // Bob sends "Hi Room 2!"
    await sendMessage(bob_page, "Hi Room 2!");

    // Wait for messages to appear
    await bob_page.waitForSelector(".message:has-text(\"Hello Room 2!\")");
    await alice_page.waitForSelector(".message:has-text(\"Hi Room 2!\")");

    const alice_chat = await get_text(alice_page, "#chat-log");
    const bob_chat = await get_text(bob_page, "#chat-log");

    expect(alice_chat).toContain("sent: Hello Room 2!");
    expect(alice_chat).toContain("received: Hi Room 2!");
    expect(bob_chat).toContain("received: Hello Room 2!");
    expect(bob_chat).toContain("sent: Hi Room 2!");

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
    if (fs.existsSync(nodejson_port_filepath)) {
      fs.unlinkSync(nodejson_port_filepath);
    }
  }
});
