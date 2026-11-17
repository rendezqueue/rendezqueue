import { strict as assert } from "node:assert";
import { test, vi } from "vitest";
import { Message } from "../../src/plyswap.js";
import { PlySwapCache } from "../../src/plyswap_cache.js";

test("sweeps abandoned rooms using elapsed time, unaffected by wall-clock corrections", () => {
  const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
  const wall = vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    const cache = new PlySwapCache();
    cache.serve("abandoned", new Message({ self: "a" }));
    elapsed.mockReturnValue(19_000);
    wall.mockReturnValue(1_000_000);
    cache.sweep();
    assert.equal(cache.roomCount, 1);
    elapsed.mockReturnValue(21_000);
    wall.mockReturnValue(-1_000_000);
    cache.sweep();
    assert.equal(cache.roomCount, 0);
  } finally {
    vi.restoreAllMocks();
  }
});
