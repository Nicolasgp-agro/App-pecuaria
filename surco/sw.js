// Surco Claro — service worker: guarda la app en el celular para usarla sin señal.
// Cambia VERSION en cada publicación para que los celulares reciban la actualización.
const VERSION = "sc-2026-11-09-1";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
  "../vendor/supabase.js",
  "../vendor/xlsx.full.min.js"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sc-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => { if (e.data === "ACTUALIZAR") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.endsWith("/nube.json")) return; // siempre fresco
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});
