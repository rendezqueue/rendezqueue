"use strict";

const http = require("http");
const url = require("url");
const SwapStore = require("./swapstore").SwapStore;

const hostname = "127.0.0.1";  // Listen on localhost.
const port = 5480;  // Keep in sync with lighttpd.

const MAX_KEY_BYTES = 100;
const MAX_ID_VALUE = Number.MAX_SAFE_INTEGER;
const MAX_VALUE_BYTES = 1000;

var swapstore = new SwapStore();

function respond_json_http(http_code, content_object, res) {
  res.writeHead(http_code, { "Content-Type": "application/json" });
  if (content_object) {
    res.end(JSON.stringify(content_object));
  } else {
    res.end();
  }
}

/** Actually do the handling.*/
function sanitize_and_handle_request(args, res) {
  let key = args["key"];
  let id_arg = args["id"];
  let value = args["value"];

  if (!key || key.length > MAX_KEY_BYTES) {
    respond_json_http(413, null, res);
    return;
  }

  if (!id_arg) {
    respond_json_http(413, null, res);
    return;
  }
  let id = parseInt(id_arg);
  if (isNaN(id) || id > MAX_ID_VALUE) {
    respond_json_http(413, null, res);
    return;
  }

  if (!value || value.length > MAX_VALUE_BYTES) {
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

  let result = swapstore.swap_that(key, id, value, now_ms);
  if (typeof(result) == "number") {
    respond_json_http(result, null, res);
  } else {
    respond_json_http(200, result, res);
  }
}

function handle_request_cb(req, res) {
  let u = url.parse(req.url, true);
  let args = {}
  if (req.method == 'GET') {
    args = u.query;
  } else if (req.method == 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      args = querystring.parse(body);
    });
  } else {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('go away');
    return;
  }

  sanitize_and_handle_request(args, res);
}


var server = http.createServer(handle_request_cb);
server.listen(port, hostname, () => {
  console.log("Server running at http://" + hostname + ":" + port + "/");
});

