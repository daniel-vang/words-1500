const CACHE_VERSION = "words1500-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "words-1500.js",
  "words-1500.json",
  "words-3000.js",
  "words-3000.json",
  "manifest.webmanifest",
  "sw.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const req = event.request;
  const url = new URL(req.url);

  // Navigation: cache-first for offline reliability.
  if (req.mode === "navigate") {
    event.respondWith(
      caches
        .match(req)
        .then((cached) => cached || caches.match("index.html"))
        .then((cached) => cached || fetch(req))
    );
    return;
  }

  // Same-origin static/data assets: cache-first for offline reliability.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (!res || res.status !== 200 || res.type !== "basic") return res;
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        });
      })
    );
  }
});
