const CACHE_NAME = 'mimir-shell-v2'; // v1 cached scripts forever; activating v2 deletes it
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/assets/mimir/brand/mimir-head.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname === '/health' || url.pathname === '/ws') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Code is fetched fresh and only served from cache when offline. Cache-first here pinned
  // users to whatever version they loaded first, so updates never appeared.
  if (['style', 'script'].includes(req.destination)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (['image', 'font'].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then(
        cached =>
          cached ||
          fetch(req).then(res => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => undefined);
            }
            return res;
          })
      )
    );
  }
});
