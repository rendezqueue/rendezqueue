/*
 * Volatile per-ID inactivity policy; not part of the clock-free protocol.
 *
 * One PlySwap core per room; each observed self ID refreshes its own
 * activity timestamp. Idle rooms and idle IDs expire after ttl.
 */

import { Message, PlySwap, PlySwapResponse } from "./plyswap.js";

export const DEFAULT_TTL = 20;

interface Room {
  core: PlySwap;
  refreshed: Map<string, number>;
}

export class PlySwapCache {
  readonly ttl: number;
  private readonly clock: () => number;
  private readonly rooms = new Map<string, Room>();

  constructor(ttl: number = DEFAULT_TTL, clock?: () => number) {
    if (
      typeof ttl !== "number" ||
      !Number.isFinite(ttl) ||
      ttl <= 0
    ) {
      throw new Error("PlySwap TTL must be finite and positive");
    }
    this.ttl = ttl;
    this.clock = clock ?? (() => performance.now() / 1000);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  serve(room: string, request: Message, now?: number): PlySwapResponse | null {
    const at = now ?? this.clock();
    let state = this.rooms.get(room);
    if (state === undefined) {
      state = { core: new PlySwap(), refreshed: new Map() };
    }
    expireRoom(state, at, this.ttl);
    const result = state.core.serve(request);
    if (result !== null) {
      state.refreshed.set(request.self, at);
    }
    if (state.core.rows.size > 0) {
      this.rooms.set(room, state);
    } else {
      this.rooms.delete(room);
    }
    return result !== null ? new PlySwapResponse(room, result) : null;
  }

  sweep(now?: number): void {
    const at = now ?? this.clock();
    for (const [room, state] of [...this.rooms]) {
      expireRoom(state, at, this.ttl);
      if (state.core.rows.size === 0) {
        this.rooms.delete(room);
      }
    }
  }
}

function expireRoom(state: Room, now: number, ttl: number): void {
  for (const [self, refreshed] of [...state.refreshed]) {
    if (now - refreshed >= ttl) {
      state.refreshed.delete(self);
      state.core.rows.delete(self);
    }
  }
}
