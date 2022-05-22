"use strict";


const http = require("http");
const path = require('path');
const querystring = require("querystring");
const url = require("url");
const SwapStore = require(path.join(__dirname, "swapstore")).SwapStore;

const hostname = "127.0.0.1";  // Listen on localhost.
const port = 5480;  // Keep in sync with lighttpd.

const MAX_KEY_BYTES = 100;
const MAX_ID_BYTES = 100;
const MAX_VALUE_BYTES = 1000;

var swapstore = new SwapStore();

function btoa(s) {
  return Buffer.from(s, "latin1").toString("base64");
}
function atob(s) {
  return Buffer.from(s, "base64").toString("latin1");
}

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

function respond_json_http(http_code, msg, res) {
  const header_map = {
    "Access-Control-Allow-Origin": "*",  // This isn't how it works.
    "Content-Type": "application/json",
  };
  res.writeHead(http_code, header_map);
  if (msg) {
    msg.key = btoa(msg.key);
    msg.id = btoa(msg.id);
    if (msg.values) {
      msg.values = msg.values.map(btoa);
    }
    res.end(JSON.stringify(msg));
  } else {
    res.end();
  }
}

function parse_json_tryswap_request(request_text) {
  let msg = null;
  try {
    msg = JSON.parse(request_text);

    if (msg.key === undefined) {msg.key = "";}
    else if (typeof(msg.key) != "string") {throw "key";}

    if (msg.id === undefined) {msg.id = "";}
    else if (typeof(msg.id) != "string") {throw "id";}

    if (msg.offset === undefined) {msg.offset = 0;}
    else if (!Number.isInteger(msg.offset) || msg.offset < 0) {throw "offset";}

    if (msg.values === undefined) {msg.values = [];}
    else if (!Array.isArray(msg.values)) {throw "values";}

    msg.key = atob(msg.key);
    msg.id = atob(msg.id);
    msg.values = msg.values.map(atob);
  }
  catch (e) {
    console.log(e);
    msg = null;
  }
  return msg;
}

/** Actually do the handling.*/
function handle_parsed_request(msg, res) {
  if (!msg) {
    respond_json_http(400, null, res);
    return;
  }
  let key = msg.key;
  let id = msg.id;
  let offset = msg.offset;
  let values = msg.values;

  if (key.length > MAX_KEY_BYTES) {
    respond_json_http(413, null, res);
    return;
  }

  if (id.length > MAX_ID_BYTES) {
    respond_json_http(413, null, res);
    return;
  }

  if (values.reduce(((p, v) => p + v.length), 0) > MAX_VALUE_BYTES) {
    respond_json_http(413, null, res);
    return;
  }

  let hrtime_now = process.hrtime();
  let now_ms = hrtime_now[0] * 1e3 + hrtime_now[1] / 1.0e9;
  if (now_ms == 0) {
    // When would this actually return 0?
    respond_json_http(500, null, res);
    return;
  }

  let result = swapstore.tryswap(key, id, offset, values, now_ms);
  if (Number.isInteger(result)) {
    respond_json_http(result, null, res);
  } else {
    respond_json_http(200, result, res);
  }
}

function handle_request_cb(req, res) {
  if (req.method == "OPTIONS" && req.headers["access-control-request-method"] === "POST") {
    respond_options_http(req, res);
  }
  else if (req.method == "POST" && req.headers["content-type"] === "application/json") {
    let body = '';
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      let msg = parse_json_tryswap_request(body);
      handle_parsed_request(msg, res);
    });
  }
  else {
    respond_json_http(418, {}, res);
  }
}


var server = http.createServer(handle_request_cb);
server.listen(port, hostname, () => {
  console.log("Server running at http://" + hostname + ":" + port + "/");
});

