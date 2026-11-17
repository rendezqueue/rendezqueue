/*
 * Strict PlySwap JSON: room, self, peer, next, values, and optional b64.
 *
 * Room is required exactly once: in JSON or as ?room=..., never both.
 * Reply self echoes the requester; reply next supplies the peer's successor.
 *
 * The b64 bitmap is unchanged from TrySwap: values=1, IDs=2, room=4.
 * Unflagged bytes use Latin-1 strings; flagged bytes use base64. Both the
 * standard and URL alphabets decode (with optional correct padding); output
 * is canonical unpadded base64url.
 */

import {
  Message,
  PlySwapResponse,
  InvalidWireError,
  UnknownEndpointError,
} from "./plyswap.js";

export const ROUTE = "/";
export const REQUEST_LIMIT = 1024 * 1024;
// Own room + self ID share one admitted request budget; raw JSON escaping
// can expand each decoded byte sixfold.
export const RESPONSE_LIMIT = 12 * REQUEST_LIMIT + 1024;
export const REJECTION = "{\"error\":\"plyswap-rejected\"}";

export { InvalidWireError, UnknownEndpointError };

export function byteString(value: unknown): string {
  if (typeof value !== "string" || /[Ā-￿]/.test(value)) {
    throw new InvalidWireError("expected Latin-1 byte string");
  }
  return value;
}

export function encodeBytes(value: string, encoded = true): string {
  byteString(value);
  return encoded
    ? btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : value;
}

const BASE64_RE = /^[A-Za-z0-9_+/-]*={0,2}$/;

export function decodeBytes(value: unknown, encoded = true): string {
  if (typeof value !== "string") {
    throw new InvalidWireError("expected string");
  }
  if (!encoded) {
    return byteString(value);
  }
  if (BASE64_RE.test(value) === false) {
    throw new InvalidWireError("invalid base64");
  }
  const unpadded = value.replace(/=+$/, "");
  if (
    value.includes("=") &&
    (value.length % 4 !== 0 ||
      value.length - unpadded.length !== ((4 - (unpadded.length % 4)) % 4))
  ) {
    throw new InvalidWireError("invalid base64 padding");
  }
  const std = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new InvalidWireError("invalid base64");
  }
  const canonical = encodeBytes(decoded);
  if (canonical !== unpadded.replace(/\+/g, "-").replace(/\//g, "_")) {
    throw new InvalidWireError("nonzero base64 trailing bits");
  }
  return decoded;
}

type JsonObj = Record<string, unknown>;

function toUtf8(body: string | Uint8Array): string {
  if (typeof body === "string") {
    if (body.startsWith("\uFEFF")) {
      throw new InvalidWireError("body is not plain JSON");
    }
    return body;
  }
  const bytes = body;
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    throw new InvalidWireError("body is not plain JSON");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidWireError("body is not UTF-8");
  }
  if (text.startsWith("\uFEFF")) {
    throw new InvalidWireError("body is not plain JSON");
  }
  return text;
}

function parseObject(
  body: string | Uint8Array,
  allowRoom: boolean,
): JsonObj {
  const text = toUtf8(body);
  // Reject duplicate top-level fields before JSON.parse keeps the last one.
  rejectDuplicateTopLevelKeys(text);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new InvalidWireError("invalid PlySwap JSON");
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new InvalidWireError("expected PlySwap object");
  }
  const record = obj as JsonObj;
  const allowed = new Set(
    allowRoom
      ? ["self", "peer", "values", "next", "b64", "room"]
      : ["self", "peer", "values", "next", "b64"],
  );
  if (!("self" in record)) {
    throw new InvalidWireError("expected PlySwap object");
  }
  for (const name of Object.keys(record)) {
    if (!allowed.has(name)) {
      throw new InvalidWireError("expected PlySwap object");
    }
  }
  const rawFlags = "b64" in record ? record["b64"] : 0;
  if (
    typeof rawFlags !== "number" ||
    !Number.isInteger(rawFlags) ||
    rawFlags < 0 ||
    rawFlags > 7
  ) {
    throw new InvalidWireError("invalid b64 bitmap");
  }
  return record;
}

/** Top-level duplicate keys, e.g. {"self":"YQ","self":"Yg"}. */
function rejectDuplicateTopLevelKeys(text: string): void {
  let i = 0;
  const n = text.length;
  const skipWs = (): void => {
    while (i < n && " \t\n\r".includes(text[i] as string)) i++;
  };
  skipWs();
  if (i >= n || text[i] !== "{") {
    return;
  }
  i++;
  let depth = 1;
  let expectKey = true;
  const seen = new Set<string>();
  const readString = (): string | null => {
    // Assumes text[i] === '"'. Returns the raw inner text or null on error.
    i++;
    let raw = "";
    while (i < n) {
      const ch = text[i] as string;
      if (ch === "\\") {
        if (i + 1 >= n) return null;
        raw += ch + (text[i + 1] as string);
        i += 2;
        continue;
      }
      if (ch === "\"") {
        i++;
        return raw;
      }
      raw += ch;
      i++;
    }
    return null;
  };
  const skipValue = (): boolean => {
    skipWs();
    if (i >= n) return false;
    const ch = text[i] as string;
    if (ch === "\"") {
      return readString() !== null;
    }
    if (ch === "{" || ch === "[") {
      const open = ch;
      const close = open === "{" ? "}" : "]";
      i++;
      let d = 1;
      let inStr = false;
      while (i < n && d > 0) {
        const c = text[i] as string;
        if (inStr) {
          if (c === "\\") {
            i += 2;
            continue;
          }
          if (c === "\"") inStr = false;
          i++;
          continue;
        }
        if (c === "\"") inStr = true;
        else if (c === open) d++;
        else if (c === close) d--;
        i++;
      }
      return d === 0;
    }
    // number / true / false / null: scan to , or } at this depth.
    let inStr = false;
    while (i < n) {
      const c = text[i] as string;
      if (inStr) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "\"") inStr = false;
        i++;
        continue;
      }
      if (c === "\"") {
        inStr = true;
        i++;
        continue;
      }
      if (depth === 1 && (c === "," || c === "}")) break;
      if (c === "{" || c === "[" || c === "}" || c === "]") break;
      i++;
    }
    return true;
  };
  while (true) {
    skipWs();
    if (i >= n) return;
    const ch = text[i] as string;
    if (ch === "}") {
      return;
    }
    if (!expectKey) {
      if (ch === ",") {
        i++;
        expectKey = true;
        continue;
      }
      return;
    }
    if (ch !== "\"") {
      return;
    }
    const raw = readString();
    if (raw === null) return;
    skipWs();
    if (i >= n || text[i] !== ":") {
      return;
    }
    i++;
    let key: string;
    try {
      key = JSON.parse(`"${raw}"`) as string;
    } catch {
      return;
    }
    if (seen.has(key)) {
      throw new InvalidWireError("duplicate field");
    }
    seen.add(key);
    if (!skipValue()) return;
    expectKey = false;
  }
}

function decodePacket(obj: JsonObj): Message {
  const flags = ("b64" in obj ? obj["b64"] : 0) as number;
  const rawValues = "values" in obj ? obj["values"] : [];
  if (!Array.isArray(rawValues)) {
    throw new InvalidWireError("expected values array");
  }
  return new Message({
    self: decodeBytes(obj["self"], (flags & 2) !== 0),
    peer:
      "peer" in obj ? decodeBytes(obj["peer"], (flags & 2) !== 0) : "",
    next:
      "next" in obj ? decodeBytes(obj["next"], (flags & 2) !== 0) : "",
    values: rawValues.map(v => decodeBytes(v, (flags & 1) !== 0)),
  });
}

export function decodeMessage(body: string | Uint8Array): Message {
  return decodePacket(parseObject(body, false));
}

interface EncodedFields {
  b64?: number;
  room?: string;
  self: string;
  peer?: string;
  next?: string;
  values?: string[];
}

function encodedFields(message: Message, flags: number): EncodedFields {
  if (
    typeof flags !== "number" ||
    !Number.isInteger(flags) ||
    flags < 0 ||
    flags > 7
  ) {
    throw new InvalidWireError("invalid b64 bitmap");
  }
  const obj: EncodedFields = {} as EncodedFields;
  if (flags !== 0) {
    obj.b64 = flags;
  }
  obj.self = encodeBytes(message.self, (flags & 2) !== 0);
  if (message.peer !== "") {
    obj.peer = encodeBytes(message.peer, (flags & 2) !== 0);
  }
  if (message.next !== "") {
    obj.next = encodeBytes(message.next, (flags & 2) !== 0);
  }
  if (message.values.length > 0) {
    obj.values = message.values.map(v => encodeBytes(v, (flags & 1) !== 0));
  }
  return obj;
}

export function encodeMessage(message: Message, flags = 0): string {
  return JSON.stringify(encodedFields(message, flags));
}

export function encodeRequest(
  message: Message,
  room: string,
  flags = 0,
): string {
  const fields = encodedFields(message, flags);
  const obj: EncodedFields = {} as EncodedFields;
  if (flags !== 0) {
    obj.b64 = flags;
  }
  obj.room = encodeBytes(room, (flags & 4) !== 0);
  obj.self = fields.self;
  if (fields.peer !== undefined) obj.peer = fields.peer;
  if (fields.next !== undefined) obj.next = fields.next;
  if (fields.values !== undefined) obj.values = fields.values;
  return JSON.stringify(obj);
}

export function encodeResponse(
  response: PlySwapResponse,
  flags = 0,
): string {
  return encodeRequest(response.message, response.room, flags);
}

export function decodeResponse(body: string | Uint8Array): PlySwapResponse {
  const envelope = decodeRequest(body);
  const message = envelope.message;
  if (
    (message.next !== "" && message.peer !== "") ||
    (message.next === "" && message.values.length > 0)
  ) {
    throw new InvalidWireError("invalid PlySwap reply shape");
  }
  return new PlySwapResponse(envelope.room, message);
}

export interface Envelope {
  room: string;
  message: Message;
  b64: number;
}

export function decodeRequest(
  body: string | Uint8Array,
  queryRoom?: string | null,
): Envelope {
  const obj = parseObject(body, true);
  const hasRoom = "room" in obj;
  if (hasRoom === (queryRoom !== undefined && queryRoom !== null)) {
    throw new InvalidWireError("require room in JSON or query, not both");
  }
  const flags = (obj["b64"] ?? 0) as number;
  const rawRoom = hasRoom ? obj["room"] : (queryRoom as string);
  const room = decodeBytes(rawRoom, (flags & 4) !== 0);
  if (room === "") {
    throw new InvalidWireError("room must not be empty");
  }
  return { room, message: decodePacket(obj), b64: flags };
}

function unquotePlus(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new InvalidWireError("invalid query room");
  }
}

export function queryFromTarget(
  target: string,
  endpoint: string = ROUTE,
): string | null {
  const qIndex = target.indexOf("?");
  const path = qIndex < 0 ? target : target.slice(0, qIndex);
  if (path !== endpoint || target.includes("#")) {
    throw new UnknownEndpointError("unknown endpoint");
  }
  if (qIndex < 0) {
    return null;
  }
  const query = target.slice(qIndex + 1);
  if (
    query === "" ||
    query.includes("&") ||
    /%(?![0-9A-Fa-f]{2})/.test(query)
  ) {
    throw new InvalidWireError("expected one query room");
  }
  for (let i = 0; i < target.length; i++) {
    if ((target.charCodeAt(i) as number) > 127) {
      throw new InvalidWireError("expected one query room");
    }
  }
  const eq = query.indexOf("=");
  if (eq < 0) {
    throw new InvalidWireError("unknown query parameter");
  }
  const name = query.slice(0, eq);
  const value = query.slice(eq + 1);
  if (unquotePlus(name) !== "room") {
    throw new InvalidWireError("unknown query parameter");
  }
  return unquotePlus(value);
}
