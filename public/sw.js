// Lets Kushly Rewards and POS open without internet: pages and icons fall back to the last saved copy,
// hashed build files (/assets) are served from the cache. Server data is never cached here.
const CACHE = "kp-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
const save = (key, r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); } return r; };
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => save("/index.html", r)).catch(() => caches.match("/index.html")));
    return;
  }
  // Hashed build files never change: cache first.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => save(req, r))));
    return;
  }
  // Icons and logos keep their names when redrawn: network first, cache when offline.
  if (/\.(svg|png|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(fetch(req).then((r) => save(req, r)).catch(() => caches.match(req)));
  }
});
