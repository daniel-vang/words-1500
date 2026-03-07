const CACHE_VERSION = "words1500-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "words-1500.json",
  "words-3000.json",
  "words-3500.json",
  "manifest.webmanifest",
  "sw.js",
  "tesseract.min.js",
  "tesseract.worker.min.js",
  "tessdata/eng.traineddata.gz",
  "tessdata/chi_sim.traineddata.gz",
  "tesseract-core/tesseract-core.wasm.js",
  "tesseract-core/tesseract-core-simd.wasm.js",
  "tesseract-core/tesseract-core-lstm.wasm.js",
  "tesseract-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core/tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js",
];

// Tesseract.js WASM core CDN origins — cached at runtime for offline OCR
const TESSERACT_CDN_ORIGINS = ["cdn.jsdelivr.net", "tesseract.projectnaptha.com"];

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
    return;
  }

  // Tesseract.js CDN assets (WASM core): cache after first download for offline OCR.
  if (TESSERACT_CDN_ORIGINS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (!res || res.status !== 200) return res;
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => {
          // no cached version and network failed — propagate the failure
          return caches.match(req);
        });
      })
    );
  }
});
