// Yap relay.
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
const MAX_KNOWN_DIDS = 50;                          // remembered devices per code
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;        // evict a code idle for 12h
const sessions = new Map();                        // code -> session (see below)
let msgSeq = 0;

// A session carries this code's room policy alongside its notes, so a host's
// lock survives brief disconnects (it lives as long as the 12h session does):
//   messages   past notes for late joiners
//   open       whether *new/unknown* devices may join (host-controlled)
//   hostDid    device id of the host (first device to join)
//   knownDids  devices allowed to (re)join even when locked — Set, insertion-ordered
function getSession(code) {
  let s = sessions.get(code);
  if (!s) {
    s = { messages: [], updated: Date.now(), open: true, hostDid: null, knownDids: new Set() };
    sessions.set(code, s);
    if (sessions.size > MAX_SESSIONS) {
      let oldestKey = null, oldestT = Infinity;
      for (const [k, v] of sessions) if (v.updated < oldestT) { oldestT = v.updated; oldestKey = k; }
      if (oldestKey) sessions.delete(oldestKey);
    }
  }
  return s;
}

function rememberDevice(sess, did) {
  if (!did) return;
  sess.knownDids.add(did);
  // Evict oldest devices past the cap, but never the host — otherwise a busy
  // code could lock its own host out on reconnect.
  while (sess.knownDids.size > MAX_KNOWN_DIDS) {
    let evicted = false;
    for (const d of sess.knownDids) {
      if (d !== sess.hostDid) { sess.knownDids.delete(d); evicted = true; break; }
    }
    if (!evicted) break;
  }
}

function getRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = new Map();
    rooms.set(code, room);
  }
  return room;
}

// Live room state: connection counts + the visible member list + lock policy.
// Built only on join/leave/lock changes — never on the per-message hot path.
function roomState(code) {
  const room = rooms.get(code) || new Map();
  const sess = sessions.get(code);
  const hostDid = sess ? sess.hostDid : null;
  let phones = 0, desktops = 0;
  const members = [];
  for (const m of room.values()) {
    if (m.role === 'phone') phones += 1; else if (m.role === 'desktop') desktops += 1;
    members.push({ id: m.id, role: m.role, isHost: !!hostDid && m.did === hostDid });
  }
  return { phones, desktops, members, open: sess ? sess.open : true, hostDid };
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

function notifyRoom(code) {
  broadcast(code, { type: 'presence', ...roomState(code) });
}

let connSeq = 0;
function sanitizeDid(raw) {
  return (raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const code = (params.get('room') || '').trim();
  const role = params.get('role') === 'desktop' ? 'desktop' : 'phone';
  const did = sanitizeDid(params.get('did'));

  if (!ROOM_CODE_RE.test(code)) {
    send(ws, { type: 'error', message: 'Invalid room code. Use 3-12 letters/numbers.' });
    ws.close();
    return;
  }

  const sess = getSession(code);

  // Lock enforcement: when the host has turned "Allow others" off, only devices
  // this session already knows may (re)join. The host's own phone/computer keep
  // their device id, so they reconnect freely; unknown devices are refused.
  if (!sess.open && did && !sess.knownDids.has(did)) {
    send(ws, { type: 'error', code: 'locked', message: 'This room is locked by its host.' });
    ws.close();
    return;
  }

  // First device to ever join becomes the host.
  if (!sess.hostDid && did) sess.hostDid = did;
  rememberDevice(sess, did);
  sess.updated = Date.now();

  ws.isAlive = true;
  ws.role = role;
  ws.code = code;
  ws.did = did;
  ws.connId = 'c' + (++connSeq);

  const room = getRoom(code);
  room.set(ws, { role, did, id: ws.connId, joinedAt: Date.now() });
  console.log(`[ws] ${role} joined room ${code}`);

  send(ws, { type: 'joined', role, room: code, id: ws.connId, did, ...roomState(code) });
  // Replay this code's session so a fresh device sees the existing notes.
  if (sess.messages.length) send(ws, { type: 'history', messages: sess.messages });
  notifyRoom(code);

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

    // Host toggles whether new/unknown devices may join. Only the host's own
    // device id is allowed to change it; everyone is then told the new state.
    if (msg.type === 'setOpen') {
      if (sess.hostDid && ws.did === sess.hostDid) {
        sess.open = !!msg.open;
        sess.updated = Date.now();
        notifyRoom(code);
      }
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
      if (r.size === 0) {
        rooms.delete(code);
      } else {
        // If the host's device fully left, hand host to the oldest remaining
        // device so the "Allow others" control never gets orphaned.
        const s = sessions.get(code);
        if (s && s.hostDid && ![...r.values()].some((m) => m.did === s.hostDid)) {
          // Hand host to the oldest remaining device that has a real device id
          // (skip id-less helpers/agents so the lock control is never orphaned).
          let oldest = null;
          for (const m of r.values()) if (m.did && (!oldest || m.joinedAt < oldest.joinedAt)) oldest = m;
          s.hostDid = oldest ? oldest.did : null;
        }
        notifyRoom(code);
      }
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
  console.log(`Yap relay listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint:        ws://localhost:${PORT}/ws`);
});
