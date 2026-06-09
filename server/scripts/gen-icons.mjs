// Generates Yap's icon — the SVG (browser tab + in-app mark) and every PWA PNG
// (iOS apple-touch + Android maskable/any) — from ONE vector definition, so they
// always match. No image libraries: just signed-distance math + zlib.
//   Run: node scripts/gen-icons.mjs
//
// The mark: a speech bubble whose body follows the golden ratio (φ ≈ 1.618),
// with a single soft, centred tail and a gentle "yep" nod inside. Every form is
// a curve blended with a smooth-minimum — no sharp corners anywhere.
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '..', 'public', 'icons');
const PUBLIC = path.join(DIR, '..', 'public');
mkdirSync(OUT, { recursive: true });

const CLAY  = [196, 103, 63];   // #c4673f
const PAPER = [250, 243, 237];  // #faf3ed
const PHI = 1.6180339887;

// ---- signed-distance helpers (art lives in the unit square, y points down) --
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const len = (x, y) => Math.hypot(x, y);
const sdRoundRect = (px, py, cx, cy, hx, hy, r) => {
  const qx = Math.abs(px - cx) - (hx - r), qy = Math.abs(py - cy) - (hy - r);
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => len(px - cx, py - cy) - r;
const sdSegment = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return len(pax - bax * h, pay - bay * h) - r;
};
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };

// ---- the mark, defined once -------------------------------------------------
const W = 0.64, H = W / PHI;          // body: golden-ratio rectangle
const BX = 0.5, BY = 0.205 + H / 2;   // body centre
const RR = H * 0.45;                  // soft body corner radius
const TAIL = [0.5, BY + H / 2 + 0.048, 0.082]; // centred tail nub [cx, cy, r]
// "yep" nod — a gentle smile arc (quadratic bézier, p1 is the control point)
const NOD = { p0: [0.355, 0.345], p1: [0.50, 0.475], p2: [0.645, 0.345], r: 0.034 };

const bubbleSDF = (u, v) =>
  smin(sdRoundRect(u, v, BX, BY, W / 2, H / 2, RR), sdCircle(u, v, TAIL[0], TAIL[1], TAIL[2]), 0.095);
const nodSDF = (u, v) => {
  let best = 1e9, prx = NOD.p0[0], pry = NOD.p0[1];
  for (let i = 1; i <= 48; i++) {
    const t = i / 48, it = 1 - t;
    const x = it * it * NOD.p0[0] + 2 * it * t * NOD.p1[0] + t * t * NOD.p2[0];
    const y = it * it * NOD.p0[1] + 2 * it * t * NOD.p1[1] + t * t * NOD.p2[1];
    best = Math.min(best, sdSegment(u, v, prx, pry, x, y, NOD.r));
    prx = x; pry = y;
  }
  return best;
};
// Art colour at unit (u,v): clay nod over paper bubble, or null outside.
const artColor = (u, v) => (bubbleSDF(u, v) > 0 ? null : nodSDF(u, v) <= 0 ? CLAY : PAPER);

// ---- PNG raster (clay tile + art, with maskable safe-zone inset) ------------
function render(N, { maskable }) {
  const SS = 4, M = N * SS;
  const acc = new Float64Array(N * N * 4);
  for (let sy = 0; sy < M; sy++) {
    for (let sx = 0; sx < M; sx++) {
      const u = sx / M, v = sy / M;
      let col = null;
      if (maskable ? true : sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.223) <= 0) col = [...CLAY];
      const au = maskable ? (u - 0.1) / 0.8 : u; // art inset into the safe zone
      const av = maskable ? (v - 0.1) / 0.8 : v;
      if (au >= 0 && au <= 1 && av >= 0 && av <= 1) {
        const c = artColor(au, av);
        if (c) col = c;
      }
      const oi = ((sy >> Math.log2(SS)) * N + (sx >> Math.log2(SS))) * 4;
      if (col) { acc[oi] += col[0]; acc[oi + 1] += col[1]; acc[oi + 2] += col[2]; acc[oi + 3] += 255; }
    }
  }
  const px = Buffer.alloc(N * N * 4), per = SS * SS;
  for (let i = 0; i < N * N; i++) {
    const a = acc[i * 4 + 3] / per, cov = a / 255 || 1e-9;
    px[i * 4]     = Math.round(acc[i * 4]     / per / cov);
    px[i * 4 + 1] = Math.round(acc[i * 4 + 1] / per / cov);
    px[i * 4 + 2] = Math.round(acc[i * 4 + 2] / per / cov);
    px[i * 4 + 3] = Math.round(a);
  }
  return px;
}

// ---- SVG: trace the bubble's outline from the same SDF (marching squares) ---
function traceBubble(N) {
  const f = (x, y) => bubbleSDF(x / (N - 1), y / (N - 1));
  const interp = (x1, y1, v1, x2, y2, v2) => {
    const t = v1 / (v1 - v2);
    return [(x1 + t * (x2 - x1)) / (N - 1), (y1 + t * (y2 - y1)) / (N - 1)];
  };
  const segs = [];
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const tl = f(x, y), tr = f(x + 1, y), br = f(x + 1, y + 1), bl = f(x, y + 1);
      let c = 0;
      if (tl < 0) c |= 8; if (tr < 0) c |= 4; if (br < 0) c |= 2; if (bl < 0) c |= 1;
      if (c === 0 || c === 15) continue;
      const top = () => interp(x, y, tl, x + 1, y, tr);
      const right = () => interp(x + 1, y, tr, x + 1, y + 1, br);
      const bottom = () => interp(x, y + 1, bl, x + 1, y + 1, br);
      const left = () => interp(x, y, tl, x, y + 1, bl);
      const P = { 1: [left, bottom], 2: [bottom, right], 3: [left, right], 4: [top, right],
        6: [top, bottom], 7: [left, top], 8: [top, left], 9: [top, bottom], 11: [top, right],
        12: [left, right], 13: [bottom, right], 14: [left, bottom] };
      if (c === 5) { segs.push([left(), top()], [bottom(), right()]); }
      else if (c === 10) { segs.push([top(), right()], [left(), bottom()]); }
      else { const [a, b] = P[c]; segs.push([a(), b()]); }
    }
  }
  // stitch segments into one ordered loop (single blob -> single contour)
  const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const byKey = new Map();
  segs.forEach((s, i) => [0, 1].forEach((e) => {
    const k = key(s[e]); (byKey.get(k) || byKey.set(k, []).get(k)).push([i, e]);
  }));
  const used = new Array(segs.length).fill(false);
  used[0] = true;
  const loop = [segs[0][0], segs[0][1]];
  let cur = segs[0][1];
  for (;;) {
    const cand = (byKey.get(key(cur)) || []).find(([si]) => !used[si]);
    if (!cand) break;
    used[cand[0]] = true;
    cur = segs[cand[0]][1 - cand[1]];
    if (key(cur) === key(loop[0])) break;
    loop.push(cur);
  }
  return loop;
}

// closed Catmull-Rom -> cubic-bézier path, scaled to the 512 viewBox
function bezierPath(pts) {
  const S = 512, f = (v) => +(v * S).toFixed(1), n = pts.length, P = (i) => pts[((i % n) + n) % n];
  let d = `M${f(P(0)[0])} ${f(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

function writeSVG() {
  const loop = traceBubble(360);
  const step = Math.max(1, Math.round(loop.length / 72));
  const pts = loop.filter((_, i) => i % step === 0);
  const S = 512, f = (p) => `${+(p[0] * S).toFixed(1)} ${+(p[1] * S).toFixed(1)}`;
  const sw = Math.round(NOD.r * 2 * S); // nod stroke width
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Yap">
  <rect width="512" height="512" rx="114" fill="#c4673f"/>
  <path d="${bezierPath(pts)}" fill="#faf3ed"/>
  <path d="M${f(NOD.p0)} Q${f(NOD.p1)} ${f(NOD.p2)}" fill="none" stroke="#c4673f" stroke-width="${sw}" stroke-linecap="round"/>
</svg>
`;
  writeFileSync(path.join(PUBLIC, 'icon.svg'), svg);
  console.log('wrote icon.svg');
}

// ---- PNG encoder (unchanged) ------------------------------------------------
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([l, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

writeSVG();
const targets = [
  { file: 'icon-180.png', n: 180, maskable: false },
  { file: 'icon-192.png', n: 192, maskable: false },
  { file: 'icon-512.png', n: 512, maskable: false },
  { file: 'icon-maskable-512.png', n: 512, maskable: true },
];
for (const t of targets) {
  writeFileSync(path.join(OUT, t.file), encodePNG(t.n, t.n, render(t.n, { maskable: t.maskable })));
  console.log('wrote', t.file);
}
