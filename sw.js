// Minimal service worker — just enough to make the app installable.
// Network-first: always tries to fetch the latest version, only falling
// back to the cache if the phone is offline. This avoids the classic PWA
// trap of a student being stuck on an old version after we push updates.

const CACHE_NAME = 'tutor-shell-v1';
const SHELL_FILES = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never intercept API calls — chat/speech must always be live, never cached.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (['/chat', '/speak', '/voices'].includes(url.pathname)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
