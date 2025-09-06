"use strict";

const http = require("http");
const path = require("path");
const querystring = require("querystring");
const url = require("url");
const fs = require("fs");
const RendezqueueJsonImpl = require(path.join(__dirname, "rendezqueue_json_impl")).RendezqueueJsonImpl;


let rendezqueue_json_impl = new RendezqueueJsonImpl();

// Flags.
let argmap = new Map();
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

const http_host = argmap.get("http_host");
const port_filepath = argmap.get("o_http_port");
let port = parseInt(argmap.get("http_port"), 10);
if (Number.isNaN(port)) {
  port = 0; // Default to 0 if not provided or not a number
}
// End flags.

function respond_options_http(req, res) {
  const http_status_code = 204;
  let http_header_map = {
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

function respond_json_string_http(http_code, response_text, res) {
  const header_map = {
    "Access-Control-Allow-Origin": "*",  // This isn't how it works.
    "Content-Type": "application/json",
  };
  res.writeHead(http_code, header_map);
  res.end(response_text);
}

function handle_request_cb(req, res) {
  const http_path = argmap.get("http_path");
  const parsed_url = url.parse(req.url);
  if (parsed_url.pathname !== http_path) {
    respond_json_string_http(404, "", res);
    return;
  }
  if (req.method == "OPTIONS" && req.headers["access-control-request-method"] === "POST") {
    respond_options_http(req, res);
  }
  else if (req.method == "POST" && req.headers["content-type"] === "application/json") {
    let body = '';
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      let result = rendezqueue_json_impl.TrySwap_string(body);
      if (Number.isInteger(result)) {
        respond_json_string_http(result, "", res);
      } else {
        respond_json_string_http(200, result, res);
      }
    });
  }
  else {
    respond_json_string_http(418, "", res);
  }
}


var server = http.createServer(handle_request_cb);
server.listen(port, http_host, () => {
  const chosen_port = server.address().port;
  console.log(`Server running at http://${http_host}:${chosen_port}/`);
  if (port_filepath) {
    fs.writeFileSync(port_filepath, chosen_port.toString());
  }
});

