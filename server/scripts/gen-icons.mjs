// Generates Yap's PWA PNG icons from a tiny vector definition — no image
// libraries, just math + zlib. Run: node scripts/gen-icons.mjs
// Keeps the repo dependency-free while still shipping proper raster icons
// (iOS apple-touch-icon and Android maskable icons can't use SVG).
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const CLAY = [196, 103, 63];   // #c4673f
const PAPER = [250, 243, 237]; // #faf3ed

const inRR = (px, py, x, y, w, h, r) => {
  const qx = Math.max(x + r, Math.min(px, x + w - r));
  const qy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - qx, dy = py - qy;
  return dx * dx + dy * dy <= r * r;
};
const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d1 = sign(px, py, ax, ay, bx, by), d2 = sign(px, py, bx, by, cx, cy), d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

// Art is defined in a unit square. Returns [r,g,b,a] (a in 0..1) or null.
function artColor(u, v) {
  // speech bubble body + downward tail
  const bubble = inRR(u, v, 0.16, 0.17, 0.68, 0.46, 0.17)
    || inTri(u, v, 0.30, 0.60, 0.205, 0.82, 0.46, 0.60);
  if (!bubble) return null;
  // smile: lower band of a circle
  const dx = u - 0.50, dy = v - 0.305;
  const dist = Math.hypot(dx, dy);
  const onArc = Math.abs(dist - 0.165) <= 0.042 && v > 0.34 && u > 0.30 && u < 0.70;
  return onArc ? [...CLAY, 1] : [...PAPER, 1];
}

function render(N, { maskable }) {
  const SS = 4, M = N * SS;
  const acc = new Float64Array(N * N * 4);
  for (let sy = 0; sy < M; sy++) {
    for (let sx = 0; sx < M; sx++) {
      const u = sx / M, v = sy / M;
      let col = null;
      // background
      if (maskable ? true : inRR(u, v, 0, 0, 1, 1, 0.223)) col = [...CLAY, 1];
      // content (inset into the maskable safe zone)
      const au = maskable ? (u - 0.1) / 0.8 : u;
      const av = maskable ? (v - 0.1) / 0.8 : v;
      if (au >= 0 && au <= 1 && av >= 0 && av <= 1) {
        const c = artColor(au, av);
        if (c) col = c;
      }
      const oi = ((sy >> Math.log2(SS)) * N + (sx >> Math.log2(SS))) * 4;
      if (col) { acc[oi] += col[0]; acc[oi + 1] += col[1]; acc[oi + 2] += col[2]; acc[oi + 3] += 255; }
    }
  }
  const px = Buffer.alloc(N * N * 4);
  const per = SS * SS;
  for (let i = 0; i < N * N; i++) {
    const a = acc[i * 4 + 3] / per;
    const cov = a / 255 || 1e-9;
    px[i * 4] = Math.round(acc[i * 4] / per / cov);
    px[i * 4 + 1] = Math.round(acc[i * 4 + 1] / per / cov);
    px[i * 4 + 2] = Math.round(acc[i * 4 + 2] / per / cov);
    px[i * 4 + 3] = Math.round(a);
  }
  return px;
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type, 'ascii');
    const body = Buffer.concat([tb, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const targets = [
  { file: 'icon-180.png', n: 180, maskable: false },
  { file: 'icon-192.png', n: 192, maskable: false },
  { file: 'icon-512.png', n: 512, maskable: false },
  { file: 'icon-maskable-512.png', n: 512, maskable: true },
];
for (const t of targets) {
  const px = render(t.n, { maskable: t.maskable });
  writeFileSync(path.join(OUT, t.file), encodePNG(t.n, t.n, px));
  console.log('wrote', t.file);
}
