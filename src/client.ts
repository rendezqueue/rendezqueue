/*
 * A client library for the Rendezqueue protocol.
 *
 * This library encapsulates polling, base64 encoding/decoding, and exchange
 * detection. It calls back to application code when new data has arrived.
 */

interface RendezqueueClientInit {
  url: string;
  key: string;
  hue: string;
  on_data: (data: string[]) => void;
  on_error?: (error: any) => void;
  poll_interval_ms?: number;
}

class RendezqueueClient {
  url: string;
  key: string;
  hue: string;
  on_data: (data: string[]) => void;
  on_error: (error: any) => void;
  poll_interval_ms: number;

  sid_counter: number;
  sid: string;
  offset: number;
  outgoing_queue: string[];

  is_polling: boolean;
  is_stopped: boolean;
  poll_interval_id: ReturnType<typeof setInterval> | null;

  constructor({
    url,
    key,
    hue,
    on_data,
    on_error = console.error,
    poll_interval_ms = 2000
  }: RendezqueueClientInit) {
    this.url = url;
    this.key = key;
    this.hue = hue;
    this.on_data = on_data;
    this.on_error = on_error;
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
  }

  async _poll(): Promise<void> {
    if (this.is_polling) {
      return;
    }
    this.is_polling = true;

    const request_body = {
      key: this.key,
      sid: this.sid,
      offset: this.offset,
      values: this.outgoing_queue.map(v => btoa(v)),
      b64: 1,
    };

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request_body),
      });

      if (response.status !== 200) {
        const text = await response.text();
        this.on_error(new Error(`Server error: ${response.status} ${text}`));
        return;
      }

      const data = await this._decode_response(response);
      const received_values = data.values || [];
      const session_has_ended = received_values.length > 0 || (data.offset > 0 && data.ttl === undefined);

      if (session_has_ended) {
        // The server acknowledged all messages up to our sent offset.
        // Any messages in our queue were part of the exchange.
        this.offset = data.offset;
        this.outgoing_queue = [];

        if (this.on_data) {
          this.on_data(received_values);
        }

        this._start_new_session();

      } else { // session is still open
        const server_offset = data.offset || 0;
        const sent_count = server_offset - this.offset;
        if(sent_count > 0){
          this.outgoing_queue.splice(0, sent_count);
        }
        this.offset = server_offset;
      }

    } catch (error) {
      this.on_error(error);
    } finally {
      this.is_polling = false;
    }
  }

  async _decode_response(res: Response): Promise<any> {
    const msg = await res.json();
    if (msg.b64 & 4) {
      msg.key = atob(msg.key);
    }
    if (msg.b64 & 2) {
      msg.sid = atob(msg.sid);
    }
    if (msg.values && (msg.b64 & 1)) {
      msg.values = msg.values.map((v: string) => atob(v));
    }
    return msg;
  }
}

export { RendezqueueClient };
