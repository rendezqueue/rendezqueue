"use strict";

const http = require("http");
const path = require('path');
const querystring = require("querystring");
const url = require("url");
const SwapStore = require(path.join(__dirname, "swapstore")).SwapStore;

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

function parse_post_args(args) {
  let key = args["key"];
  let id_arg = args["id"];
  let offset_arg = args["offset"];
  let values_arg = args["values"];

  let id = parseInt(id_arg);
  if (isNaN(id)) {
    return null;
  }
  let offset = parseInt(offset_arg);
  if (isNaN(offset)) {
    return null;
  }
  let values = [];
  if (values_arg) {
    values = JSON.parse(values_arg);
    if (!(values instanceof Array)) {
      return null;
    }
  }

  return {
    key: key,
    id: id,
    offset: offset,
    values: values,
  };
}

/** Actually do the handling.*/
function sanitize_and_handle_request(msg, res) {
  if (!msg) {
    respond_json_http(413, null, res);
    return;
  }
  let key = msg.key;
  let id = msg.id;
  let offset = msg.offset;
  let values = msg.values;

  if (!key || key.length > MAX_KEY_BYTES) {
    respond_json_http(413, null, res);
    return;
  }

  if (!id || id > MAX_ID_VALUE) {
    respond_json_http(413, null, res);
    return;
  }
  if (!offset) {
    offset = 0;
  }

  if (!values) {
    values = [];
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
  if (typeof(result) == "number") {
    respond_json_http(result, null, res);
  } else {
    respond_json_http(200, result, res);
  }
}

function handle_request_cb(req, res) {
  if (req.method == 'GET') {
    const u = url.parse(req.url, true);
    const msg = parse_post_args(u.query);
    sanitize_and_handle_request(msg, res);
  } else if (req.method == 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let msg = {};
      if (req.headers['content-type'] === 'application/json') {
        try {
          msg = JSON.parse(body);
        }
        catch (e) {
          msg = {}
        }
      }
      else {
        msg = parse_post_args(querystring.parse(body));
      }
      sanitize_and_handle_request(msg, res);
    });
  } else {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('go away');
  }
}


var server = http.createServer(handle_request_cb);
server.listen(port, hostname, () => {
  console.log("Server running at http://" + hostname + ":" + port + "/");
});

