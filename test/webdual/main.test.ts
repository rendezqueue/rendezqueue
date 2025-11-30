import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import url from "node:url";
import os from "node:os";
import { test } from "node:test";
import playwright from "playwright";

// Define paths relative to CWD (repo root)
// We assume the test is run via `npm test` from the repo root
const nodejson_server_filepath = path.resolve(process.cwd(), "src/server/main.ts");
const index_html_filepath = path.resolve(process.cwd(), "demo/webdual/index.html");
const app_ts_filepath = path.resolve(process.cwd(), "demo/webdual/app.ts");

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
    const req_path = url.parse(req.url || "").pathname;
    const lookup_path = req_path === "/" ? "/index.html" : req_path;
    const filepath = files[lookup_path || ""];
    if (!filepath) {
      res.writeHead(404);
      res.end();
      return;
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

test("webdual integration test", async (t) => {
  const tmp_dirpath = process.env.TEST_TMPDIR || os.tmpdir();
  const nodejson_port_filepath = path.join(tmp_dirpath, `nodejson_portfile.${process.pid}`);

  let nodejson_server: any;
  let http_server: http.Server | undefined;
  let browser: playwright.Browser | undefined;

  // Teardown
  t.after(async () => {
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
      try {
        fs.unlinkSync(nodejson_port_filepath);
      } catch (_e) {
        // ignore
      }
    }
  });

  // Check if source files exist
  if (!fs.existsSync(nodejson_server_filepath)) {
    throw new Error(`nodejson_server_filepath not found: ${nodejson_server_filepath}`);
  }
  if (!fs.existsSync(index_html_filepath)) {
    throw new Error(`index_html_filepath not found: ${index_html_filepath}`);
  }
  if (!fs.existsSync(app_ts_filepath)) {
    throw new Error(`app_ts_filepath not found: ${app_ts_filepath}`);
  }

  // Start nodejson server
  // We use process.execPath (node executable) to run the script
  nodejson_server = spawn(
    process.execPath,
    ["--import", "tsx", nodejson_server_filepath, "--http_port=0", `--o-http-port=${nodejson_port_filepath}`],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  // Start http-server
  const webdual_files: Record<string, string> = {
    "/index.html": index_html_filepath,
    "/app.ts": app_ts_filepath,
  };
  http_server = createStaticServer(webdual_files);
  await new Promise<void>(resolve => http_server!.listen(0, "127.0.0.1", () => resolve()));
  const address = http_server.address();
  const http_server_port = (typeof address === "object" && address !== null) ? address.port : 0;
  console.log(`http-server started on port ${http_server_port}`);


  // Wait for nodejson server to be ready
  await waitForFile(nodejson_port_filepath);
  const nodejson_port = fs.readFileSync(nodejson_port_filepath, "utf8").trim();
  console.log(`nodejson server started on port ${nodejson_port}`);


  // Run playwright test
  browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", msg => console.log("PAGE LOG:", msg.text()));

  const webdual_url = `http://127.0.0.1:${http_server_port}/?url=http://127.0.0.1:${nodejson_port}`;
  await page.goto(webdual_url);

  // Wait for the results to appear
  console.log("Waiting for results to appear on the page...");
  // Note: has-text is a Playwright pseudo-class.
  await page.waitForSelector("div:has-text(\"Bonjour from Bob!\")", { timeout: 10000 });
  await page.waitForSelector("div:has-text(\"Allo from Alice!\")", { timeout: 10000 });

  const results = await page.evaluate(() => {
    const divs = Array.from(document.body.querySelectorAll("div"));
    return divs.map((div: any) => div.innerText);
  });

  console.log("Results from page:", results);

  const pageText = await page.innerText("body");
  assert.ok(pageText.includes("Bonjour from Bob!"), "Page should contain Bob's message");
  assert.ok(pageText.includes("Allo from Alice!"), "Page should contain Alice's message");
});
