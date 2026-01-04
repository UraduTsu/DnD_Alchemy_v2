self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open('nxa-player-v5-1');
    await cache.addAll(['./', './index.html', './app.js', './manifest.webmanifest', './favicon.ico', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-192-maskable.png', './icon-512-maskable.png', './sw.js']);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== 'nxa-player-v5-1').map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try { return await fetch(e.request); }
    catch(_){ return cached; }
  })());
});
