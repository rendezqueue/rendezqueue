/*
 * A client library for the Rendezqueue protocol.
 *
 * This library encapsulates polling, base64 encoding/decoding, and exchange
 * detection. It calls back to application code when new data has arrived.
 */

interface PreviousExchange {
  sid: string;
  values: string[];
  peer_sid: string;
  confirmed: boolean;
  recovering: boolean;
}

interface TrySwapRequest {
  key: string;
  sid: string;
  offset: number;
  values: string[];
  b64: number;
  ack?: string;
}

function make_request(a: Omit<TrySwapRequest, "b64">): TrySwapRequest {
  const result: TrySwapRequest = {
    key: a.key,
    sid: a.sid,
    offset: a.offset,
    values: [],
    b64: 1,
  };
  if (a.ack !== undefined) {
    result.ack = a.ack;
  }
  if (a.values.length > 0) {
    result.values = a.values.map(v => btoa(v));
  }
  return result;
}

interface RendezqueueClientInit {
  url: string;
  key: string;
  hue: string;
  on_data: (data: string[]) => void;
  on_error?: (error: any) => void;
  on_complete?: () => void;
  poll_interval_ms?: number;
}

class RendezqueueClient {
  url: string;
  key: string;
  hue: string;
  on_data: (data: string[]) => void;
  on_error: (error: any) => void;
  on_complete?: () => void;
  poll_interval_ms: number;

  sid_counter: number;
  sid: string;
  offset: number;
  outgoing_queue: string[];
  private current_values: string[] | null = null;
  private empty_wait = false;
  private previous: PreviousExchange | null = null;
  private retired_sid: string | null = null;
  private ack_next = false;

  is_polling: boolean;
  is_stopped: boolean;
  poll_interval_id: ReturnType<typeof setInterval> | null;

  constructor({
    url,
    key,
    hue,
    on_data,
    on_error = console.error,
    on_complete,
    poll_interval_ms = 2000
  }: RendezqueueClientInit) {
    this.url = url;
    this.key = key;
    this.hue = hue;
    this.on_data = on_data;
    this.on_error = on_error;
    this.on_complete = on_complete;
    this.poll_interval_ms = poll_interval_ms;

    this.sid_counter = 1;
    this.sid = `${this.hue}-${this.sid_counter}-${Math.random().toString(36).substring(2, 9)}`;
    this.offset = 0;
    this.outgoing_queue = [];

    this.is_polling = false;
    this.is_stopped = true;
    this.poll_interval_id = null;
  }

  start(): void {
    if (!this.is_stopped) {
      return;
    }
    this.is_stopped = false;
    this.poll_interval_id = setInterval(() => this._poll(), this.poll_interval_ms);
    this._poll(); // Initial poll
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
    this.outgoing_queue.push(value);
  }

  _start_new_session(): void {
    this.sid_counter++;
    this.sid = `${this.hue}-${this.sid_counter}-${Math.random().toString(36).substring(2, 9)}`;
    this.offset = 0;
    this.current_values = null;
    this.empty_wait = false;
  }

  async _poll(): Promise<void> {
    if (this.is_polling) {
      return;
    }
    this.is_polling = true;

    // Finish ACKing before offering again; then alternate old ACKs and new polls.
    const previous = this.previous;
    const ack_exchange = previous && (!previous.confirmed || previous.recovering || this.ack_next)
      ? previous : null;
    if (!ack_exchange) {
      if (this.empty_wait && this.outgoing_queue.length > 0) {
        this._start_new_session();
      }
      this.empty_wait = false;
    }
    const request_sid = ack_exchange ? ack_exchange.sid : this.sid;
    const request_key = this.key;
    const request_url = this.url;
    const snapshot_queue = ack_exchange ? ack_exchange.values : (this.current_values ?? this.outgoing_queue.slice());
    if (!ack_exchange) this.current_values = snapshot_queue;
    const request: Omit<TrySwapRequest, "b64"> = {
      key: request_key,
      sid: request_sid,
      offset: 0,
      values: snapshot_queue,
    };
    if (ack_exchange) {
      request.ack = ack_exchange.peer_sid;
      if (!ack_exchange.recovering) {
        request.offset = snapshot_queue.length;
        request.values = [];
      }
    }
    const request_body = make_request(request);
    this.ack_next = !ack_exchange;
    const live = () => this.key === request_key && this.url === request_url &&
      (ack_exchange ? this.previous === ack_exchange : this.sid === request_sid);

    try {
      const response = await fetch(request_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request_body),
      });

      if (response.status !== 200) {
        const text = await response.text();
        if (!live()) return;
        if (response.status === 404 && this.previous) this.previous.recovering = true;
        this.on_error(new Error(`Server error: ${response.status} ${text}`));
        return;
      }

      const data = await this._decode_response(response);
      if (!live()) return;
      if (data.key !== request_key || data.sid !== request_sid) {
        throw new Error("Response does not match request");
      }
      const received_values: string[] = data.values || [];
      const server_offset = data.offset || 0;
      if (ack_exchange) {
        if (data.ack === ack_exchange.sid && server_offset === ack_exchange.values.length && received_values.length === 0) {
          const newly_confirmed = !ack_exchange.confirmed;
          ack_exchange.confirmed = true;
          ack_exchange.recovering = false;
          if (newly_confirmed) this.on_complete?.();
        } else if (data.ack === undefined && server_offset === 0 && received_values.length === 0) {
          ack_exchange.recovering = true;
        }
        return;
      }
      if (server_offset !== snapshot_queue.length) {
        throw new Error("Response does not match batch length");
      }
      this.offset = server_offset;
      if (data.ack === undefined) {
        // Only a successful empty waiting probe allows a fresh SID for queued data.
        this.empty_wait = snapshot_queue.length === 0 && received_values.length === 0;
        return;
      }
      if (data.ack === request_sid || data.ack === this.retired_sid ||
          data.ack === previous?.sid || data.ack === previous?.peer_sid) {
        return;
      }

      // Terminal confirmation alone cannot retire the old pair: its peer may
      // still need recovery. This accepted next-peer receipt supplies advancement.
      this.retired_sid = previous ? previous.sid : null;
      this.previous = {
        sid: request_sid, values: snapshot_queue, peer_sid: data.ack,
        confirmed: false, recovering: false,
      };
      this.outgoing_queue.splice(0, snapshot_queue.length);
      this._start_new_session();
      if (this.on_data) {
        try {
          this.on_data(received_values.slice());
        } catch (error) {
          this.on_error(error);
        }
      }

    } catch (error) {
      if (live()) this.on_error(error);
    } finally {
      this.is_polling = false;
    }
  }

  async _decode_response(res: Response): Promise<any> {
    const msg = await res.json();
    if (!msg || typeof msg !== "object" || Array.isArray(msg) ||
        typeof msg.key !== "string" || typeof msg.sid !== "string" ||
        (msg.ack !== undefined && (typeof msg.ack !== "string" || msg.ack === "")) ||
        (msg.offset !== undefined && (!Number.isSafeInteger(msg.offset) || msg.offset < 0)) ||
        (msg.b64 !== undefined && (!Number.isSafeInteger(msg.b64) || msg.b64 < 0)) ||
        (msg.values !== undefined && (!Array.isArray(msg.values) ||
          !msg.values.every((v: unknown) => typeof v === "string")))) {
      throw new Error("Malformed response");
    }
    const decode = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    if (msg.b64 & 4) {
      msg.key = decode(msg.key);
    }
    if (msg.b64 & 2) {
      msg.sid = decode(msg.sid);
      if (typeof msg.ack === "string") {
        msg.ack = decode(msg.ack);
      }
    }
    if (msg.values && (msg.b64 & 1)) {
      msg.values = msg.values.map(decode);
    }
    return msg;
  }
}

export { RendezqueueClient };
