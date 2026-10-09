// Chicken Horde service worker: makes the game installable and caches the heavy 3D assets.
// - Big assets (models, audio, textures, fonts, libraries): cache first, so the 2nd launch is instant.
// - Game code and pages: network first (always the newest version), cache only as offline fallback.
// - Socket.IO and the leaderboard API are never cached.
const VERSION = 'ch-v11.0.0';
const CORE = ['./', './index.html', './style.css', './app.js', './renderer3d.mjs', './manifest.webmanifest', './vendor/socket.io.min.js', './vendor/qrcode.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  const heavy = /\/(assets|vendor)\//.test(url.pathname) && !/\.(js|mjs)$/.test(url.pathname) || /\/vendor\/three\//.test(url.pathname);
  if (heavy) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  } else {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  }
});
