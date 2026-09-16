// hood — service worker: кэш хэшированных ассетов (cache-first, они
// неизменяемы по имени) и статики; HTML и данные — только сеть.
const VERSION = "hood-sw-v1";
const ASSET_RE = /\/assets\/[^/]+\.(js|css|woff2?)$|\/(logo-64|icon-192|icon-512|favicon-32|apple-touch-icon)\.png$/;

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !ASSET_RE.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
