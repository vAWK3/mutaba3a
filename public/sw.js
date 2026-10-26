// MUT-445: the free web app at /app is retired. Browsers that opened it (or the landing page, which
// registered the same worker) still run its service worker, which serves the old app from its cache.
// The browser fetches this file when it checks for an update; it replaces the old worker, deletes its
// caches and unregisters itself, and the open tabs reload into the website, where /app goes home.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
