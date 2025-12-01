import { RendezqueueClient } from "../../src/client.js";

// --- Types ---
interface SignalingMessage {
  type: "offer" | "answer" | "candidate" | "init";
  hue: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

// --- DOM Elements ---
const chatLog = document.getElementById("chat-log") as HTMLDivElement | null;
const chatForm = document.getElementById("chat-form") as HTMLFormElement | null;
const messageInput = document.getElementById("message-input") as HTMLInputElement | null;

// --- State ---
let backendUrl: string;
let roomKey: string;
let hue: string;
let peerConnection: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
let isConnected = false;
let isInitiator = false;
let remoteHue: string | null = null;
let client: RendezqueueClient;

function log(message: string): void {
  const logHue = hue ? hue.substring(5, 10) : "init";
  console.log(`[${logHue}] ${message}`);
}

function appendMessage(text: string, type: "mine" | "theirs"): void {
  if (!chatLog) return;
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", type);
  messageEl.innerText = `[${new Date().toLocaleTimeString()}] ${type === "mine" ? "sent" : "received"}: ${text}`;
  chatLog.appendChild(messageEl);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function sendMessage(event: Event): void {
  event.preventDefault();
  if (!messageInput || !dataChannel) return;

  const text = messageInput.value.trim();
  if (text === "" || !isConnected) return;

  dataChannel.send(text);
  appendMessage(text, "mine");
  messageInput.value = "";
}

function on_signaling_data(messages: string[]): void {
  for (const msgStr of messages) {
    try {
      const message = JSON.parse(msgStr) as SignalingMessage;
      handleSignalingMessage(message);
    } catch (e) {
      log(`Error parsing signaling message: ${e} on '${msgStr}'`);
    }
  }
}

async function handleSignalingMessage(message: SignalingMessage): Promise<void> {
  log(`[handleSignalingMessage] My hue: ${hue}, received message from hue: ${message.hue}`);
  log(`Handling signaling message: ${JSON.stringify(message)}`);
  if (message.hue === hue) {
    log("Ignoring own message");
    return;
  }

  // Initialize peer connection if it doesn't exist and we get an offer.
  if (message.type === "offer" && !peerConnection) {
    startWebRTC(false); // We are the answerer
  }

  if (message.type === "offer") {
    log("[handleSignalingMessage] Received offer");
    appendMessage("Received WebRTC offer", "theirs");
    if (!peerConnection) return;
    // RTCSessionDescriptionInit requires type and sdp.
    // SignalingMessage matches this structure if sdp is present.
    // We can cast or reconstruct.
    if (message.sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message as RTCSessionDescriptionInit));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      if (!peerConnection.localDescription) return;
      const answerPayload = { ...peerConnection.localDescription.toJSON(), hue: hue };
      client.send(JSON.stringify(answerPayload));
      appendMessage("Sent WebRTC answer", "mine");
    }
  } else if (message.type === "answer") {
    log("[handleSignalingMessage] Received answer");
    appendMessage("Received WebRTC answer", "theirs");
    if (!peerConnection) return;
    if (message.sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message as RTCSessionDescriptionInit));
    }
  } else if (message.type === "candidate") {
    log("[handleSignalingMessage] Received candidate");
    try {
      log("Adding ICE candidate");
      if (!peerConnection) return;
      if (message.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    } catch (e) {
      log(`Error adding received ice candidate: ${e}`);
    }
  } else if (message.type === "init") {
    // If this init is from a new peer, reset our state.
    if (remoteHue && remoteHue !== message.hue) {
      log(`New peer ${message.hue} joined, disconnecting from old peer ${remoteHue}`);
      appendMessage("New user has joined, resetting connection.", "theirs");
      resetRtc();
    }

    // If we are already trying to connect to someone, ignore.
    if (remoteHue) {
      log("Ignoring additional init message from " + message.hue);
      return;
    }

    appendMessage("Another user has joined.", "theirs");
    remoteHue = message.hue;

    // Announce our presence so the other peer can initiate if needed.
    log("Announcing presence to " + remoteHue);
    client.send(JSON.stringify({ type: "init", hue: hue }));

    if (remoteHue && hue < remoteHue) {
      isInitiator = true;
      startWebRTC(true);
    }
  }
}

function resetRtc(): void {
  if (!peerConnection && !dataChannel) {
    log("resetRtc called but nothing to reset.");
    return;
  }
  log("Resetting WebRTC connection.");
  isConnected = false;
  isInitiator = false;
  remoteHue = null;
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  isInitiator = false; // Reset initiator status
  appendMessage("WebRTC connection lost.", "theirs");
  // Restart client polling to allow for re-connection
  if(client && client.is_stopped) {
    client.start();
    log("Rendezqueue client restarted.");
    client.send(JSON.stringify({ type: "init", hue: hue }));
  }
}

function startWebRTC(initiator: boolean): void {
  if (peerConnection) {
    log("startWebRTC called but peerConnection already exists.");
    return;
  }
  log(`Initializing WebRTC as ${initiator ? "initiator" : "receiver"}`);
  appendMessage("Initializing WebRTC...", "theirs");

  isInitiator = initiator;
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      log("Generated ICE candidate");
      const candidatePayload = { type: "candidate", candidate: event.candidate.toJSON(), hue: hue };
      client.send(JSON.stringify(candidatePayload));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    log(`WebRTC connection state: ${peerConnection.connectionState}`);
    appendMessage(`WebRTC connection state: ${peerConnection.connectionState}`, "theirs");
    if (peerConnection.connectionState === "connected") {
      isConnected = true;
      if (client) {
        // Stop polling now that we have a direct connection
        client.stop();
        log("Rendezqueue client stopped.");
      }
    } else if (["disconnected", "failed", "closed"].includes(peerConnection.connectionState)) {
      resetRtc();
    }
  };

  peerConnection.onicegatheringstatechange = () => {
    if (!peerConnection) return;
    log(`ICE gathering state: ${peerConnection.iceGatheringState}`);
  };

  peerConnection.onsignalingstatechange = () => {
    if (!peerConnection) return;
    log(`Signaling state: ${peerConnection.signalingState}`);
  };

  if (isInitiator) {
    setupDataChannel(peerConnection.createDataChannel("chat"));
    peerConnection.createOffer()
      .then(offer => {
        if (!peerConnection) throw new Error("Peer connection closed");
        return peerConnection.setLocalDescription(offer);
      })
      .then(() => {
        if (!peerConnection || !peerConnection.localDescription) return;
        log("Sent WebRTC offer");
        const offerPayload = { ...peerConnection.localDescription.toJSON(), hue: hue };
        client.send(JSON.stringify(offerPayload));
        appendMessage("Sent WebRTC offer", "mine");
      })
      .catch(e => log(`Error creating offer: ${e}`));
  } else {
    peerConnection.ondatachannel = (event) => {
      log("Received data channel");
      appendMessage("Received data channel", "theirs");
      setupDataChannel(event.channel);
    };
  }
}

function setupDataChannel(channel: RTCDataChannel): void {
  log("Setting up data channel");
  dataChannel = channel;
  dataChannel.onopen = () => {
    log("WebRTC data channel is open");
    appendMessage("WebRTC data channel is open", "theirs");
  };
  dataChannel.onmessage = (event) => {
    appendMessage(event.data, "theirs");
  };
  dataChannel.onclose = () => {
    log("WebRTC data channel is closed");
    appendMessage("WebRTC data channel is closed", "theirs");
    resetRtc();
  };
  dataChannel.onerror = (error) => {
    log(`Data channel error: ${JSON.stringify(error)}`);
  };
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
      if (e) e.placeholder = s;
    }
  } else {
    if (e) e.value = s;
  }
  return s;
}

function initClient(): void {
  if (client) {
    client.stop();
  }

  // Manually reset WebRTC state to ensure we don't have lingering connections
  // and to prevent resetRtc from restarting the old client.
  if (peerConnection) {
    // Remove listeners to avoid triggering side effects during close
    peerConnection.onconnectionstatechange = null;
    peerConnection.onicecandidate = null;
    peerConnection.onicegatheringstatechange = null;
    peerConnection.onsignalingstatechange = null;
    peerConnection.ondatachannel = null;
    peerConnection.close();
    peerConnection = null;
  }
  if (dataChannel) {
    dataChannel.onopen = null;
    dataChannel.onmessage = null;
    dataChannel.onclose = null;
    dataChannel.onerror = null;
    dataChannel.close();
    dataChannel = null;
  }
  isConnected = false;
  isInitiator = false;
  remoteHue = null;

  const page_query = new URLSearchParams(window.location.search);
  backendUrl = resolve_input_from_page_query(page_query, "url", "backend-url-input", "https://rendezqueue.com/tryswap");
  roomKey = resolve_input_from_page_query(page_query, "key", "room-key-input", "default-webrtc-room");

  if(!hue) {
    hue = "user-" + Math.random().toString(36).substr(2, 9);
  }

  console.log(`Starting webrtcchat client with key: ${roomKey}`);

  client = new RendezqueueClient({
    url: backendUrl,
    key: roomKey,
    hue: hue,
    on_data: on_signaling_data,
    on_error: (e) => log(`RendezqueueClient error: ${e}`),
  });
  client.start();
  // Announce presence
  client.send(JSON.stringify({ type: "init", hue: hue }));
}

function main(): void {
  appendMessage("Waiting for another user to join...", "theirs");

  initClient();

  if (chatForm) {
    chatForm.addEventListener("submit", sendMessage);
  }

  const inputs = ["backend-url-input", "room-key-input"];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", initClient);
    }
  }
}

main();
