/*
 * HTTP admission for PlySwap. No socket work takes a lock; Node runs the
 * cache synchronously on the event loop.
 */

import * as http from "http";
import { PlySwapCache } from "../plyswap_cache.js";
import {
  REQUEST_LIMIT,
  REJECTION,
  UnknownEndpointError,
  InvalidWireError,
  decodeRequest,
  encodeResponse,
  queryFromTarget,
} from "../plyswap_wire.js";

export interface Admission {
  target: string;
  method: string;
  preflightMethod?: string;
  contentType: string | undefined;
  contentEncodingPresent: boolean;
  transferEncodingPresent: boolean;
  contentLength: string | undefined;
  upgradePresent: boolean;
  connectionUpgrade: boolean;
  body: Buffer;
}

export interface Outcome {
  status: number;
  body: string;
}

function error(status: number, message: string): Outcome {
  return { status, body: JSON.stringify({ error: message }) };
}

interface Admitted {
  length: number;
  queryRoom: string | null;
}

function admit(
  admission: Omit<Admission, "body">,
  endpoint: string,
): Admitted | Outcome {
  const { target, method } = admission;
  let queryRoom: string | null;
  try {
    queryRoom = queryFromTarget(target, endpoint);
  } catch (e) {
    if (e instanceof UnknownEndpointError) {
      return error(404, "unknown endpoint");
    }
    return error(400, "invalid query room");
  }
  const query = target.includes("?") ? target.slice(target.indexOf("?") + 1) : "";

  if (method === "OPTIONS" && admission.preflightMethod === "POST") {
    return { status: 204, body: "" };
  }
  if (method !== "POST") {
    return error(405, "POST required");
  }

  const contentType = admission.contentType;
  if (
    contentType === undefined ||
    contentType.includes(",") ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return error(415, "application/json required");
  }
  if (admission.contentEncodingPresent) {
    return error(415, "content encoding not supported");
  }

  const contentLength = admission.contentLength;
  if (
    admission.transferEncodingPresent ||
    contentLength === undefined ||
    contentLength.includes(",")
  ) {
    return error(411, "one Content-Length required; transfer encoding unsupported");
  }
  if (admission.upgradePresent || admission.connectionUpgrade) {
    return error(400, "connection upgrade unsupported");
  }
  if (/^[0-9]+$/.test(contentLength) === false) {
    return error(400, "invalid Content-Length");
  }
  const length = parseInt(contentLength, 10);
  if (!Number.isSafeInteger(length)) {
    return error(400, "invalid Content-Length");
  }
  if (length + query.length > REQUEST_LIMIT) {
    return error(413, "request too large");
  }
  return { length, queryRoom };
}

function complete(body: Buffer, admitted: Admitted, cache: PlySwapCache): Outcome {
  if (body.length !== admitted.length) {
    return error(400, "incomplete request body");
  }

  let envelope;
  try {
    envelope = decodeRequest(body, admitted.queryRoom);
  } catch (e) {
    if (e instanceof InvalidWireError) {
      return error(400, "invalid PlySwap JSON");
    }
    throw e;
  }
  const reply = cache.serve(envelope.room, envelope.message);
  if (reply === null) {
    return { status: 409, body: REJECTION };
  }
  return { status: 200, body: encodeResponse(reply, envelope.b64) };
}

export function dispatch(admission: Admission, cache: PlySwapCache, endpoint: string): Outcome {
  const admitted = admit(admission, endpoint);
  return "status" in admitted ? admitted : complete(admission.body, admitted, cache);
}

function hasToken(value: string | undefined, token: string): boolean {
  if (value === undefined) return false;
  return value
    .split(",")
    .some(part => part.trim().toLowerCase() === token);
}

export function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cache: PlySwapCache,
  endpoint: string,
): void {
  const reply = (outcome: Outcome): void => {
    const body = Buffer.from(outcome.body, "utf8");
    res.writeHead(outcome.status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Content-Length": body.length,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      Connection: "close",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  const headers = req.headersDistinct;
  const admitted = admit({
    target: req.url ?? "",
    method: req.method ?? "",
    preflightMethod: headers["access-control-request-method"]?.join(","),
    contentType: headers["content-type"]?.join(","),
    contentEncodingPresent: headers["content-encoding"] !== undefined,
    transferEncodingPresent: headers["transfer-encoding"] !== undefined,
    contentLength: headers["content-length"]?.join(","),
    upgradePresent: headers["upgrade"] !== undefined,
    connectionUpgrade: hasToken(headers["connection"]?.join(","), "upgrade"),
  }, endpoint);
  if ("status" in admitted) {
    reply(admitted);
    return;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  req.on("data", (chunk: Buffer) => {
    if (res.writableEnded) return;
    length += chunk.length;
    if (length > admitted.length) {
      reply(error(413, "request too large"));
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!res.writableEnded) {
      reply(complete(Buffer.concat(chunks, length), admitted, cache));
    }
  });
  req.on("error", () => res.destroy());
}
