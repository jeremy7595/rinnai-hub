/* Rinnai Work Library — service worker (offline support)
   Bump CACHE on every deploy so clients pick up the new build. */
const CACHE = 'rwl-v45';
const PRECACHE = [
  '/', '/index.html', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // App page / navigations: network-first (fresh when online), fall back to cache (works offline).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('/index.html', copy).catch(function () {}); });
        return res;
      }).catch(function () {
        return caches.match('/index.html').then(function (r) { return r || caches.match('/'); });
      })
    );
    return;
  }

  // Same-origin static files (icons, manifest): cache-first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function () {}); });
          return res;
        }).catch(function () { return hit; });
      })
    );
    return;
  }

  // Google Fonts: cache-first so the app keeps its typeface offline.
  if (url.hostname.indexOf('gstatic.com') !== -1 || url.hostname.indexOf('googleapis.com') !== -1) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          return hit || fetch(req).then(function (res) {
            c.put(req, res.clone()).catch(function () {});
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }

  // Everything else (external document links) goes straight to the network.
});
