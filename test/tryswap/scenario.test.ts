
import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, it } from "node:test";
import SxPB from "@sxproto/sxpb";
import {
  RendezqueueJsonImpl,
  inplace_decode_tryswap_message,
  inplace_encode_tryswap_message,
} from "../../src/server/rendezqueue_json_impl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scenarios = ["basic.sxpb", "webchat.sxpb"];

describe("scenario tests", () => {
  for (const scenario_file of scenarios) {
    it(`runs scenario ${scenario_file}`, () => {
      const sxpb_path = path.join(__dirname, "scenario", scenario_file);
      const sxpb_content = fs.readFileSync(sxpb_path, "utf8");
      const expectations = SxPB.parse(sxpb_content);

      const rendezqueue_json_impl = new RendezqueueJsonImpl();
      let timestamp_ms = 0;

      for (const e of expectations) {
        if (Object.keys(e).length === 0) continue;

        const debug_string = JSON.stringify(e);
        const sstat = inplace_decode_tryswap_message(e.req);
        assert.strictEqual(sstat, "", `Decode failed for ${debug_string}`);

        if (Number.isInteger(e.delta_ms)) {
          timestamp_ms += e.delta_ms;
        }

        const result = rendezqueue_json_impl.TrySwap(e.req, timestamp_ms);
        if (Number.isInteger(result)) {
          assert.equal(result, e.http_status_code, debug_string);
        } else {
          inplace_encode_tryswap_message(result);
          assert.deepStrictEqual(result, e.res, debug_string);
        }
      }
    });
  }
});
