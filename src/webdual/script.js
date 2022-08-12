"use strict";

main();

function stringify_tryswap_request(key, id, offset, values=[], ttl=1) {
  var d = {
    key: btoa(key),
    id: btoa(id),
    offset: offset,
    values: values.map(btoa),
    ttl: ttl,
  };
  return JSON.stringify(d);
}

function handle_tryswap_response(pfx, d) {
  if (d && d.values) {
    for (let i = 0; i < d.values.length; ++i) {
      const el = document.createElement("div");
      el.innerText = pfx + d.id.toString() + " " + i.toString() + ": " + d.values[i];
      document.body.appendChild(el);
    }
  }
}

function decode_response_cb(res) {
  return res.json()
  .then((msg) => {
    msg = Object.assign({}, msg);
    msg.key = atob(msg.key);
    msg.id = atob(msg.id);
    if (msg.values) {
      msg.values = msg.values.map(atob);
    }
    return Promise.resolve(msg);
  });
}

function initial_rendezqueue_fetch(backend_url, key, values, trial=0) {
  const TRIAL_COUNT_MAX = 3;
  if (trial >= TRIAL_COUNT_MAX) {
    return Promise.reject("too many retries");
  }
  const RENDEZQUEUE_ID_MAX = 65535;
  /* const RENDEZQUEUE_ID_MAX = 16; */
  let id = Math.floor(Math.random() * (RENDEZQUEUE_ID_MAX+1)).toString();
  return fetch(backend_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: stringify_tryswap_request(key, id, 0, values),
  })
  .then(decode_response_cb)
  .catch((error) => initial_rendezqueue_fetch(backend_url, key, values, trial+1));
}

function doit_twice(backend_url, key, values) {
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
      body: stringify_tryswap_request(key, d.id, values.length, []),
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
        new Promise((resolve) => setTimeout(() => resolve(), 200))
    ).then(() => fetch(backend_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: stringify_tryswap_request(key, d.id, values.length, []),
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

function resolve_input_from_page_query(page_query, name, id, default_text) {
  let s = page_query.get(name);
  let e = document.getElementById(id);
  if (s === null || s === "") {
    s = default_text;
    e.placeholder = s;
  } else {
    e.value = s;
  }
  return s;
}

function main() {
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
      if (result.value) {
        handle_tryswap_response(
            result.value.attempts.toString() + " attempt ",
            result.value);
      }
      else {
        const el = document.createElement("div");
        el.innerText = "failed " + result.reason;
        document.body.appendChild(el);
      }
    }
  });
}

