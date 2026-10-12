
import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, it } from "vitest";
import SxPB from "@sxproto/sxpb";
import {
  RendezqueueJsonImpl,
  inplace_decode_tryswap_message,
  inplace_encode_tryswap_message,
} from "../../src/server/rendezqueue_json_impl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scenarios = [
  "basic.sxpb",
  "conditional_ack.sxpb",
  "expiry.sxpb",
  "webchat.sxpb",
];

describe("scenario tests", () => {
  for (const scenario_file of scenarios) {
    it(`runs scenario ${scenario_file}`, () => {
      const sxpb_path = path.join(__dirname, "scenario", scenario_file);
      const sxpb_content = fs.readFileSync(sxpb_path, "utf8");
      const expectations = SxPB.parse(sxpb_content);

      const rendezqueue_json_impl = new RendezqueueJsonImpl();
      let timestamp_ms = 0;

      for (const e of (expectations as any)) {
        if (Object.keys(e).length === 0) continue;

        if (e.seed_pair !== undefined) {
          const seed = e.seed_pair;
          rendezqueue_json_impl.swapstore.tryswap(
            seed.key, seed.left_sid, 0, "", seed.left_values, timestamp_ms, 5,
          );
          rendezqueue_json_impl.swapstore.tryswap(
            seed.key, seed.right_sid, 0, "", seed.right_values, timestamp_ms, 5,
          );
          continue;
        }
        if (e.expire_answer !== undefined) {
          const expiry = e.expire_answer;
          const answer_map = rendezqueue_json_impl.swapstore.swapped_answer_multimap.get(expiry.key);
          if (answer_map !== undefined) {
            answer_map.delete(expiry.sid);
          }
          continue;
        }

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
