// Minimal service worker: cache-first for static assets, network-first for
// HTML pages (so content stays fresh; cache is only a fallback if offline).
// Never intercepts cross-origin requests (Firebase, Cloudinary, Google
// Analytics, gstatic, etc.) — those always go straight to the network.
const CACHE_NAME = 'ocpc-v23';
const PRECACHE_URLS = ['/styles.css', '/script.js', '/nav-auth.js', '/assets/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isHTML = event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return res;
      });
    })
  );
});
