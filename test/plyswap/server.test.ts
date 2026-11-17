import { strict as assert } from "assert";
import { Buffer } from "node:buffer";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "node:net";
import * as path from "path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "url";
import { once } from "node:events";
import { describe, it, test } from "vitest";
import { PlySwapCache } from "../../src/plyswap_cache.js";
import { dispatch, Admission } from "../../src/server/plyswap_http.js";
import { encodeRequest } from "../../src/plyswap_wire.js";
import { Message } from "../../src/plyswap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const main_js_filepath = path.join(__dirname, "../../dist/src/server/main.js");

function admission(overrides: Partial<Admission> = {}): Admission {
  return {
    target: "/",
    method: "POST",
    contentType: "application/json",
    contentEncodingPresent: false,
    transferEncodingPresent: false,
    contentLength: "2",
    upgradePresent: false,
    connectionUpgrade: false,
    body: Buffer.from("{}"),
    ...overrides,
  };
}

function openBody(room = "room", self = "a"): { body: Buffer; length: string } {
  const body = Buffer.from(encodeRequest(new Message({ self }), room, 7));
  return { body, length: String(body.length) };
}

describe("plyswap admission", () => {
  it("serves an opening poll and echoes its flags", () => {
    const cache = new PlySwapCache(20, () => 0);
    const { body, length } = openBody();
    const outcome = dispatch(
      admission({ body, contentLength: length }),
      cache,
      "/",
    );
    assert.equal(outcome.status, 200);
    const parsed = JSON.parse(outcome.body);
    assert.deepStrictEqual(parsed, {
      b64: 7,
      room: "cm9vbQ",
      self: "YQ",
    });
  });

  it("rejects unknown endpoints and bad queries", () => {
    const cache = new PlySwapCache(20, () => 0);
    assert.equal(dispatch(admission({ target: "/other" }), cache, "/").status, 404);
    assert.equal(dispatch(admission({ target: "/?room" }), cache, "/").status, 400);
  });

  it("requires POST with one JSON content type", () => {
    const cache = new PlySwapCache(20, () => 0);
    assert.equal(dispatch(admission({ method: "GET" }), cache, "/").status, 405);
    assert.equal(dispatch(admission({ method: "OPTIONS" }), cache, "/").status, 405);
    assert.equal(dispatch(admission({ contentType: "text/plain" }), cache, "/").status, 415);
    assert.equal(dispatch(admission({ contentType: undefined }), cache, "/").status, 415);
    assert.equal(
      dispatch(admission({ contentEncodingPresent: true }), cache, "/").status,
      415,
    );
  });

  it("requires a single content length and no upgrades", () => {
    const cache = new PlySwapCache(20, () => 0);
    assert.equal(dispatch(admission({ contentLength: undefined }), cache, "/").status, 411);
    assert.equal(
      dispatch(admission({ transferEncodingPresent: true }), cache, "/").status,
      411,
    );
    assert.equal(dispatch(admission({ upgradePresent: true }), cache, "/").status, 400);
    assert.equal(
      dispatch(admission({ connectionUpgrade: true }), cache, "/").status,
      400,
    );
    assert.equal(dispatch(admission({ contentLength: "x" }), cache, "/").status, 400);
  });

  it("bounds requests and checks the body", () => {
    const cache = new PlySwapCache(20, () => 0);
    assert.equal(
      dispatch(admission({ contentLength: String(1024 * 1024 + 1) }), cache, "/").status,
      413,
    );
    assert.equal(
      dispatch(
        admission({ body: Buffer.from("[1]"), contentLength: "4" }),
        cache,
        "/",
      ).status,
      400,
    );
    assert.equal(
      dispatch(admission({ body: Buffer.from("{"), contentLength: "1" }), cache, "/").status,
      400,
    );
  });

  it("returns 409 for protocol rejection without a result", () => {
    const cache = new PlySwapCache(20, () => 0);
    const body = Buffer.from(JSON.stringify({ room: "r", self: "a", next: "wrong" }));
    const outcome = dispatch(
      admission({ body, contentLength: String(body.length) }),
      cache,
      "/",
    );
    assert.equal(outcome.status, 409);
    assert.equal(outcome.body, "{\"error\":\"plyswap-rejected\"}");
  });

  it("accepts the room from the query string", () => {
    const cache = new PlySwapCache(20, () => 0);
    const body = Buffer.from(JSON.stringify({ self: "a" }));
    const outcome = dispatch(
      admission({
        target: "/?room=r",
        body,
        contentLength: String(body.length),
      }),
      cache,
      "/",
    );
    assert.equal(outcome.status, 200);
    assert.deepStrictEqual(JSON.parse(outcome.body), { self: "a", room: "r" });
  });
});

function liveRequest(port: string, target: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(port),
        path: target,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      res => {
        let data = "";
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function rawRequest(port: string, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.connect(Number(port), "127.0.0.1", () => socket.write(request));
    socket.setTimeout(5000, () => socket.destroy(new Error("no early response")));
    socket.on("data", chunk => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

async function waitForFile(filePath: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      if (fs.readFileSync(filePath, "utf8").trim() !== "") {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function spawnedIntegration(): Promise<void> {
  const tmpDir = process.env.TEST_TMPDIR || os.tmpdir();
  const portFile = path.join(tmpDir, `plyswap_portfile.${process.pid}`);
  try {
    fs.unlinkSync(portFile);
  } catch {
    // ignore
  }
  let server: ChildProcess | undefined;
  try {
    server = spawn(
      process.execPath,
      [
        main_js_filepath,
        "--http_port=0",
        `--o-http-port=${portFile}`,
        "--tryswap_http_path=/tryswap",
      ],
      { stdio: "ignore" },
    );
    await waitForFile(portFile);
    const port = fs.readFileSync(portFile, "utf8").trim();

    // PlySwap lives at the default root.
    const open = await liveRequest(port, "/", JSON.stringify({ room: "r", self: "a" }));
    assert.equal(open.status, 200);
    assert.deepStrictEqual(JSON.parse(open.body), { room: "r", self: "a" });

    // Rejection must happen before a declared body arrives.
    const oversized = await rawRequest(port,
      "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1048577\r\n\r\n");
    assert.match(oversized, /^HTTP\/1\.1 413 /);
    const chunked = await rawRequest(port,
      "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n");
    assert.match(chunked, /^HTTP\/1\.1 411 /);

    const duplicateBody = JSON.stringify({ room: "duplicate", self: "poison" });
    const duplicate = await rawRequest(port,
      `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(duplicateBody)}\r\n\r\n${duplicateBody}`);
    assert.match(duplicate, /^HTTP\/1\.1 415 /);
    const fresh = await liveRequest(port, "/", JSON.stringify({ room: "duplicate", self: "fresh" }));
    assert.deepEqual(JSON.parse(fresh.body), { room: "duplicate", self: "fresh" });

    const preflight = await rawRequest(port,
      "OPTIONS / HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:9999\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type,cache-control\r\n\r\n");
    assert.match(preflight, /^HTTP\/1\.1 204 /);
    assert.match(preflight, /Access-Control-Allow-Origin: \*/i);

    // TrySwap-shaped traffic is not PlySwap.
    const legacy = await liveRequest(
      port,
      "/",
      JSON.stringify({ key: "k", sid: "s", values: [] }),
    );
    assert.equal(legacy.status, 400);

    // The opt-in TrySwap path still serves legacy clients.
    const tryswap = await liveRequest(
      port,
      "/tryswap",
      JSON.stringify({ key: "k", sid: "s", values: [] }),
    );
    assert.equal(tryswap.status, 200);

    // Unknown paths stay unknown.
    const missing = await liveRequest(port, "/nope", JSON.stringify({ room: "r", self: "a" }));
    assert.equal(missing.status, 404);
  } finally {
    if (server) {
      server.kill();
    }
    try {
      fs.unlinkSync(portFile);
    } catch {
      // ignore
    }
  }
}

test("plyswap server integration", spawnedIntegration);

test("the production server schedules cleanup of abandoned rooms", async () => {
  const cacheUrl = pathToFileURL(path.resolve(__dirname, "../../dist/src/plyswap_cache.js")).href;
  const mainUrl = pathToFileURL(main_js_filepath).href;
  const script = `
    import { PlySwapCache } from ${JSON.stringify(cacheUrl)};
    const sweep = PlySwapCache.prototype.sweep;
    PlySwapCache.prototype.sweep = function () {
      if (this.roomCount === 0) return;
      sweep.call(this, Infinity);
      process.exit(this.roomCount === 0 ? 0 : 1);
    };
    await import(${JSON.stringify(mainUrl)});
  `;
  const server = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
  });
  const exited = once(server, "exit");
  try {
    const [output] = await once(server.stdout, "data");
    const port = String(output).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port);
    const opened = await liveRequest(port, "/", JSON.stringify({ room: "abandoned", self: "a" }));
    assert.equal(opened.status, 200);
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, 0);
  } finally {
    server.kill();
    await exited;
  }
});
