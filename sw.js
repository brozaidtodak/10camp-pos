// p1_191 — bumped cache name v3 → v4 to force fresh install. Zaid's browser
// was holding cached v3 with stale app.js?v=290 even though server has v=291+.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open('pos-store-v156').then((cache) => cache.addAll([
      './index.html',
      './style.css',
      './app.js'
    ]))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== 'pos-store-v156') {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
