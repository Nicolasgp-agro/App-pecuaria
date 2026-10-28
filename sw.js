// Hato Claro — service worker: guarda la app en el celular para usarla sin señal.
// Cambia VERSION en cada publicación para que los celulares reciban la actualización.
const VERSION = "hc-2026-10-27-9";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./colanta.js",
  "./salud-datos.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/supabase.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./manifest.webmanifest",
  "./vendor/xlsx.full.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "ACTUALIZAR") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});

// Avisos diarios sin abrir la app (Chrome en Android con la app instalada)
function leerConfig(id) {
  return new Promise((res) => {
    const r = indexedDB.open("hato-claro");
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("config")) { db.close(); return res(null); }
      const q = db.transaction("config").objectStore("config").get(id);
      q.onsuccess = () => { res(q.result || null); db.close(); };
      q.onerror = () => { res(null); db.close(); };
    };
  });
}
function guardarConfig(obj) {
  return new Promise((res) => {
    const r = indexedDB.open("hato-claro");
    r.onerror = () => res();
    r.onsuccess = () => { const db = r.result; try { const t = db.transaction("config", "readwrite"); t.objectStore("config").put(obj); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); res(); }; } catch (e) { db.close(); res(); } };
  });
}
async function mostrarAvisos() {
  const av = await leerConfig("avisos"); if (!av || !av.lista) return;
  const vistos = (await leerConfig("avisosVistos")) || { id: "avisosVistos", ids: [] };
  const d = new Date(), hoy = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const toca = av.lista.filter((a) => a.fecha <= hoy && !vistos.ids.includes(a.id));
  for (const a of toca.slice(0, 5)) await self.registration.showNotification(a.titulo, { body: a.cuerpo, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: a.id });
  if (toca.length > 5) await self.registration.showNotification("Hato Claro", { body: `Tiene ${toca.length - 5} avisos más para hoy.`, icon: "icons/icon-192.png", tag: "mas-avisos" });
  vistos.ids = [...vistos.ids, ...toca.map((a) => a.id)].slice(-400);
  await guardarConfig(vistos);
}
self.addEventListener("periodicsync", (e) => { if (e.tag === "hc-avisos") e.waitUntil(mostrarAvisos()); });
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes(self.registration.scope)); if (c) { c.focus(); c.postMessage({ abrir: "inicio" }); return; }
    return self.clients.openWindow("./");
  }));
});
