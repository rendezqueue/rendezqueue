"use strict";

const assert = require('assert').strict;
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const main_js_filepath = path.join(__dirname, '../../src/nodejson/main.js');
const scenario_filepath = path.join(__dirname, '../scenario/webchat.json');

function request(options, body) {
  options.hostname = '127.0.0.1';
  options.method = 'POST';
  options.headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          http_status_code: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function wait_for_file(filePath) {
  while (true) {
    try {
      if (fs.readFileSync(filePath, 'utf8').trim() !== '') {
        return;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function main() {
  const tmp_dirpath = process.env.TEST_TMPDIR;
  assert.ok(tmp_dirpath);
  const port_filepath = path.join(tmp_dirpath, `portfile.${process.pid}`);

  let server;
  try {
    const args = [
      main_js_filepath,
      '--port=0',
      `--o_port=${port_filepath}`,
    ]
    server = spawn(process.execPath, args, {
      stdio: ['ignore', 'inherit', 'inherit'] // pipe server stdout/stderr
    });

    await wait_for_file(port_filepath);
    const port = fs.readFileSync(port_filepath, 'utf8').trim();
    console.log(`Server started on port ${port}`);

    const expectations = JSON.parse(fs.readFileSync(scenario_filepath, 'utf8'));

    for (const expectation of expectations) {
      const req_body = expectation.req;
      const res = await request({ port }, JSON.stringify(req_body));

      if (expectation.http_status_code) {
        assert.strictEqual(res.http_status_code, expectation.http_status_code);
      } else {
        assert.strictEqual(res.http_status_code, 200);
        const res_body = JSON.parse(res.body);
        assert.deepStrictEqual(res_body, expectation.res);
      }
    }

    console.log("--- All tests passed ---");

  } finally {
    if (server) {
      server.kill();
    }
    if (fs.existsSync(port_filepath)) {
      fs.unlinkSync(port_filepath);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
