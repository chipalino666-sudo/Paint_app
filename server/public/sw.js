/* ==========================================================================
   Офлайн-оболочка: страница открывается даже без интернета.
   Данные (запросы к /api/) не кэшируются — они всегда свежие с сервера.
   ========================================================================== */

const CACHE = 'lonjeron-v19';

const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/app.js',
  '/styles.css',
  '/extra.css',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Данные и чужие адреса — только сеть
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Сначала сеть (чтобы видеть свежую версию), при обрыве — копия из кэша
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/login.html')))
  );
});
