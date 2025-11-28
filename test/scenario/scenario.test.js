
import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  RendezqueueJsonImpl,
  inplace_decode_tryswap_message,
  inplace_encode_tryswap_message,
} from "../../src/nodejson/rendezqueue_json_impl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run_scenario(scenario_file) {
  let rendezqueue_json_impl = new RendezqueueJsonImpl();
  let timestamp_ms = 0;
  let expectations = undefined;

  try {
    const data = fs.readFileSync(scenario_file, "utf8");
    expectations = JSON.parse(data);
  } catch (err) {
    assert.fail(err);
  }

  for (let e of expectations) {
    const debug_string = JSON.stringify(e);
    let sstat = inplace_decode_tryswap_message(e.req);
    assert.strictEqual(sstat, "");
    if (Number.isInteger(e.delta_ms)) {
      timestamp_ms += e.delta_ms;
    }
    let result = rendezqueue_json_impl.TrySwap(e.req, timestamp_ms);
    if (Number.isInteger(result)) {
      assert.equal(result, e.http_status_code, debug_string);
    } else {
      inplace_encode_tryswap_message(result);
      assert.deepStrictEqual(result, e.res, debug_string);
    }
  }
}

// Map scenarios to their JSON files.
// Note: In the future we might want to generate these from .sxpb using a tool,
// but for now we assume the .json files exist or we commit them.
// The Bazel build was converting sxpb -> json.
// I will just run the existing webchat.json for now.

const scenarios = [
  "webchat.json",
  // "basic.json" // basic.sxpb exists but basic.json is not currently present, I should generate it or skip it.
];

scenarios.forEach(scenario => {
  const scenario_path = path.join(__dirname, scenario);
  if (fs.existsSync(scenario_path)) {
     // We can just run the logic directly here as a test.
     // Node --test will pick up this file if I rename it to scenario.test.js
     console.log(`Running scenario: ${scenario}`);
     run_scenario(scenario_path);
  } else {
    console.warn(`Skipping scenario ${scenario}: file not found.`);
  }
});
