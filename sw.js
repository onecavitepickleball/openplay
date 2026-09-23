// Minimal service worker: cache-first for static assets, network-first for
// HTML pages (so content stays fresh; cache is only a fallback if offline).
// Firebase modules, QR support, and already-viewed Cloudinary images are also
// cached so Matchday can reopen its field tools during a connection outage.
const CACHE_NAME = 'ocpc-v32';
const FIREBASE_VERSION = '10.13.2';
const PRECACHE_URLS = ['/styles.css', '/script.js', '/nav-auth.js', '/assets/logo-2026.png',
  '/tournament/', '/tournament/index.html', '/tournament/control.html', '/tournament/portal.css', '/tournament/portal.js',
  '/tournament/theme.css', '/tournament/rolling.css', '/tournament/field.css', '/tournament/standard-app.css',
  '/tournament/event-entry.js', '/tournament/event-context.js', '/tournament/config.js', '/tournament/firebase-sync.js',
  '/tournament/session-lock.js', '/tournament/offline-photo-queue.js', '/tournament/cache-refresh.js', '/tournament/app.js', '/tournament/standard-app.js',
  '/tournament/engine/standard-engine.js', '/tournament/referee/', '/tournament/referee/referee.js',
  '/tournament/registration/', '/tournament/registration/registration.js', '/tournament/check-in/',
  '/tournament/check-in/checkin.js', '/tournament/check-in/checkin.css', '/tournament/score-kiosk/',
  '/tournament/score-kiosk/score-kiosk.js', '/tournament/broadcast/', '/tournament/broadcast/broadcast.js',
  '/tournament/broadcast/broadcast.css', '/tournament/operations/', '/tournament/operations/operations.js',
  '/tournament/operations/operations.css', '/tournament/player/', '/tournament/player/player.js',
  '/tournament/player/player.css', '/tournament/public/', '/tournament/public/public.js',
  '/tournament/public/public.css', '/tournament/legal/',
  '/tournament/assets/philippine-one-peso-obverse.png', '/tournament/assets/philippine-one-peso-reverse.png',
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`,
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'];

// Firebase Cloud Messaging needs to run inside this same service worker
// (not a separate one) so a single registration handles both caching and
// push. Background pushes (tab closed or not focused) are shown here;
// foreground pushes are handled client-side by push-notifications.js.
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo",
  authDomain: "ocpc-website-faf5e.firebaseapp.com",
  projectId: "ocpc-website-faf5e",
  storageBucket: "ocpc-website-faf5e.firebasestorage.app",
  messagingSenderId: "15833259684",
  appId: "1:15833259684:web:0f2f4400f9995517ae5031"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'One Cavite Pickleball Club';
  const options = {
    body: payload.notification && payload.notification.body,
    icon: '/assets/favicon-180-v2.png',
    badge: '/assets/favicon-32-v2.png',
    data: { url: (payload.data && payload.data.url) || '/' }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(PRECACHE_URLS.map(url => cache.add(url)))));
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
  if (url.origin !== location.origin) {
    const offlineDependency = url.hostname === 'www.gstatic.com' && url.pathname.includes(`/firebasejs/${FIREBASE_VERSION}/`) || url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('/qrcodejs/');
    const tournamentImage = url.hostname === 'res.cloudinary.com';
    if (!offlineDependency && !tournamentImage) return;
    event.respondWith(caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => { if (response.ok || response.type === 'opaque') caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())); return response; });
      return cached || network;
    }));
    return;
  }

  const isHTML = event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch:true }).then(r => r || caches.match('/')))
    );
    return;
  }

  // Match Control is a live operations system. Never let an older cached
  // module run beside newer tournament markup or Firebase rules; prefer the
  // network and only fall back to cache while genuinely offline.
  if (url.pathname.startsWith('/tournament/')) {
    event.respondWith(
      fetch(event.request).then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return res;
      }).catch(() => caches.match(event.request, { ignoreSearch:true }))
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
