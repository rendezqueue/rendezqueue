import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import type { Page } from "playwright";
import { test, expect } from "playwright/test";

const nodejson_server_filepath = path.resolve(process.cwd(), "dist/src/server/main.js");
const index_html_filepath = path.resolve(process.cwd(), "demo/webchat/index.html");
const app_js_filepath = path.resolve(process.cwd(), "dist/demo/webchat/app.js");
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
    const req_path = new URL(req.url ?? "", "http://localhost").pathname;
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
  const exists = await page.$(selector);
  if (!exists) return "";
  return await page.$eval(selector, (el) => (el as HTMLElement).innerText);
}

test("webchat isolation test", async ({ browser }) => {
  test.setTimeout(60000);
  const tmp_dirpath = process.env.TEST_TMPDIR ?? os.tmpdir();
  const nodejson_port_filepath = path.join(tmp_dirpath, `nodejson_portfile_wc_iso.${process.pid}`);

  let nodejson_server: ChildProcess | undefined;
  let http_server: http.Server | undefined;
  let alice_page: Page | undefined;
  let bob_page: Page | undefined;

  try {
    // Start nodejson server
    const http_path = "/tryswap";
    nodejson_server = spawn(
      "node",
      [nodejson_server_filepath, "--http_port=0", `--o-http-port=${nodejson_port_filepath}`, `--http_path=${http_path}`],
      { stdio: "ignore" }
    );

    // Start http-server
    const webchat_files: Record<string, string> = {
      "/index.html": index_html_filepath,
      "/app.js": app_js_filepath,
      "/src/client.js": client_js_filepath,
    };
    http_server = createStaticServer(webchat_files);
    await new Promise<void>(resolve => http_server?.listen(0, "127.0.0.1", resolve));
    // @ts-expect-error address() returns AddressInfo | string | null
    const http_server_port = http_server.address().port;

    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_filepath);
    const nodejson_port = fs.readFileSync(nodejson_port_filepath, "utf8").trim();

    const backend_url = `http://127.0.0.1:${nodejson_port}${http_path}`;
    const key1 = "room1";
    const key2 = "room2";

    alice_page = await browser.newPage();
    bob_page = await browser.newPage();

    // Open Alice with key1
    await alice_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${key1}&user=Alice`);

    // Open Bob with key2
    await bob_page.goto(`http://127.0.0.1:${http_server_port}?url=${backend_url}&key=${key2}&user=Bob`);

    // Helper function to send message
    const sendMessage = async (page: Page, message: string) => {
      await page.type("#message-input", message);
      await page.click("#chat-form button");
    };

    // Alice sends "A1"
    await sendMessage(alice_page, "A1");
    // Bob sends "B1"
    await sendMessage(bob_page, "B1");

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    const alice_log = await get_text(alice_page, "#chat-log");
    const bob_log = await get_text(bob_page, "#chat-log");

    // Alice should NOT see B1
    expect(alice_log).not.toContain("Bob: B1");
    // Bob should NOT see A1
    expect(bob_log).not.toContain("Alice: A1");

    // Alice SHOULD see A1 (local echo)
    expect(alice_log).toContain("Alice: A1");
    // Bob SHOULD see B1 (local echo)
    expect(bob_log).toContain("Bob: B1");

  } finally {
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
