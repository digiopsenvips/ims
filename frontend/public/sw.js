const CACHE_NAME = 'enactus-ims-cache-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
];

// Install Event - Precache static assets & skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching app shell (v3)');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Preserve existing caches; retiring old assets is a separate reviewed maintenance task.
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

// Fetch Event - Network-First Strategy for fresh code with offline fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Bypass SW cache for API calls, WebSockets, Vite HMR, and source modules in development
  if (
    url.includes('/api/') ||
    url.includes('/socket.io/') ||
    url.includes('/@vite/') ||
    url.includes('/@react-refresh') ||
    url.includes('/src/')
  ) {
    return;
  }

  // Network-First: Always fetch latest version, fallback to cache when offline
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Fallback to cache when offline
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // If navigation request and offline, serve index.html app shell
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});

