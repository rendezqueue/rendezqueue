

// --- DOM Elements ---
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");

// --- State ---
let hue;
let client;

// --- Chat Logic ---

function appendMessage(msg, type) {
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", type);

  messageEl.innerText = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.sender}: ${msg.text}`;
  chatLog.appendChild(messageEl);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function on_data(messages) {
  messages.forEach(msgStr => {
    const msg = JSON.parse(msgStr);
    appendMessage(msg, "theirs");
  });
}

function sendMessage(event) {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (text === "") return;

  const timestamp = new Date().toISOString();

  const message = {
    sender: hue,
    text: text,
    timestamp: timestamp,
  };

  appendMessage(message, "mine");

  client.send(JSON.stringify(message));

  messageInput.value = "";
}

// --- Initialization ---

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
  const backendUrl = resolve_input_from_page_query(page_query, "url", "backend-url-input", "https://rendezqueue.com/tryswap");
  const roomKey = resolve_input_from_page_query(page_query, "key", "room-key-input", "default-room");
  hue = resolve_input_from_page_query(page_query, "user", "username-input", "User" + Math.floor(Math.random() * 1000));

  client = new RendezqueueClient({
    url: backendUrl,
    key: roomKey,
    hue: hue,
    on_data: on_data,
  });

  chatForm.addEventListener("submit", sendMessage);

  client.start();
}

main();
