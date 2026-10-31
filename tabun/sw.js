/* Табун: работа без интернета. Своё — сначала из сети, библиотеки — из запаса, кусочки карты — из запаса. */
var C = 'tabun-v5', TC = 'tabun-tiles';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
function trim(c) { c.keys().then(function (k) { if (k.length > 600) for (var i = 0; i < k.length - 500; i++) c.delete(k[i]); }); }
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET') return;
  var u = new URL(r.url);
  var own = u.origin === self.location.origin;
  var lib = (u.hostname === 'www.gstatic.com' && u.pathname.indexOf('/firebasejs/') === 0) || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'unpkg.com';
  var tile = u.hostname === 'tile.openstreetmap.org';
  if (tile) {
    e.respondWith(caches.open(TC).then(function (c) {
      return c.match(r).then(function (m) {
        return m || fetch(r).then(function (res) { if (res && res.ok) { c.put(r, res.clone()); trim(c); } return res; });
      });
    }));
    return;
  }
  if (!own && !lib) return;
  var put = function (res) { if (res && (res.ok || res.type === 'opaque')) { var c = res.clone(); caches.open(C).then(function (x) { x.put(r, c); }); } return res; };
  if (own) e.respondWith(fetch(r).then(put).catch(function () { return caches.match(r, {ignoreSearch: true}); }));
  else e.respondWith(caches.match(r).then(function (m) { return m || fetch(r).then(put); }));
});
