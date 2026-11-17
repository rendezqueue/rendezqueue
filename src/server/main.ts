
import * as http from "http";
import * as url from "url";
import * as fs from "fs";
import * as path from "path";
import process from "node:process";
import { RendezqueueJsonImpl } from "./rendezqueue_json_impl.js";
import { PlySwapCache } from "../plyswap_cache.js";
import { handle as handle_plyswap } from "./plyswap_http.js";


let rendezqueue_json_impl = new RendezqueueJsonImpl();
let plyswap_cache = new PlySwapCache();

// Flags.
let argmap = new Map<string, string>();
argmap.set("http_host", "127.0.0.1");
argmap.set("http_path", "/");

for (let i = 2; i < process.argv.length; ++i) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) {
    console.log("Not a flag: " + arg);
    process.exit(64);
  }
  const eqidx = arg.indexOf("=");
  if (eqidx < 0) {
    console.log("Need flags to have equal sign.");
    process.exit(64);
  }
  const argkey = arg.slice(2, eqidx);
  const argval = arg.slice(eqidx+1);
  argmap.set(argkey.replaceAll("-", "_"), argval);
}

function validate_http_path(name: string, value: string): void {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    /\s/.test(value)
  ) {
    console.log(`${name} must be a full absolute HTTP path.`);
    process.exit(64);
  }
}

const http_path = argmap.get("http_path") ?? "/";
validate_http_path("--http_path", http_path);
const tryswap_http_path = argmap.get("tryswap_http_path");
if (tryswap_http_path !== undefined) {
  validate_http_path("--tryswap_http_path", tryswap_http_path);
  if (tryswap_http_path === http_path) {
    console.log("TrySwap and PlySwap paths must differ.");
    process.exit(64);
  }
}

const http_host = argmap.get("http_host") ?? "127.0.0.1";
const port_filepath = argmap.get("o_http_port");
let port = parseInt(argmap.get("http_port") ?? "0", 10);
if (Number.isNaN(port)) {
  port = 0; // Default to 0 if not provided or not a number
}

let demo_urlpath = argmap.get("demo_urlpath");
if (demo_urlpath) {
  demo_urlpath = demo_urlpath.replace(/^\/+/, "");
  demo_urlpath = demo_urlpath.replace(/\/+$/, "");
}
// End flags.

function respond_options_http(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const http_status_code = 204;
  let http_header_map: http.OutgoingHttpHeaders = {
    // "Access-Control-Max-Age": 86400,
    // "Cache-Control": "public, max-age=86400",
    // "Vary": "Origin",
  };
  if (req.headers["access-control-request-headers"]) {
    http_header_map["Access-Control-Allow-Headers"] = req.headers["access-control-request-headers"];
  }
  if (req.headers["access-control-request-method"]) {
    http_header_map["Access-Control-Allow-Methods"] = req.headers["access-control-request-method"];
  }
  if (req.headers["origin"]) {
    http_header_map["Access-Control-Allow-Origin"] = req.headers["origin"];
  }
  res.writeHead(http_status_code, http_header_map);
  res.end();
}

function respond_json_string_http(
  http_code: number,
  response_text: string,
  res: http.ServerResponse,
): void {
  const header_map = {
    "Access-Control-Allow-Origin": "*",  // This isn't how it works.
    "Content-Type": "application/json",
  };
  res.writeHead(http_code, header_map);
  res.end(response_text);
}

function serve_static_file(res: http.ServerResponse, filepath: string, contentType: string): void {
  fs.readFile(filepath, (err, data) => {
    if (err) {
      respond_json_string_http(404, "Not Found", res);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function handle_request_cb(req: http.IncomingMessage, res: http.ServerResponse): void {
  const parsed_url = url.parse(req.url ?? "");
  const req_urlpath = parsed_url.pathname ?? "";

  // 1. PlySwap RPC (default).
  if (req_urlpath === http_path) {
    handle_plyswap(req, res, plyswap_cache, http_path);
    return;
  }

  // 2. TrySwap RPC (explicit opt-in).
  if (tryswap_http_path !== undefined && req_urlpath === tryswap_http_path) {
    if (req.method == "OPTIONS" && req.headers["access-control-request-method"] === "POST") {
      respond_options_http(req, res);
    } else if (req.method == "POST" && req.headers["content-type"] === "application/json") {
      let body = "";
      req.on("data", chunk => {
        body += chunk.toString();
      });
      req.on("end", () => {
        let result = rendezqueue_json_impl.TrySwap_string(body);
        if (Number.isInteger(result)) {
          respond_json_string_http(result as number, "", res);
        } else {
          respond_json_string_http(200, result as string, res);
        }
      });
    } else {
      respond_json_string_http(418, "", res);
    }
    return;
  }

  // 3. Static Files (if demo_dirpath is set)
  if (demo_urlpath) {
    const demo_dirpath = "demo";
    // 2a. /src/client.js
    // Adjust the path based on demo_urlpath depth to match relative imports (../../src/client.js)
    let client_js_urlpath = "/src/client.js";
    const lastSlash = demo_urlpath.lastIndexOf("/");
    if (lastSlash >= 0) {
      const prefix = demo_urlpath.substring(0, lastSlash);
      client_js_urlpath = `/${prefix}/src/client.js`;
    }

    const client_modules = ["client.js", "plyswap.js", "plyswap_wire.js", "tryswap_client.js"];
    const client_dir = client_js_urlpath.slice(0, -"client.js".length);
    const client_module = client_modules.find(name => req_urlpath === client_dir + name);
    if (client_module) {
      const client_js_filepath = path.resolve(process.cwd(), "dist/src", client_module);
      serve_static_file(res, client_js_filepath, "application/javascript");
      return;
    }

    // 2b. /demo_urlpath/...
    if (req_urlpath.startsWith(`/${demo_urlpath}/`)) {
      const req_relurlpath = req_urlpath.substring(demo_urlpath.length + 2); // remove "/demo_urlpath/"
      if (req_relurlpath.includes("..")) {
        respond_json_string_http(403, "Forbidden", res);
        return;
      }

      // Try source (for HTML, CSS)
      const source_filepath = path.resolve(process.cwd(), demo_dirpath, req_relurlpath);
      if (fs.existsSync(source_filepath) && !source_filepath.endsWith(".js")) {
        let contentType = "text/plain";
        if (source_filepath.endsWith(".html")) contentType = "text/html";
        else if (source_filepath.endsWith(".css")) contentType = "text/css";
        serve_static_file(res, source_filepath, contentType);
        return;
      }

      // Try dist (for JS)
      const dist_filepath = path.resolve(process.cwd(), "dist", demo_dirpath, req_relurlpath);
      if (fs.existsSync(dist_filepath)) {
        let contentType = "text/plain";
        if (dist_filepath.endsWith(".js")) contentType = "application/javascript";
        serve_static_file(res, dist_filepath, contentType);
        return;
      }
    }
  }

  // 4. 404
  respond_json_string_http(404, "", res);
}


var server = http.createServer(handle_request_cb);
const sweep_interval = setInterval(() => plyswap_cache.sweep(), 1000);
sweep_interval.unref();
server.once("close", () => clearInterval(sweep_interval));
server.listen(port, http_host, () => {
  const chosen_port = (server.address() as any).port;
  console.log(`PlySwap at http://${http_host}:${chosen_port}${http_path}`);
  if (tryswap_http_path !== undefined) {
    console.log(`TrySwap at http://${http_host}:${chosen_port}${tryswap_http_path}`);
  }
  if (port_filepath) {
    fs.writeFileSync(port_filepath, chosen_port.toString());
  }
  if (demo_urlpath) {
    const backend_url = encodeURIComponent(`http://${http_host}:${chosen_port}${http_path}`);
    const tryswap_url = tryswap_http_path !== undefined
      ? encodeURIComponent(`http://${http_host}:${chosen_port}${tryswap_http_path}`)
      : backend_url;
    console.log("Demo mode enabled. Try:");
    console.log(`  http://${http_host}:${chosen_port}/${demo_urlpath}/webchat/index.html?url=${backend_url}`);
    console.log(`  http://${http_host}:${chosen_port}/${demo_urlpath}/webrtcchat/index.html?url=${backend_url}`);
    console.log(`  http://${http_host}:${chosen_port}/${demo_urlpath}/webdual/index.html?url=${tryswap_url}`);
  }
});
