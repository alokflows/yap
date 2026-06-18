// Generates Ripple's icon — the SVG (browser tab + in-app mark) and every PWA
// PNG (iOS apple-touch + Android maskable/any) — from ONE vector definition, so
// they always match the desktop app icon (apps/desktop/src/icon.svg is the same
// SVG). The desktop installer/taskbar icons are produced from it via
// `npm run tauri icon` in apps/desktop.
//
//   Run:  npm i -D @resvg/resvg-js   (dev-only; not needed at runtime/deploy)
//         node scripts/gen-icons.mjs
//
// The mark: a smooth speech bubble — a rounded body with a fully-round right
// end and a soft tail at the bottom-left — on a clay rounded-square tile.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '..', 'public', 'icons');
const PUBLIC = path.join(DIR, '..', 'public');
mkdirSync(OUT, { recursive: true });

const CLAY = '#c4673f';
const PAPER = '#faf3ed';

// The bubble outline (single source of truth for the whole brand).
const BUBBLE = (fill) =>
  `<path d="M 166 150 L 336 150 A 80 80 0 0 1 336 310 L 175 310 ` +
  `C 150 340 110 362 96 362 L 96 220 ` +
  `A 70 70 0 0 1 166 150 Z" fill="${fill}"/>`;

// Canonical icon: clay rounded-square tile + paper bubble.
const ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Ripple">` +
  `<rect width="512" height="512" rx="114" fill="${CLAY}"/>${BUBBLE(PAPER)}</svg>\n`;

// Maskable variant: full-bleed tile, bubble inset into the ~80% safe zone.
const MASKABLE =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
  `<rect width="512" height="512" fill="${CLAY}"/>` +
  `<g transform="translate(51.2,51.2) scale(0.8)">${BUBBLE(PAPER)}</g></svg>`;

let Resvg;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
} catch {
  console.error('This script needs @resvg/resvg-js (dev only):  npm i -D @resvg/resvg-js');
  process.exit(1);
}
const png = (svg, w) => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();

writeFileSync(path.join(PUBLIC, 'icon.svg'), ICON);
console.log('wrote icon.svg');
const targets = [
  ['icon-180.png', ICON, 180],
  ['icon-192.png', ICON, 192],
  ['icon-512.png', ICON, 512],
  ['icon-maskable-512.png', MASKABLE, 512],
];
for (const [file, svg, n] of targets) {
  writeFileSync(path.join(OUT, file), png(svg, n));
  console.log('wrote', file);
}
