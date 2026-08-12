// Minimal service worker for PWA installability.
// Never cache authenticated API responses or navigation responses that can contain
// user-specific data. The app shell is cached opportunistically and stale versions
// are removed during activation.
const CACHE_NAME = 'invosmart-v2';
const STATIC_ASSETS = ['/', '/app/dashboard', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isApi = requestUrl.pathname.startsWith('/api/');
  const isNavigation = event.request.mode === 'navigate';
  const isSameOrigin = requestUrl.origin === self.location.origin;

  // Authenticated and cross-origin requests must always go to the network.
  if (isApi || !isSameOrigin || isNavigation) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
