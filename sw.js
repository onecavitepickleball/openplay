// Minimal service worker: cache-first for static assets, network-first for
// HTML pages (so content stays fresh; cache is only a fallback if offline).
// Never intercepts cross-origin requests (Firebase, Cloudinary, Google
// Analytics, gstatic, etc.) — those always go straight to the network.
const CACHE_NAME = 'ocpc-v28';
const PRECACHE_URLS = ['/styles.css', '/script.js', '/nav-auth.js', '/assets/logo.png'];

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
    icon: '/assets/favicon-180.png',
    badge: '/assets/favicon-32.png',
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
