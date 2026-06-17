const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const els = {
  code: $("code"), connect: $("connectBtn"), disconnect: $("disconnectBtn"),
  status: $("status"), statusText: $("statusText"), hint: $("hint"),
  modePaste: $("modePaste"), modeCopy: $("modeCopy"),
  paused: $("pausedChk"), undo: $("undoBtn"),
  feed: $("feed"), count: $("count"), msg: $("msg"), send: $("sendBtn"),
  toast: $("toast"),
};

let connected = false;
let messages = 0;

function setStatus(state, text) {
  els.status.dataset.state = state;
  els.statusText.textContent = text;
  connected = state === "connected" || state === "connecting";
  els.connect.classList.toggle("hidden", connected);
  els.disconnect.classList.toggle("hidden", !connected);
}

let toastTimer = null;
function toast(text, kind = "") {
  els.toast.textContent = text;
  els.toast.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = "toast " + kind), 1800);
}

function addMessage(dir, text, delivered) {
  const li = document.createElement("li");
  li.className = "bubble " + (dir === "out" ? "out" : "in");
  const t = document.createElement("div");
  t.className = "txt";
  t.textContent = text;
  li.appendChild(t);
  if (dir === "out") {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = delivered > 0 ? `✓ ${delivered} device${delivered > 1 ? "s" : ""}` : "sent";
    li.appendChild(m);
  }
  els.feed.appendChild(li);
  els.feed.scrollTop = els.feed.scrollHeight;
  els.count.textContent = String(++messages);
}

// ---- connect / disconnect ----
async function doConnect() {
  const code = els.code.value.trim();
  if (!code) { toast("Enter a code", "bad"); return; }
  try {
    await invoke("connect", { code });
    setStatus("connecting", "Connecting…");
  } catch (e) { toast(String(e), "bad"); }
}
async function doDisconnect() {
  try { await invoke("disconnect"); } catch {}
  setStatus("offline", "Not connected");
}

els.connect.addEventListener("click", doConnect);
els.disconnect.addEventListener("click", doDisconnect);
els.code.addEventListener("keydown", (e) => { if (e.key === "Enter") doConnect(); });

// ---- mode + controls ----
function setMode(paste) {
  els.modePaste.setAttribute("aria-selected", String(paste));
  els.modeCopy.setAttribute("aria-selected", String(!paste));
  invoke("set_paste", { on: paste });
}
els.modePaste.addEventListener("click", () => setMode(true));
els.modeCopy.addEventListener("click", () => setMode(false));
els.paused.addEventListener("change", () => invoke("set_paused", { on: els.paused.checked }));
els.undo.addEventListener("click", () => { invoke("undo"); toast("Undid last paste"); });

// ---- send ----
els.msg.addEventListener("input", () => (els.send.disabled = !els.msg.value.trim()));
async function doSend() {
  const text = els.msg.value.trim();
  if (!text) return;
  try { await invoke("send_text", { text }); els.msg.value = ""; els.send.disabled = true; }
  catch (e) { toast(String(e), "bad"); }
}
els.send.addEventListener("click", doSend);
els.msg.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });

// ---- events from Rust ----
listen("yap://status", (e) => {
  const { state, devices, error } = e.payload;
  if (state === "connected") setStatus("connected", devices > 0 ? `${devices} device${devices > 1 ? "s" : ""}` : "Waiting for your phone…");
  else if (state === "connecting") setStatus("connecting", "Connecting…");
  else { setStatus("offline", error || "Not connected"); if (error) toast(error, "bad"); }
});
listen("yap://message", (e) => {
  const { dir, text, delivered } = e.payload;
  addMessage(dir, text, delivered || 0);
});

// ---- init ----
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const s = await invoke("get_settings");
    setMode(s.paste);
    els.paused.checked = s.paused;
  } catch {}
  setStatus("offline", "Not connected");
});
