const CACHE_NAME = 'berrygood-v2';
const PRECACHE_URLS = [];

// API hosts that should NEVER be cached (weather data, etc.)
const NO_CACHE_HOSTS = ['my.meteoblue.com', 'api.open-meteo.com', 'developer.farmroad.io'];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache API / weather data
  if (NO_CACHE_HOSTS.some(h => url.hostname.includes(h))) return;
  // Only cache static CDN assets (React, FontAwesome, etc.)
  if (url.origin !== location.origin && event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
