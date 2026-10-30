/* Табун: работа без интернета. Своё — сначала из сети, библиотеки — из запаса. */
var C = 'tabun-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET') return;
  var u = new URL(r.url);
  var own = u.origin === self.location.origin;
  var lib = (u.hostname === 'www.gstatic.com' && u.pathname.indexOf('/firebasejs/') === 0) || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'unpkg.com';
  if (!own && !lib) return;
  var put = function (res) { if (res && (res.ok || res.type === 'opaque')) { var c = res.clone(); caches.open(C).then(function (x) { x.put(r, c); }); } return res; };
  if (own) e.respondWith(fetch(r).then(put).catch(function () { return caches.match(r, {ignoreSearch: true}); }));
  else e.respondWith(caches.match(r).then(function (m) { return m || fetch(r).then(put); }));
});
