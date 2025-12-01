

main();

function stringify_tryswap_request(
  key: string,
  sid: string,
  offset: number,
  values: string[]=[],
  ttl=1,
): string {
  var d = {
    key: btoa(key),
    sid: btoa(sid),
    offset: offset,
    values: values.map(btoa),
    ttl: ttl,
  };
  return JSON.stringify(d);
}

function handle_tryswap_response(pfx: string, d: any): void {
  if (d && d.values) {
    for (let i = 0; i < d.values.length; ++i) {
      const el = document.createElement("div");
      el.innerText = pfx + d.sid.toString() + " " + i.toString() + ": " + d.values[i];
      document.body.appendChild(el);
    }
  }
}

function decode_response_cb(res: any): Promise<any> {
  return res.json()
    .then((msg: any) => {
      msg = Object.assign({}, msg);
      msg.key = atob(msg.key);
      msg.sid = atob(msg.sid);
      if (msg.values) {
        msg.values = msg.values.map(atob);
      }
      return Promise.resolve(msg);
    });
}

function initial_rendezqueue_fetch(
  backend_url: string,
  key: string,
  values: string[],
  trial=0,
): Promise<any> {
  const TRIAL_COUNT_MAX = 3;
  if (trial >= TRIAL_COUNT_MAX) {
    return Promise.reject("too many retries");
  }
  const RENDEZQUEUE_ID_MAX = 65535;
  /* const RENDEZQUEUE_ID_MAX = 16; */
  let sid = Math.floor(Math.random() * (RENDEZQUEUE_ID_MAX+1)).toString();
  return fetch(backend_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: stringify_tryswap_request(key, sid, 0, values),
  })
    .then(decode_response_cb)
    .catch(() => initial_rendezqueue_fetch(backend_url, key, values, trial+1));
}

function doit_twice(
  backend_url: string,
  key: string,
  values: string[],
): Promise<any> {
  return Promise.resolve()
    .then(() => {
      return initial_rendezqueue_fetch(backend_url, key, values);
    })
    .then(d => {
      if (d.values) {
        d.attempts = 1;
        return Promise.resolve(d);
      }
      return fetch(backend_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: stringify_tryswap_request(key, d.sid, values.length, []),
      })
        .then(decode_response_cb);
    })
    .then(d => {
      if (d.values) {
        if (!d.attempts) {
          d.attempts = 2;
        }
        return Promise.resolve(d);
      }
      return (
        new Promise<void>((resolve) => setTimeout(() => resolve(), 200))
      ).then(() => fetch(backend_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: stringify_tryswap_request(key, d.sid, values.length, []),
      }))
        .then(decode_response_cb);
    })
    .then(d => {
      if (d.values) {
        if (!d.attempts) {
          d.attempts = 2;
        }
        return Promise.resolve(d);
      }
      return Promise.reject("still failed after delay");
    });
}

function resolve_input_from_page_query(
  page_query: URLSearchParams,
  name: string,
  id: string,
  default_text: string,
): string {
  let s = page_query.get(name);
  let e = document.getElementById(id) as HTMLInputElement;
  if (s === null || s === "") {
    s = default_text;
    if (e) e.placeholder = s;
  } else {
    if (e) e.value = s;
  }
  return s;
}

function main(): void {
  const page_query = new URLSearchParams(window.location.search);
  const backend_url = resolve_input_from_page_query(
    page_query, "url", "backend_url_input",
    "https://rendezqueue.com/tryswap");
  const message_key = resolve_input_from_page_query(
    page_query, "key", "message_key_input",
    "my_message_key");
  const alice_message = resolve_input_from_page_query(
    page_query, "alice", "alice_message_input",
    "Allo from Alice!");
  const bob_message = resolve_input_from_page_query(
    page_query, "bob", "bob_message_input",
    "Bonjour from Bob!");

  Promise.allSettled([
    doit_twice(backend_url, message_key, [alice_message]),
    doit_twice(backend_url, message_key, [bob_message]),
  ])
    .then((results) => {
      for (let result of results) {
        if (result.status === "fulfilled" && result.value) {
          handle_tryswap_response(
            result.value.attempts.toString() + " attempt ",
            result.value);
        } else {
          const el = document.createElement("div");
          el.innerText = "failed " + (result.status === "rejected" ? result.reason : "unknown");
          document.body.appendChild(el);
        }
      }
    });
}
