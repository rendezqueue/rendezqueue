import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, it } from "vitest";
import SxPB from "@sxproto/sxpb";
import { PlySwapCache } from "../../src/plyswap_cache.js";
import {
  decodeRequest,
  decodeResponse,
} from "../../src/plyswap_wire.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scenarioDir = path.join(__dirname, "scenario");
const cacheDir = path.join(__dirname, "cache");

function packetText(packet: unknown): string {
  return JSON.stringify(packet);
}

function snapshot(cache: PlySwapCache, room: string): string {
  const state = (cache as any).rooms.get(room);
  if (state === undefined) return "[]";
  return JSON.stringify(
    [...state.core.rows].map(([key, row]: [string, any]) => [
      key,
      row.self,
      row.peer,
      row.next,
      [...row.values],
    ]),
  );
}

describe("plyswap protocol scenarios", () => {
  for (const file of fs.readdirSync(scenarioDir).sort()) {
    it(`replays ${file}`, () => {
      const steps = SxPB.parse(
        fs.readFileSync(path.join(scenarioDir, file), "utf8"),
      ) as any[];
      assert.ok(Array.isArray(steps) && steps.length > 0);
      const cache = new PlySwapCache(20, () => 0);
      steps.forEach((step: any, index: number) => {
        assert.deepStrictEqual(
          new Set(Object.keys(step)),
          new Set(
            ["req", "res", "reject"].filter(name => name in step),
          ),
          `${file} step ${index}`,
        );
        const envelope = decodeRequest(packetText(step.req));
        const before = snapshot(cache, envelope.room);
        const result = cache.serve(envelope.room, envelope.message);
        if (step.reject) {
          assert.equal(result, null, `${file} step ${index}`);
          assert.equal(snapshot(cache, envelope.room), before, `${file} step ${index}`);
        } else {
          const expected = decodeResponse(packetText(step.res));
          assert.notEqual(result, null, `${file} step ${index}`);
          assert.equal(result?.room, expected.room, `${file} step ${index}`);
          assert.ok(
            result?.message.equals(expected.message) ?? false,
            `${file} step ${index}`,
          );
        }
      });
    });
  }
});

describe("plyswap cache traces", () => {
  for (const file of fs.readdirSync(cacheDir).sort()) {
    it(`replays ${file}`, () => {
      const fixture = SxPB.parse(
        fs.readFileSync(path.join(cacheDir, file), "utf8"),
      ) as any;
      assert.equal(typeof fixture.ttl_ms, "number");
      let now = 0;
      const cache = new PlySwapCache(fixture.ttl_ms, () => now);
      fixture.steps.forEach((step: any, index: number) => {
        now = step.at_ms;
        if (step.sweep) {
          cache.sweep();
        } else {
          const envelope = decodeRequest(packetText(step.req));
          const result = cache.serve(envelope.room, envelope.message);
          if (step.reject) {
            assert.equal(result, null, `${file} step ${index}`);
          } else {
            const expected = decodeResponse(packetText(step.res));
            assert.notEqual(result, null, `${file} step ${index}`);
            assert.equal(result?.room, expected.room, `${file} step ${index}`);
            assert.ok(
              result?.message.equals(expected.message) ?? false,
              `${file} step ${index}`,
            );
          }
          const state = (cache as any).rooms.get(envelope.room);
          const rows = state === undefined
            ? []
            : [...state.core.rows.keys()].reverse();
          assert.deepStrictEqual(rows, step.rows ?? [], `${file} step ${index}`);
        }
        assert.equal(cache.roomCount, step.room_count, `${file} step ${index}`);
      });
    });
  }
});

describe("plyswap fixture shape", () => {
  it("keeps packets explicit and ordered", () => {
    const order = ["b64", "room", "self", "peer", "next", "values"];
    const files = [
      ...fs.readdirSync(scenarioDir).map(f => path.join(scenarioDir, f)),
      ...fs.readdirSync(cacheDir).map(f => path.join(cacheDir, f)),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const fixture = SxPB.parse(source) as any;
      const steps: any[] = Array.isArray(fixture) ? fixture : fixture.steps;
      assert.ok(Array.isArray(steps), file);
      for (const step of steps) {
        if ("req" in step) {
          assert.ok("room" in step.req, file);
          assert.ok(!("room" in step), file);
        }
        if ("res" in step) {
          assert.ok("room" in step.res, file);
        }
        for (const name of ["req", "res"]) {
          if (name in step) {
            assert.deepStrictEqual(
              Object.keys(step[name]),
              order.filter(key => key in step[name]),
              file,
            );
          }
        }
      }
      for (const line of source.split("\n")) {
        if (line.trimStart().startsWith("(()")) {
          assert.ok(
            ["(())", "(()"].includes(line.split(";", 1)[0]?.trim()),
            `${file}: ${line}`,
          );
        }
      }
    }
  });
});
