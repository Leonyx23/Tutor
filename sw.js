// Service Worker: App offline verfügbar, Updates kommen beim nächsten Öffnen mit Netz.
// Löscht nur eigene Caches (Präfix "tutor-"), weil andere Apps auf derselben Domain liegen.
const CACHE = 'tutor-v2';
const FONTS = 'tutor-fonts-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/board.js', 'js/layout.js', 'js/place.js', 'js/prompt.js', 'js/providers.js', 'js/speech.js', 'js/store.js', 'js/stream.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('tutor-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // KI-Anfragen nie zwischenspeichern
  if (/generativelanguage\.googleapis\.com|api\.groq\.com/.test(url.hostname)) return;
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  // Netz zuerst, damit Updates sofort ankommen; ohne Netz aus dem Speicher
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
