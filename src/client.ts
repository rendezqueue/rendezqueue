/*
 * PlySwap client library.
 *
 * This library encapsulates retained snapshots, generation-scoped IDs and
 * polling. It calls back to application code when the peer's batch arrives.
 * Endpoint and room are fixed for this retained client's lifetime.
 *
 * Values are strings carrying bytes via Latin-1, matching the wire
 * convention (flagged bytes use base64). The client always sends b64=7.
 */

import { Message } from "./plyswap.js";
import {
  REQUEST_LIMIT,
  RESPONSE_LIMIT,
  REJECTION,
  byteString,
  decodeResponse,
  encodeRequest,
} from "./plyswap_wire.js";

type Mode = "current" | "previous";

interface Packet {
  attempt: number;
  request: Message;
}

export interface ClientCompletion {
  values: string[];
  generation: number;
}

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 10) +
    Math.random().toString(36).substring(2, 10);
}

class ClientState {
  readonly namespace: string;
  generation = 0;
  nextAttempt = 0;
  peer = "";
  batch: string[] | null = null;
  queued: string[] = [];
  previous: Message | null = null;
  active: Packet | null = null;
  currentCached = false;
  previousCached = false;
  currentAdvertised = false;

  constructor(namespace: string) {
    if (namespace === "") {
      throw new Error("namespace must be nonempty");
    }
    this.namespace = byteString(namespace);
  }

  id(generation: number): string {
    if (!Number.isInteger(generation) || generation < 0 || generation > MAX_COUNTER) {
      throw new Error("PlySwap generation exhausted");
    }
    return `${this.namespace}#${generation}`;
  }

  get selfId(): string {
    return this.id(this.generation);
  }

  stored(): string[] {
    return [
      ...(this.previous !== null ? [...this.previous.values] : []),
      ...(this.batch ?? []),
      ...this.queued,
    ];
  }

  enqueue(value: string): void {
    this.queued.push(byteString(value));
  }

  timeout(packet: Packet | null = null): void {
    if (packet === null || this.active === packet) {
      this.active = null;
    }
  }

  private current(): Message {
    const values = this.peer !== "" ? (this.batch ?? []) : [];
    return new Message({
      self: this.selfId,
      peer: this.peer,
      next: values.length > 0 ? this.id(this.generation + 1) : "",
      values,
    });
  }

  private slot(request: Message): Mode | null {
    if (this.previous !== null && this.previous.equals(request)) {
      return "previous";
    }
    if (this.peer !== "" && request.equals(this.current())) {
      return "current";
    }
    return null;
  }

  private hint(slot: Mode): boolean {
    return slot === "current" ? this.currentCached : this.previousCached;
  }

  private setHint(slot: Mode, value: boolean): void {
    if (slot === "current") {
      this.currentCached = value;
    } else {
      this.previousCached = value;
    }
  }

  send(mode: Mode): Packet | null {
    if (mode !== "current" && mode !== "previous") {
      throw new Error("invalid PlySwap attempt mode");
    }
    if (this.active !== null) {
      return null;
    }
    if (mode === "previous" && this.previous === null) {
      return null;
    }
    if (this.nextAttempt >= MAX_COUNTER) {
      throw new Error("PlySwap attempt counter exhausted");
    }
    let request: Message;
    if (mode === "current") {
      this.id(this.generation + 1); // Check before freezing any queued input.
      if (this.peer !== "" && this.batch === null && this.queued.length > 0) {
        this.batch = this.queued;
        this.queued = [];
        this.currentCached = false;
      }
      request = this.current();
    } else {
      request = this.previous as Message;
    }
    const slot = this.slot(request);
    if (
      slot !== null &&
      this.hint(slot) &&
      request.values.length > 0 &&
      request.peer !== ""
    ) {
      request = new Message({ self: request.self, next: request.next });
    }
    const packet: Packet = { attempt: this.nextAttempt, request };
    this.nextAttempt += 1;
    this.active = packet;
    return packet;
  }

  private logical(request: Message): Message | null {
    if (request.isReference()) {
      const same = (snapshot: Message | null): boolean =>
        snapshot !== null &&
        snapshot.self === request.self &&
        snapshot.next === request.next &&
        snapshot.peer !== "" &&
        snapshot.values.length > 0;
      if (same(this.previous)) {
        return this.previous;
      }
      const current = this.current();
      return same(current) ? current : null;
    }
    if (request.peer === "") {
      return request.values.length === 0 && request.next === "" ? request : null;
    }
    return request.values.length === 0 || request.next !== "" ? request : null;
  }

  /**
   * A null reply is exact protocol rejection, never a transport failure.
   * Accepted completions are returned as events.
   */
  accept(packet: Packet, reply: Message | null): ClientCompletion | null {
    if (this.active !== packet) {
      return null;
    }
    this.active = null;
    const request = this.logical(packet.request);
    if (request === null) {
      return null;
    }
    if (
      reply !== null &&
      ((reply.next !== "" && reply.peer !== "") ||
        (reply.next === "" && reply.values.length > 0))
    ) {
      return null;
    }
    if (
      reply !== null &&
      reply.self === this.selfId &&
      request.self === this.selfId
    ) {
      this.currentAdvertised = true;
    }
    if (request.peer === "") {
      if (
        reply !== null &&
        reply.peer !== "" &&
        reply.next === "" &&
        this.previous === null &&
        this.peer === "" &&
        this.generation === 0 &&
        request.equals(this.current()) &&
        reply.self === request.self &&
        reply.peer !== request.self
      ) {
        this.peer = reply.peer;
      }
      return null;
    }
    const slot = this.slot(request);
    if (slot === null) {
      return null;
    }
    if (reply === null) {
      if (packet.request.isReference()) {
        this.setHint(slot, false);
      }
      return null;
    }
    if (reply.self !== request.self) {
      return null;
    }
    if (packet.request.values.length > 0) {
      this.setHint(slot, true);
    }
    if (slot === "current" && reply.next !== "") {
      const generation = this.generation + 1;
      const ownNext = this.id(generation);
      if (reply.next === ownNext) {
        return null;
      }
      this.generation = generation;
      this.currentAdvertised = false;
      this.peer = reply.next;
      this.batch = null;
      this.previous = new Message({
        self: request.self,
        peer: request.peer,
        next: ownNext,
        values: [...request.values],
      });
      this.previousCached = this.currentCached;
      this.currentCached = false;
      return { values: [...reply.values], generation };
    }
    return null;
  }
}

function checkEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("absolute HTTP(S) endpoint without query/fragment required");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname === "" ||
    endpoint.includes("?") ||
    endpoint.includes("#") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("absolute HTTP(S) endpoint without query/fragment required");
  }
}

async function exchange(
  endpoint: string,
  room: string,
  message: Message,
): Promise<Message | null> {
  const body = encodeRequest(message, room, 7);
  const bodyBytes = new TextEncoder().encode(body).length;
  if (bodyBytes > REQUEST_LIMIT) {
    throw new Error("not sent: request exceeds 1 MiB; frozen batch remains retained");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body,
    });
  } catch (error) {
    throw new Error(
      `transport failed; delivery is uncertain: ${(error as Error).message}`,
    );
  }
  if (response.status !== 200 && response.status !== 409) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}; delivery may have occurred`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes(",") ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    await response.body?.cancel();
    throw new Error("invalid response content type; delivery is uncertain");
  }
  const bytes = await readResponse(response);
  if (response.status === 409) {
    if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== REJECTION) {
      throw new Error("not a PlySwap protocol rejection; delivery is uncertain");
    }
    return null;
  }
  const decoded = decodeResponse(bytes);
  if (decoded.room !== room) {
    throw new Error("response room does not match request; delivery is uncertain");
  }
  if (decoded.self !== message.self) {
    throw new Error("response self does not match request; delivery is uncertain");
  }
  return decoded.message;
}

async function readResponse(response: Response): Promise<Uint8Array> {
  // Fetch handles framing/decompression; bound the decoded bytes, not Content-Length.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > RESPONSE_LIMIT) {
          await reader.cancel();
          throw new Error("response exceeds size limit; delivery is uncertain");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

interface RendezqueueClientInit {
  url: string;
  room: string;
  hue: string;
  on_data: (data: string[]) => void;
  on_error?: (error: any) => void;
  poll_interval_ms?: number;
}

class RendezqueueClient {
  readonly url: string;
  readonly room: string;
  readonly hue: string;
  on_data: (data: string[]) => void;
  on_error: (error: any) => void;
  poll_interval_ms: number;

  private core: ClientState;
  private previousNext = false;
  is_polling = false;
  is_stopped = true;
  private poll_interval_id: ReturnType<typeof setInterval> | null = null;

  constructor({
    url,
    room,
    hue,
    on_data,
    on_error = console.error,
    poll_interval_ms = 2000,
  }: RendezqueueClientInit) {
    checkEndpoint(url);
    if (room === "") {
      throw new Error("room must not be empty");
    }
    if (
      new TextEncoder().encode(encodeRequest(new Message({ self: "\x00" }), room, 7)).length >
      REQUEST_LIMIT
    ) {
      throw new Error("room exceeds request envelope limit");
    }
    this.url = url;
    this.room = room;
    this.hue = hue;
    this.on_data = on_data;
    this.on_error = on_error;
    this.poll_interval_ms = poll_interval_ms;
    this.core = new ClientState(`${hue}-${randomSuffix()}`);
  }

  get currentAdvertised(): boolean {
    return this.core.currentAdvertised;
  }

  start(): void {
    if (!this.is_stopped) {
      return;
    }
    this.is_stopped = false;
    this.poll_interval_id = setInterval(() => void this._poll(), this.poll_interval_ms);
    void this._poll(); // Initial poll
  }

  stop(): void {
    if (this.is_stopped) {
      return;
    }
    this.is_stopped = true;
    if (this.poll_interval_id) {
      clearInterval(this.poll_interval_id);
    }
    this.poll_interval_id = null;
  }

  send(value: string): void {
    this.core.enqueue(value);
  }

  async _poll(): Promise<void> {
    if (this.is_polling) {
      return;
    }
    this.is_polling = true;
    // Alternate even on errors, so old recovery cannot starve new input and
    // continuous new input cannot starve previous retries.
    const mode: Mode = this.previousNext && this.core.previous !== null
      ? "previous"
      : "current";
    this.previousNext = mode === "current";
    const packet = this.core.send(mode);
    if (packet === null) {
      this.is_polling = false;
      return;
    }
    try {
      const reply = await exchange(this.url, this.room, packet.request);
      const completion = this.core.accept(packet, reply);
      if (completion !== null && this.on_data) {
        this.on_data(completion.values);
      }
    } catch (error) {
      this.core.timeout(packet);
      this.on_error(error);
    } finally {
      this.is_polling = false;
    }
  }
}

export { RendezqueueClient, ClientState };
export type { RendezqueueClientInit, Mode };
