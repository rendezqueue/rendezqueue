
import { strict as assert } from "assert";
import { Buffer } from "node:buffer";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "url";
import { test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the built JS file instead of TS
const main_js_filepath = path.join(__dirname, "../../dist/src/server/main.js");
import SxPB from "@sxproto/sxpb";

const scenario_filepath = path.join(__dirname, "../tryswap/scenario/webchat.sxpb");

function request(options: any, body: any): Promise<any> {
  options.hostname = "127.0.0.1";
  options.method = "POST";
  options.headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = "";
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          http_status_code: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function wait_for_file(filePath: string) {
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

async function main() {
  const tmp_dirpath = process.env.TEST_TMPDIR || os.tmpdir();
  const port_filepath = path.join(tmp_dirpath, `portfile.${process.pid}`);

  let server: ChildProcess | undefined;
  try {
    const args = [
      main_js_filepath, // Run the JS file directly with node
      "--http_port=0",
      `--o-http-port=${port_filepath}`,
    ];
    server = spawn(process.execPath, args, {
      stdio: ["ignore", "inherit", "inherit"] // pipe server stdout/stderr
    });

    await wait_for_file(port_filepath);
    const port = fs.readFileSync(port_filepath, "utf8").trim();
    console.log(`Server started on port ${port}`);

    const sxpb_content = fs.readFileSync(scenario_filepath, "utf8");
    const expectations = SxPB.parse(sxpb_content);

    for (const expectation of (expectations as any)) {
      if (Object.keys(expectation).length === 0) {
        continue;
      }
      const req_body = expectation.req;
      const res = await request({ port }, JSON.stringify(req_body));

      if (expectation.http_status_code) {
        assert.strictEqual(res.http_status_code, expectation.http_status_code);
      } else {
        assert.strictEqual(res.http_status_code, 200);
        const res_body = res.body ? JSON.parse(res.body) : {};
        assert.deepStrictEqual(res_body, expectation.res);
      }
    }
  } finally {
    if (server) {
      server.kill();
    }
    if (fs.existsSync(port_filepath)) {
      fs.unlinkSync(port_filepath);
    }
  }
}

test("server integration tests", main);
