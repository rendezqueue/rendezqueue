/*
 * Clock-free PlySwap core, separate from legacy TrySwap.
 *
 * Single-room newest-first discovery. serve() returns a reply message,
 * or null on protocol rejection (never a pending reply).
 *
 * IDs, rooms and values are JS strings carrying bytes via Latin-1, matching
 * the existing wire convention (Buffer latin1 <-> base64url under b64 flags).
 * Actual IDs are nonempty; empty peer/next mean absent and are omitted on
 * the wire; empty strings inside values remain valid data.
 */

export interface MessageInit {
  self: string;
  peer?: string;
  next?: string;
  values?: string[];
}

export class Message {
  readonly self: string;
  readonly peer: string;
  readonly next: string;
  readonly values: readonly string[];

  constructor(init: MessageInit) {
    if (typeof init.self !== "string" || init.self === "") {
      throw new InvalidWireError("self must be a nonempty string");
    }
    const peer = init.peer ?? "";
    const next = init.next ?? "";
    const values = init.values ?? [];
    if (typeof peer !== "string" || typeof next !== "string") {
      throw new InvalidWireError("peer and next must be strings; empty means absent");
    }
    if (!Array.isArray(values) || !values.every(v => typeof v === "string")) {
      throw new InvalidWireError("values must be an array of strings");
    }
    this.self = init.self;
    this.peer = peer;
    this.next = next;
    this.values = Object.freeze(values.slice());
  }

  isReference(): boolean {
    return this.peer === "" && this.values.length === 0 && this.next !== "";
  }

  equals(other: Message): boolean {
    return (
      this.self === other.self &&
      this.peer === other.peer &&
      this.next === other.next &&
      this.values.length === other.values.length &&
      this.values.every((v, i) => v === other.values[i])
    );
  }
}

export class PlySwapResponse {
  readonly room: string;
  readonly message: Message;

  constructor(room: string, message: Message) {
    if (typeof room !== "string" || room === "") {
      throw new InvalidWireError("room must be a nonempty string");
    }
    this.room = room;
    this.message = message;
  }

  get self(): string {
    return this.message.self;
  }
  get peer(): string {
    return this.message.peer;
  }
  get next(): string {
    return this.message.next;
  }
  get values(): readonly string[] {
    return this.message.values;
  }
}

export class InvalidWireError extends Error {}
export class UnknownEndpointError extends Error {}

export interface RecordInit {
  self: string;
  peer?: string;
  next?: string;
  values?: string[];
}

export class Record extends Message {
  constructor(init: RecordInit) {
    super({
      self: init.self,
      peer: init.peer ?? "",
      next: init.next ?? "",
      values: init.values ?? [],
    });
  }
}

export class PlySwap {
  readonly rows = new Map<string, Record>();

  private put(row: Record): void {
    // Dict insertion order is oldest-first; only put moves a row.
    this.rows.delete(row.self);
    this.rows.set(row.self, row);
  }

  private resolve(wire: Message): Message | null {
    if (wire.isReference()) {
      const row = this.rows.get(wire.self);
      if (
        row === undefined ||
        row.peer === "" ||
        row.values.length === 0 ||
        row.next !== wire.next
      ) {
        return null;
      }
      return new Message({
        self: wire.self,
        peer: row.peer,
        next: wire.next,
        values: row.values.slice(),
      });
    }
    if (wire.peer === "") {
      return wire.values.length === 0 && wire.next === "" ? wire : null;
    }
    return wire.values.length === 0 || wire.next !== "" ? wire : null;
  }

  serve(wire: Message): Message | null {
    const request = this.resolve(wire);
    if (request === null) {
      return null;
    }
    const self = request.self;
    const peer = request.peer;
    if (peer === "") {
      if (!this.rows.has(self)) {
        this.put(new Record({ self }));
      }
      const boundRow = this.rows.get(self) as Record;
      let bound = boundRow.peer;
      if (bound === "") {
        const reversed = [...this.rows.values()].reverse();
        for (const row of reversed) {
          if (
            row.self !== self &&
            (row.peer === "" || row.peer === self)
          ) {
            bound = row.self;
            break;
          }
        }
        bound = bound ?? "";
      }
      return new Message({ self, peer: bound });
    }

    if (self === peer || request.next === self || request.next === peer) {
      return null;
    }
    const old = this.rows.get(self);
    if (
      old !== undefined &&
      ((old.peer !== "" && old.peer !== peer) ||
        ((old.values.length > 0 || old.next !== "") &&
          !valuesEqual(old.values, request.values)) ||
        (old.next !== "" &&
          request.next !== "" &&
          old.next !== request.next))
    ) {
      return null;
    }
    const next = old !== undefined && old.next !== "" ? old.next : request.next;
    this.put(
      new Record({ self, peer, next, values: request.values.slice() }),
    );
    const other = this.rows.get(peer);
    if (other !== undefined && other.peer === self && other.next !== "") {
      return new Message({
        self,
        next: other.next,
        values: other.values.slice(),
      });
    }
    return new Message({ self });
  }
}

function valuesEqual(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && a.every((v, i) => v === b[i])
  );
}
