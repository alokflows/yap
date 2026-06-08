// VoiceBridge relay.
//
// One tiny process does two jobs:
//   1. Serves the phone web app (public/index.html) over HTTP.
//   2. Runs a WebSocket relay at /ws that pairs a phone with a desktop agent
//      using a short room code, then forwards text from phone -> desktop.
//
// There is intentionally no database and no persistence. Rooms live in memory
// only and disappear when both sides disconnect. Nothing typed by the user is
// ever written to disk by this server.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8080;
const HEARTBEAT_MS = 30_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// Static file serving for the phone web app.
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (urlPath === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    // Poll endpoint for the dependency-free desktop helpers.
    // GET /poll/<CODE>/<afterId>        -> JSON  { messages: [{id,text,t}] }
    // GET /poll/<CODE>/<afterId>/text   -> lines "id<TAB>base64(text)" (shell-safe)
    // Returns only messages with id > afterId so helpers fetch just what's new.
    const pollMatch = urlPath.match(/^\/poll\/([A-Za-z0-9]{3,12})\/(\d+)(\/text)?$/);
    if (pollMatch) {
      const code = pollMatch[1];
      const after = Number(pollMatch[2]) || 0;
      const asText = Boolean(pollMatch[3]);
      const sess = sessions.get(code);
      const msgs = sess ? sess.messages.filter((m) => m.id > after) : [];
      const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      if (asText) {
        const lines = msgs
          .map((m) => `${m.id}\t${Buffer.from(m.text, 'utf8').toString('base64')}`)
          .join('\n');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
        res.end(lines);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
        res.end(JSON.stringify({ messages: msgs.map((m) => ({ id: m.id, text: m.text, t: m.t })) }));
      }
      return;
    }

    const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    let filePath = path.join(PUBLIC_DIR, requested);

    // Prevent path traversal outside the public directory.
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    let body;
    try {
      body = await readFile(filePath);
    } catch {
      // Single-page fallback so unknown paths still load the app.
      filePath = path.join(PUBLIC_DIR, 'index.html');
      body = await readFile(filePath);
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    console.error('[http] error', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

// ---------------------------------------------------------------------------
// WebSocket relay.
//
// rooms: Map<code, Map<ws, role>>  where role is 'phone' | 'desktop'.
// ---------------------------------------------------------------------------
const rooms = new Map();

const MAX_TEXT_LENGTH = 1_000_000; // ~150k words — effectively no limit for dictation
const ROOM_CODE_RE = /^[A-Za-z0-9]{3,12}$/;

// ---------------------------------------------------------------------------
// Session store (temporary "notes by code"). In-memory only — no database,
// no disk. Lets any device that joins a code see that session's past
// messages. Capped + TTL-evicted so a tiny free instance can't run out of
// memory. Resets if the host restarts; phones keep their own local copy.
// ---------------------------------------------------------------------------
const MAX_SESSION_MESSAGES = 500;                 // messages kept per code
const MAX_SESSIONS = 5_000;                        // total codes kept at once
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;        // evict a code idle for 12h
const sessions = new Map();                        // code -> { messages, updated }
let msgSeq = 0;

function getSession(code) {
  let s = sessions.get(code);
  if (!s) {
    s = { messages: [], updated: Date.now() };
    sessions.set(code, s);
    if (sessions.size > MAX_SESSIONS) {
      let oldestKey = null, oldestT = Infinity;
      for (const [k, v] of sessions) if (v.updated < oldestT) { oldestT = v.updated; oldestKey = k; }
      if (oldestKey) sessions.delete(oldestKey);
    }
  }
  return s;
}

function getRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = new Map();
    rooms.set(code, room);
  }
  return room;
}

function presence(code) {
  const room = rooms.get(code) || new Map();
  let phones = 0;
  let desktops = 0;
  for (const role of room.values()) {
    if (role === 'phone') phones += 1;
    else if (role === 'desktop') desktops += 1;
  }
  return { phones, desktops };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(code, payload, { exclude } = {}) {
  const room = rooms.get(code);
  if (!room) return;
  for (const ws of room.keys()) {
    if (ws !== exclude) send(ws, payload);
  }
}

function notifyPresence(code) {
  broadcast(code, { type: 'presence', ...presence(code) });
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const code = (params.get('room') || '').trim();
  const role = params.get('role') === 'desktop' ? 'desktop' : 'phone';

  if (!ROOM_CODE_RE.test(code)) {
    send(ws, { type: 'error', message: 'Invalid room code. Use 3-12 letters/numbers.' });
    ws.close();
    return;
  }

  ws.isAlive = true;
  ws.role = role;
  ws.code = code;

  const room = getRoom(code);
  room.set(ws, role);
  console.log(`[ws] ${role} joined room ${code} (phones/desktops:`, presence(code), ')');

  send(ws, { type: 'joined', role, room: code, ...presence(code) });
  // Replay this code's session so a fresh device sees the existing notes.
  const existing = sessions.get(code);
  if (existing && existing.messages.length) send(ws, { type: 'history', messages: existing.messages });
  notifyPresence(code);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Malformed message (expected JSON).' });
      return;
    }

    if (msg.type === 'text') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (!text) return;
      if (text.length > MAX_TEXT_LENGTH) {
        send(ws, { type: 'error', message: 'Text too long.' });
        return;
      }
      // Store in the session (so later joiners see it), then fan out.
      const m = { id: ++msgSeq, text, t: Date.now() };
      const sess = getSession(code);
      sess.messages.push(m);
      if (sess.messages.length > MAX_SESSION_MESSAGES) {
        sess.messages.splice(0, sess.messages.length - MAX_SESSION_MESSAGES);
      }
      sess.updated = m.t;
      const peers = (rooms.get(code)?.size || 1) - 1; // other connected devices
      broadcast(code, { type: 'text', id: m.id, text: m.text, t: m.t }, { exclude: ws });
      send(ws, { type: 'ack', id: m.id, t: m.t, delivered: peers });
      return;
    }

    if (msg.type === 'clear') {
      const sess = sessions.get(code);
      if (sess) { sess.messages = []; sess.updated = Date.now(); }
      broadcast(code, { type: 'cleared' }, { exclude: ws });
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }
  });

  ws.on('close', () => {
    const r = rooms.get(code);
    if (r) {
      r.delete(ws);
      if (r.size === 0) rooms.delete(code);
      else notifyPresence(code);
    }
    console.log(`[ws] ${role} left room ${code}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] socket error', err.message);
  });
});

// Heartbeat: drop sockets that stopped responding (mobile networks, sleep, etc.).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* socket already closing */
    }
  }
  // Evict idle sessions so memory stays bounded on a small free instance.
  const now = Date.now();
  for (const [code, sess] of sessions) {
    if (now - sess.updated > SESSION_TTL_MS) sessions.delete(code);
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`VoiceBridge relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint:        ws://localhost:${PORT}/ws`);
});
