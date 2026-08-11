// Minimal service worker for PWA installability
// Cache the app shell (HTML, CSS, JS)
const CACHE_NAME = 'invosmart-v1';
const STATIC_ASSETS = ['/', '/app/dashboard'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('fetch', (event) => {
  // Network-first for API routes, cache-first for static assets
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
