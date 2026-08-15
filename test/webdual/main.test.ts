import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { test } from "playwright/test";

// Define paths relative to CWD (repo root)
// We assume the test is run via `npm test` from the repo root
const nodejson_server_filepath = path.resolve(process.cwd(), "dist/src/server/main.js");
const index_html_filepath = path.resolve(process.cwd(), "demo/webdual/index.html");
const app_ts_filepath = path.resolve(process.cwd(), "dist/demo/webdual/app.js");

async function waitForFile(filepath: string) {
  while (true) {
    try {
      if (fs.readFileSync(filepath, "utf8").trim() !== "") {
        return;
      }
    } catch (_e) {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function createStaticServer(files: Record<string, string>) {
  return http.createServer((req, res) => {
    const req_path = new URL(req.url || "", "http://localhost").pathname;
    const lookup_path = req_path === "/" ? "/index.html" : req_path;
    const filepath = files[lookup_path || ""];
    if (!filepath) {
      res.writeHead(404);
      res.end();
      return;
    }
    // Very simple mime types
    if (filepath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html");
    } else if (filepath.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript");
    }

    fs.readFile(filepath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end(JSON.stringify(err));
        return;
      }
      res.writeHead(200);
      res.end(data);
    });
  });
}

const tmp_dirpath = process.env.TEST_TMPDIR || os.tmpdir();
const nodejson_port_filepath = path.join(tmp_dirpath, `nodejson_portfile.${process.pid}`);
let nodejson_server: ChildProcess | undefined;
let http_server: http.Server | undefined;

test.afterEach(async () => {
  if (nodejson_server) {
    nodejson_server.kill();
  }
  if (http_server) {
    http_server.close();
  }
  if (fs.existsSync(nodejson_port_filepath)) {
    try {
      fs.unlinkSync(nodejson_port_filepath);
    } catch (_e) {
      // ignore
    }
  }
});

test("webdual integration test", async ({ browser }) => {
  test.setTimeout(35000);
  // Check if source files exist
  if (!fs.existsSync(nodejson_server_filepath)) {
    throw new Error(`nodejson_server_filepath not found: ${nodejson_server_filepath}`);
  }
  if (!fs.existsSync(index_html_filepath)) {
    throw new Error(`index_html_filepath not found: ${index_html_filepath}`);
  }
  if (!fs.existsSync(app_ts_filepath)) {
    throw new Error(`app_ts_filepath not found: ${app_ts_filepath}. Did you run npm run build?`);
  }

  // Start nodejson server
  // We use process.execPath (node executable) to run the script
  nodejson_server = spawn(
    process.execPath,
    [nodejson_server_filepath, "--http_port=0", `--o-http-port=${nodejson_port_filepath}`],
    { stdio: "ignore" }
  );

  // Start http-server
  const webdual_files: Record<string, string> = {
    "/index.html": index_html_filepath,
    "/app.js": app_ts_filepath, // Map app.js request to the compiled file
  };

  http_server = createStaticServer(webdual_files);
  if (!http_server) throw new Error("http_server is not defined");
  await new Promise<void>(resolve => http_server?.listen(0, "127.0.0.1", () => resolve()));
  const address = http_server.address();
  const http_server_port = (typeof address === "object" && address !== null) ? address.port : 0;

  // Wait for nodejson server to be ready
  await waitForFile(nodejson_port_filepath);
  const nodejson_port = fs.readFileSync(nodejson_port_filepath, "utf8").trim();

  const context = await browser.newContext();
  const page = await context.newPage();

  const webdual_url = `http://127.0.0.1:${http_server_port}/?url=http://127.0.0.1:${nodejson_port}`;
  await page.goto(webdual_url);

  await page.waitForSelector("div:has-text(\"Bonjour from Bob!\")", { timeout: 30000 });
  await page.waitForSelector("div:has-text(\"Allo from Alice!\")", { timeout: 30000 });

  const pageText = await page.innerText("body");
  assert.ok(pageText.includes("Bonjour from Bob!"), "Page should contain Bob's message");
  assert.ok(pageText.includes("Allo from Alice!"), "Page should contain Alice's message");
});
