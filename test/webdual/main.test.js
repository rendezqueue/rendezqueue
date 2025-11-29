
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
const index_html_path = process.argv[3] || path.join(__dirname, "../../src/webdual/index.html");
const script_js_path = process.argv[4] || path.join(__dirname, "../../src/webdual/script.js");

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
      res.writeHead(200);
      res.end(data);
    });
  });
}

test("webdual integration", async () => {
  const tmpDir = process.env.TEST_TMPDIR || "/tmp";
  const nodejson_port_file = path.join(tmpDir, `nodejson_portfile.${process.pid}`);

  let nodejson_server;
  let http_server;
  let browser;
  let page;

  try {
    // Start nodejson server
    nodejson_server = spawn(
      process.execPath,
      [nodejson_server_path, "--http_port=0", `--o-http-port=${nodejson_port_file}`],
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    // Start http-server
    const webdual_files = {
      "/index.html": index_html_path,
      "/script.js": script_js_path,
    };
    http_server = createStaticServer(webdual_files);
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
    page = await context.newPage();

    page.on("console", msg => console.log("PAGE LOG:", msg.text()));

    const webdual_url = `http://127.0.0.1:${http_server_port}/?url=http://127.0.0.1:${nodejson_port}`;
    await page.goto(webdual_url);

    // Wait for the results to appear
    console.log("Waiting for results to appear on the page...");
    await page.waitForSelector("div:has-text(\"Bonjour from Bob!\")", { timeout: 10000 });
    await page.waitForSelector("div:has-text(\"Allo from Alice!\")", { timeout: 10000 });

    const results = await page.evaluate(() => {
      const divs = Array.from(document.body.querySelectorAll("div"));
      return divs.map(div => div.innerText);
    });

    console.log("Results from page:", results);

    const pageText = await page.innerText("body");
    assert(pageText.includes("Bonjour from Bob!"), "Page should contain Bob's message");
    assert(pageText.includes("Allo from Alice!"), "Page should contain Alice's message");


    console.log("--- Test passed ---");

  } catch (e) {
    if (page) {
      console.log("Page content on error:", await page.content());
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
});
