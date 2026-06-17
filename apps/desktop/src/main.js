const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const WEB_URL = "https://yap-mkk4.onrender.com";

const $ = (id) => document.getElementById(id);
const els = {
  pairStart: $("pairStart"), pairJoin: $("pairJoin"), pairLocked: $("pairLocked"),
  createBtn: $("createBtn"), joinBtn: $("joinBtn"), joinGo: $("joinGo"), joinBack: $("joinBack"),
  code: $("code"), codeDisplay: $("codeDisplay"),
  qrBtn: $("qrBtn"), inviteBtn: $("inviteBtn"), changeBtn: $("changeBtn"),
  qrModal: $("qrModal"), qrClose: $("qrClose"), qrImg: $("qrImg"), qrCodeLabel: $("qrCodeLabel"),
  status: $("status"), statusText: $("statusText"),
  tabChat: $("tabChat"), tabDevices: $("tabDevices"),
  panelChat: $("panelChat"), panelDevices: $("panelDevices"),
  type: $("typeChk"), autoCopy: $("autoCopyChk"), undo: $("undoBtn"),
  feed: $("feed"), msg: $("msg"), send: $("sendBtn"),
  devices: $("devices"), devicesEmpty: $("devicesEmpty"),
  sheet: $("sheet"), sheetPreview: $("sheetPreview"), sheetCopy: $("sheetCopy"), sheetResend: $("sheetResend"), sheetCancel: $("sheetCancel"),
  toast: $("toast"),
};

let currentCode = "";

// ---- pairing states ----
function setPairState(state) {
  els.pairStart.classList.toggle("hidden", state !== "start");
  els.pairJoin.classList.toggle("hidden", state !== "join");
  els.pairLocked.classList.toggle("hidden", state !== "locked");
  if (state === "join") setTimeout(() => els.code.focus(), 0);
}
function setStatus(state, text) {
  els.status.dataset.state = state;
  els.statusText.textContent = text;
}

let toastTimer = null;
function toast(text, kind = "") {
  els.toast.textContent = text;
  els.toast.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = "toast " + kind), 1700);
}

// Same generator as the web app — no ambiguous 0/O/1/I.
function generateCode(len = 6) {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += cs[arr[i] % cs.length];
  return out;
}

async function connectWith(code) {
  code = (code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(code)) { toast("Enter a 3–12 char code", "bad"); return; }
  currentCode = code;
  els.codeDisplay.textContent = code;
  setPairState("locked");
  setStatus("connecting", "Connecting…");
  try { await invoke("connect", { code }); }
  catch (e) { toast(String(e), "bad"); setPairState("start"); setStatus("offline", "Not connected"); }
}

els.createBtn.addEventListener("click", () => connectWith(generateCode()));
els.joinBtn.addEventListener("click", () => { els.code.value = ""; setPairState("join"); });
els.joinBack.addEventListener("click", () => setPairState("start"));
els.joinGo.addEventListener("click", () => connectWith(els.code.value));
els.code.addEventListener("keydown", (e) => { if (e.key === "Enter") connectWith(els.code.value); });
els.codeDisplay.addEventListener("click", () => { invoke("copy_to_clipboard", { text: currentCode }); toast("Code copied ✓", "good"); });

els.changeBtn.addEventListener("click", async () => {
  try { await invoke("disconnect"); } catch {}
  currentCode = "";
  els.devices.innerHTML = ""; els.devicesEmpty.classList.remove("hidden");
  setPairState("start");
  setStatus("offline", "Not connected");
});

// ---- QR + invite ----
els.qrBtn.addEventListener("click", () => {
  if (!currentCode) { toast("Connect with a code first", "bad"); return; }
  const url = WEB_URL + "/?room=" + encodeURIComponent(currentCode);
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    els.qrImg.src = qr.createDataURL(8, 16);
    els.qrCodeLabel.textContent = currentCode;
    els.qrModal.hidden = false;
    requestAnimationFrame(() => els.qrModal.classList.add("show"));
  } catch { toast("Could not build QR", "bad"); }
});
function closeQr() { els.qrModal.classList.remove("show"); setTimeout(() => (els.qrModal.hidden = true), 200); }
els.qrClose.addEventListener("click", closeQr);
els.qrModal.addEventListener("click", (e) => { if (e.target === els.qrModal) closeQr(); });
els.inviteBtn.addEventListener("click", () => {
  if (!currentCode) { toast("Connect with a code first", "bad"); return; }
  invoke("copy_to_clipboard", { text: WEB_URL + "/?room=" + encodeURIComponent(currentCode) });
  toast("Invite link copied ✓", "good");
});

// ---- chat feed ----
function addMessage(dir, text, delivered) {
  const li = document.createElement("li");
  li.className = "bubble " + (dir === "out" ? "out" : "in");
  li._text = text;
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
}

// ---- tabs ----
function setTab(tab) {
  els.tabChat.setAttribute("aria-selected", String(tab === "chat"));
  els.tabDevices.setAttribute("aria-selected", String(tab === "devices"));
  els.panelChat.classList.toggle("hidden", tab !== "chat");
  els.panelDevices.classList.toggle("hidden", tab !== "devices");
}
els.tabChat.addEventListener("click", () => setTab("chat"));
els.tabDevices.addEventListener("click", () => setTab("devices"));

// ---- toggles ----
els.type.addEventListener("change", () => invoke("set_type_at_cursor", { on: els.type.checked }));
els.autoCopy.addEventListener("change", () => invoke("set_auto_copy", { on: els.autoCopy.checked }));
els.undo.addEventListener("click", () => { invoke("undo"); toast("Undid last paste"); });

// ---- send ----
els.msg.addEventListener("input", () => (els.send.disabled = !els.msg.value.trim()));
async function doSend(text) {
  const t = (text ?? els.msg.value).trim();
  if (!t) return;
  try {
    await invoke("send_text", { text: t });
    if (text == null) { els.msg.value = ""; els.send.disabled = true; }
  } catch (e) { toast(String(e), "bad"); }
}
els.send.addEventListener("click", () => doSend());
els.msg.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });

// ---- per-message sheet (right-click) ----
let sheetText = null;
function openSheet(text) {
  sheetText = text;
  els.sheetPreview.textContent = text;
  els.sheet.hidden = false;
  requestAnimationFrame(() => els.sheet.classList.add("show"));
}
function closeSheet() {
  els.sheet.classList.remove("show");
  setTimeout(() => { els.sheet.hidden = true; sheetText = null; }, 180);
}
els.feed.addEventListener("contextmenu", (e) => {
  const li = e.target.closest("li.bubble");
  if (!li) return;
  e.preventDefault();
  openSheet(li._text);
});
els.sheetCopy.addEventListener("click", () => { if (sheetText != null) { invoke("copy_to_clipboard", { text: sheetText }); toast("Copied ✓", "good"); } closeSheet(); });
els.sheetResend.addEventListener("click", () => { const t = sheetText; closeSheet(); if (t) doSend(t); });
els.sheetCancel.addEventListener("click", closeSheet);
els.sheet.addEventListener("click", (e) => { if (e.target === els.sheet) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!els.sheet.hidden) closeSheet(); if (!els.qrModal.hidden) closeQr(); } });

// ---- devices ----
// Same clean per-OS SVG glyphs as the web app, so the Devices list matches everywhere.
const OS_ICON = {
  Windows: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.4 10.4 4.3v7.2H3zM11.3 4.2 21 2.8v8.7h-9.7zM3 12.5h7.4v7.2L3 18.6zM11.3 12.5H21v8.7l-9.7-1.4z"/></svg>',
  macOS: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.8c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-.9 2.3-1.9c.7-1 1-2 1-2.1-.1 0-2-.8-2-2.9zM14.6 6.2c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"/></svg>',
  iOS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  Android: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="10" rx="2"/><path d="M7 8 6 4M17 8l1-4M9 13h.01M15 13h.01"/></svg>',
  Linux: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3a3 3 0 0 1 6 0c0 2 1 3 2 6s1 6-1 9H8c-2-3-2-6-1-9s2-4 2-6z"/><path d="M10 9h.01M14 9h.01"/></svg>',
  Device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
};
function renderDevices(list) {
  els.devices.innerHTML = "";
  if (!list.length) { els.devicesEmpty.classList.remove("hidden"); return; }
  els.devicesEmpty.classList.add("hidden");
  for (const d of list) {
    const row = document.createElement("div");
    row.className = "device" + (d.is_me ? " me" : "");
    const kind = d.os === "iOS" || d.os === "Android" ? "Phone" : d.os !== "Device" ? "Computer" : "Device";
    row.innerHTML = `<span class="dev-os">${OS_ICON[d.os] || OS_ICON.Device}</span>
      <span class="dev-info"><span class="dev-name">${d.name}</span>
      <span class="dev-sub">${kind}${d.is_me ? " · this device" : ""}${d.is_host ? ' · <b class="host">host</b>' : ""}</span></span>`;
    els.devices.appendChild(row);
  }
}

// ---- events from Rust ----
listen("ripple://status", (e) => {
  const { state, devices, error } = e.payload;
  if (state === "connected") setStatus("connected", devices > 0 ? `${devices} device${devices > 1 ? "s" : ""}` : "Waiting for your phone…");
  else if (state === "connecting") setStatus("connecting", "Connecting…");
  else { setStatus("offline", error || (currentCode ? "Reconnecting…" : "Not connected")); if (error) toast(error, "bad"); }
});
listen("ripple://message", (e) => addMessage(e.payload.dir, e.payload.text, e.payload.delivered || 0));
listen("ripple://devices", (e) => renderDevices(e.payload || []));
// Injector couldn't type at the cursor (e.g. Wayland with no typing tool) —
// the text is on the clipboard instead; let the user know.
listen("ripple://notice", (e) => toast(String(e.payload), "bad"));

// ---- init ----
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const s = await invoke("get_settings");
    els.type.checked = s.type_at_cursor;
    els.autoCopy.checked = s.auto_copy;
  } catch {}
  setTab("chat");
  setPairState("start");
  setStatus("offline", "Not connected");
});
