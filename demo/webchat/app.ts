import { RendezqueueClient } from "../../src/client.js";

// --- Types ---
interface ChatMessage {
  sender: string;
  text: string;
  timestamp: string;
}

interface IncomingMessage {
  sender: string;
  text: string;
  timestamp: string;
}

// --- DOM Elements ---
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input") as HTMLInputElement | null;

// --- State ---
let hue: string;
let client: RendezqueueClient;

// --- Chat Logic ---

function appendMessage(msg: ChatMessage | IncomingMessage, type: string): void {
  if (!chatLog) return;
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", type);

  messageEl.innerText = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.sender}: ${msg.text}`;
  chatLog.appendChild(messageEl);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function on_data(messages: string[]): void {
  messages.forEach(msgStr => {
    const msg = JSON.parse(msgStr) as IncomingMessage;
    appendMessage(msg, "theirs");
  });
}

function sendMessage(event: Event): void {
  event.preventDefault();

  if (!messageInput) return;
  const text = messageInput.value.trim();
  if (text === "") return;

  const timestamp = new Date().toISOString();

  const message: ChatMessage = {
    sender: hue,
    text: text,
    timestamp: timestamp,
  };

  appendMessage(message, "mine");

  client.send(JSON.stringify(message));

  messageInput.value = "";
}

// --- Initialization ---

function resolve_input_from_page_query(page_query: URLSearchParams, name: string, id: string, default_text: string): string {
  let s = page_query.get(name);
  const e = document.getElementById(id) as HTMLInputElement | null;

  if (s === null || s === "") {
    if (e && e.value) {
      s = e.value;
    } else {
      s = default_text;
      if (e) {
        e.placeholder = s;
      }
    }
  } else {
    if (e) {
      e.value = s;
    }
  }
  return s;
}

function initClient(): void {
  if (client) {
    client.stop();
  }

  const page_query = new URLSearchParams(window.location.search);
  const backendUrl = resolve_input_from_page_query(page_query, "url", "backend-url-input", "https://rendezqueue.com/tryswap");
  const roomKey = resolve_input_from_page_query(page_query, "key", "room-key-input", "default-room");
  hue = resolve_input_from_page_query(page_query, "user", "username-input", "User" + Math.floor(Math.random() * 1000));

  console.log(`Starting webchat client with key: ${roomKey}`);

  client = new RendezqueueClient({
    url: backendUrl,
    key: roomKey,
    hue: hue,
    on_data: on_data,
  });
  client.start();
}

function main(): void {
  initClient();

  if (chatForm) {
    chatForm.addEventListener("submit", sendMessage);
  }

  const inputs = ["backend-url-input", "room-key-input", "username-input"];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", initClient);
    }
  }
}

main();
