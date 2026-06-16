// Yap service worker — just an offline app shell. It must never touch the
// live relay (WebSocket /ws, polling /poll), so it only handles same-origin
// GETs for the static UI and stays out of the way of everything else.
const CACHE = 'yap-v8';
const SHELL = [
  '/',
  '/index.html',
  '/qrcode.js',
  '/jsQR.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  // Only handle our own static GETs; let the relay and cross-origin pass through.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/poll') || url.pathname.startsWith('/ws') || url.pathname === '/healthz') return;

  // Network-first so updates land immediately; fall back to cache when offline.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html')))
  );
});
