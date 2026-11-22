/* The build replaces the version placeholder alongside the HTML version. */
"use strict";

const version = "__LEDGER_VERSION__";
const cachePrefix = "riri-ledger-standalone-shell-";
const cacheName = cachePrefix + version;
const root = new URL(self.registration.scope);
const shell = new URL("./index.html", root);
const ocrCacheName = "riri-ledger-ocr-v6-1";
const ocrRoot = new URL("./ocr/v6/", root);
const ocrFiles = new Set([
  "tesseract.min.js", "worker.min.js", "chi_sim.traineddata.gz", "eng.traineddata.gz",
  "tesseract-core.wasm.js", "tesseract-core-simd.wasm.js",
  "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js",
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const release = new URL(shell);
    release.searchParams.set("v", version);
    const response = await fetch(release, { cache: "reload" });
    if (!response.ok || !(await response.clone().text()).includes(
      '<meta name="ledger-version" content="' + version + '">'
    )) throw new Error("Ledger release is not ready");
    const cache = await caches.open(cacheName);
    await cache.put(shell, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(cachePrefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === ocrRoot.origin && url.pathname.startsWith(ocrRoot.pathname) &&
    ocrFiles.has(url.pathname.slice(ocrRoot.pathname.length))) {
    event.respondWith((async () => {
      const cache = await caches.open(ocrCacheName);
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })());
    return;
  }
  if (event.request.mode !== "navigate") return;
  if (url.origin !== root.origin || (url.pathname !== root.pathname && url.pathname !== shell.pathname)) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(event.request, { signal: controller.signal });
      if (response.ok) return response;
    } catch {
      // Use the installed release when the connection is unavailable.
    } finally {
      clearTimeout(timeout);
    }
    const cache = await caches.open(cacheName);
    return (await cache.match(shell)) ?? Response.error();
  })());
});
