// Service worker: red primero y caché como respaldo (la app siempre usa la última versión publicada).
const CACHE = 'financito-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/model.js', 'js/store.js', 'js/config.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // las llamadas a Google nunca pasan por la caché
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
