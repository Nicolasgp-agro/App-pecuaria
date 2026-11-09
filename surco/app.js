/* Surco Claro — registros de lotes y siembras. Guarda todo en el celular (IndexedDB) y,
   si se activa la nube, sincroniza con Supabase (la misma nube de Hato Claro). */
"use strict";
const VERSION_APP = "1.0";

/* ---------- catálogos ---------- */
const TIPOS = {
  jornal: { nombre: "Jornal", color: "--c-jornal" },
  insumo: { nombre: "Insumo", color: "--c-abono" },
  maquina: { nombre: "Maquinaria y transporte", color: "--c-maq" },
  otro: { nombre: "Otro gasto", color: "--c-otro" },
  venta: { nombre: "Venta", color: "--ok" },
  nota: { nombre: "Nota de campo", color: "--muted" },
};
const LABORES = ["Preparación del terreno", "Siembra", "Abonada", "Desyerba", "Aporque", "Fumigación", "Riego", "Cosecha", "Selección y empaque", "Otra labor"];
const INSUMOS = { semilla: "Semilla", abono: "Abono o fertilizante", enmienda: "Cal o enmienda", fungicida: "Fungicida", insecticida: "Insecticida", herbicida: "Herbicida", foliar: "Foliar o coadyuvante", otro: "Otro insumo" };
const UNIDADES = ["bulto", "kg", "litro", "cc", "galón", "unidad", "caneca"];
const MAQUINAS = ["Arada con tractor", "Rastrillada", "Surcada", "Flete o transporte", "Empaques (costales)", "Alquiler de equipo", "Otro"];
const CALIDADES = ["Primera", "Segunda", "Tercera", "Riche", "Mezclada"];
const EVENTOS = ["Siembra", "Emergencia", "Floración", "Cosecha", "Helada", "Sequía", "Plaga o enfermedad", "Otro"];
const CULTIVOS = ["Papa", "Arveja", "Haba", "Zanahoria", "Pasto", "Otro"];
const VARIEDADES = ["Superior", "R-12", "Suprema", "Criolla", "Pastusa", "Diacol Capiro", "Otra"];
const CATS = [
  { k: "jornales", n: "Jornales", c: "--c-jornal" },
  { k: "semilla", n: "Semilla", c: "--c-semilla" },
  { k: "abonos", n: "Abonos y enmiendas", c: "--c-abono" },
  { k: "agroq", n: "Fumigos y agroquímicos", c: "--c-agroq" },
  { k: "maq", n: "Maquinaria y transporte", c: "--c-maq" },
  { k: "otros", n: "Otros gastos", c: "--c-otro" },
];
const ROLES = { dueno: "Dueño", ordenador: "Trabajador", veterinario: "Asesor" };
function catDe(m) {
  if (m.tipo === "jornal") return "jornales";
  if (m.tipo === "maquina") return "maq";
  if (m.tipo === "otro") return "otros";
  if (m.tipo === "insumo") {
    if (m.sub === "semilla") return "semilla";
    if (m.sub === "abono" || m.sub === "enmienda") return "abonos";
    if (["fungicida", "insecticida", "herbicida", "foliar"].includes(m.sub)) return "agroq";
    return "otros";
  }
  return null;
}
const PLURAL = { bulto: "bultos", litro: "litros", "galón": "galones", unidad: "unidades", caneca: "canecas" };
const unidadTxt = (n, u) => (n == 1 || !PLURAL[u] ? u || "" : PLURAL[u]);
const esGasto = (m) => ["jornal", "insumo", "maquina", "otro"].includes(m.tipo);

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const peso = (n) => (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n || 0)).toLocaleString("es-CO");
const num = (v) => { let s = String(v ?? "").trim().replace(/\s/g, ""); if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."); const n = parseFloat(s); return isFinite(n) ? n : 0; };
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fechaLarga = (f) => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }); };
const mesLargo = (k) => { const [y, m] = k.split("-").map(Number); const s = new Date(y, m - 1, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); return s[0].toUpperCase() + s.slice(1); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 20);
function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2800); }
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("sc-" + k); localStorage.setItem("sc-" + k, v); } catch (e) { return null; } };

/* ---------- almacenamiento local ---------- */
const COLS = ["lotes", "ciclos", "movs"];
const S = { lotes: [], ciclos: [], movs: [], config: [], ciclo: pref("ciclo"), tab: pref("tab") || "resumen", filtro: "todos", form: null };
let idb = null, memOnly = false;
const memFotos = new Map();
function abrirDB() {
  return new Promise((res, rej) => {
    if (!("indexedDB" in window)) return rej(new Error("sin indexedDB"));
    const r = indexedDB.open("surco-claro", 1);
    r.onupgradeneeded = () => { const d = r.result; ["lotes", "ciclos", "movs", "config", "cola", "fotos"].forEach((n) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: "id" }); }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = idb.transaction(store, mode), st = t.objectStore(store);
    let out; const r = fn(st);
    if (r && typeof r === "object" && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
async function cargarTodo() {
  try { idb = await abrirDB(); } catch (e) { memOnly = true; return; }
  for (const c of [...COLS, "config"]) S[c] = (await tx(c, "readonly", (st) => st.getAll())) || [];
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}
async function save(col, doc, { remoto = false } = {}) {
  if (!remoto && col !== "config") doc.actualizado = new Date().toISOString();
  const i = S[col].findIndex((x) => x.id === doc.id);
  if (i >= 0) S[col][i] = doc; else S[col].push(doc);
  if (memOnly) return;
  await tx(col, "readwrite", (st) => st.put(doc));
  if (!remoto && COLS.includes(col) && nubeActiva()) { await tx("cola", "readwrite", (st) => st.put({ id: col + "|" + doc.id, col, docId: doc.id, borrado: false })); programarSync(); }
}
async function del(col, id, { remoto = false } = {}) {
  S[col] = S[col].filter((x) => x.id !== id);
  if (memOnly) return;
  await tx(col, "readwrite", (st) => st.delete(id));
  if (!remoto && COLS.includes(col) && nubeActiva()) { await tx("cola", "readwrite", (st) => st.put({ id: col + "|" + id, col, docId: id, borrado: true })); programarSync(); }
}

/* ---------- fotos ---------- */
const urls = new Map();
async function guardarFoto(blob, t) {
  const id = uid(), reg = { id, blob, t, type: blob.type || (t === "pdf" ? "application/pdf" : "image/jpeg"), subido: false };
  if (memOnly) memFotos.set(id, reg); else await tx("fotos", "readwrite", (st) => st.put(reg));
  if (nubeActiva()) programarSync();
  return id;
}
async function leerFoto(id) { return memOnly ? memFotos.get(id) : await tx("fotos", "readonly", (st) => st.get(id)); }
async function urlFoto(id) {
  if (urls.has(id)) return urls.get(id);
  let f = await leerFoto(id);
  if (!f && nubeActiva()) { try { f = await bajarFoto(id); } catch (e) { f = null; } }
  if (!f) return null;
  const u = URL.createObjectURL(f.blob); urls.set(id, u); return u;
}
function hidratarFotos(root = document) {
  root.querySelectorAll("[data-foto]").forEach(async (el) => {
    const u = await urlFoto(el.dataset.foto);
    if (!u) { if (el.tagName === "IMG") el.replaceWith(Object.assign(document.createElement("span"), { className: "muted small", textContent: "Foto no disponible en este celular" })); return; }
    if (el.tagName === "IMG") el.src = u; else el.href = u;
  });
}
async function borrarFoto(id) { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } if (memOnly) memFotos.delete(id); else await tx("fotos", "readwrite", (st) => st.delete(id)); }
async function comprimir(file) {
  if (file.type === "application/pdf") return { blob: file, t: "pdf" };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.8));
    if (b) return { blob: b, t: "img" };
  } catch (e) {}
  return { blob: file, t: "img" };
}

/* ---------- nube (Supabase, la misma de Hato Claro) ---------- */
let NUBE_CONF = null, cliente = null, sesion = null, sincronizando = false, timerSync = null;
const nubeCfg = () => ({ fincaId: null, fincaNombre: "", rol: null, ultimoPull: null, ultimaSync: null, error: null, ...(S.config.find((c) => c.id === "nube") || {}), id: "nube" });
const nubeActiva = () => !!(NUBE_CONF && nubeCfg().fincaId);
async function guardarNube(c) { await save("config", { ...nubeCfg(), ...c }, { remoto: true }); }
async function cargarConfNube() {
  try { const r = await fetch("../nube.json", { cache: "no-cache" }); if (r.ok) { const d = await r.json(); if (d && d.url && d.anonKey) { NUBE_CONF = d; pref("nube-conf", JSON.stringify(d)); } } } catch (e) {}
  if (!NUBE_CONF) { try { const d = JSON.parse(pref("nube-conf") || "null"); if (d && d.url && d.anonKey) NUBE_CONF = d; } catch (e) {} }
}
function cargarScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = () => res(window[global]); sc.onerror = () => rej(new Error("sin conexión")); document.head.appendChild(sc); });
}
const COL_NUBE = (c) => "surco_" + c;
async function remoto() {
  if (!NUBE_CONF) throw new Error("La nube no está configurada");
  if (!cliente) { const sb = await cargarScript("../vendor/supabase.js", "supabase"); cliente = sb.createClient(NUBE_CONF.url, NUBE_CONF.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "surco-claro-sesion" } }); }
  const c = cliente, ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async sesion() { const { data } = await c.auth.getSession(); return data.session ? { email: data.session.user.email, userId: data.session.user.id } : null; },
    async enviarCodigo(email) { ok(await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
    async verificarCodigo(email, token) { const d = ok(await c.auth.verifyOtp({ email, token, type: "email" })); return { email: d.user.email, userId: d.user.id }; },
    async salir() { await c.auth.signOut(); },
    async misFincas() { const { data } = await c.auth.getUser(); const yo = data && data.user ? data.user.id : null; if (!yo) return []; return (ok(await c.from("miembros").select("rol, fincas(id, nombre)").eq("user_id", yo)) || []).filter((m) => m.fincas).map((m) => ({ id: m.fincas.id, nombre: m.fincas.nombre, rol: m.rol })); },
    async crearFinca(nombre) { return ok(await c.rpc("crear_finca", { n: nombre })); },
    async unirse(codigo) { return ok(await c.rpc("unirse_finca", { c: codigo })); },
    async invitar(fincaId, rol) { return ok(await c.rpc("crear_invitacion", { f: fincaId, r: rol })); },
    async miembros(fincaId) { return ok(await c.rpc("miembros_de", { f: fincaId })) || []; },
    async subir(filas) { ok(await c.from("registros").upsert(filas, { onConflict: "finca_id,coleccion,id" })); },
    async bajar(fincaId, desde) { let q = c.from("registros").select("coleccion,id,datos,borrado,actualizado").eq("finca_id", fincaId).like("coleccion", "surco_%").order("actualizado", { ascending: true }).limit(1000); if (desde) q = q.gt("actualizado", desde); return ok(await q) || []; },
    async subirFoto(ruta, blob, type) { ok(await c.storage.from("surco-fotos").upload(ruta, blob, { upsert: true, contentType: type })); },
    async bajarFoto(ruta) { return ok(await c.storage.from("surco-fotos").download(ruta)); },
  };
}
async function bajarFoto(id) {
  const r = await remoto(), blob = await r.bajarFoto(nubeCfg().fincaId + "/" + id);
  const reg = { id, blob, t: blob.type === "application/pdf" ? "pdf" : "img", type: blob.type, subido: true };
  if (!memOnly) await tx("fotos", "readwrite", (st) => st.put(reg));
  return reg;
}
async function iniciarNube() {
  await cargarConfNube(); if (!NUBE_CONF) return;
  try { const r = await remoto(); sesion = await r.sesion(); } catch (e) { sesion = null; }
  if (nubeActiva()) { sincronizar(); setInterval(() => sincronizar(), 3 * 60 * 1000); window.addEventListener("online", () => sincronizar()); }
}
function programarSync() { clearTimeout(timerSync); timerSync = setTimeout(() => sincronizar(), 3000); }
async function sincronizar({ silencioso = true } = {}) {
  if (!nubeActiva() || sincronizando || memOnly) return 0;
  if (navigator.onLine === false) return 0;
  sincronizando = true; let cambios = 0, avisoFotos = null;
  try {
    const r = await remoto(), n = nubeCfg(), finca = n.fincaId;
    if (!sesion) { try { sesion = await r.sesion(); } catch (e) {} if (!sesion) throw new Error("Entre otra vez con su correo en Más"); }
    // 1. subir registros pendientes
    const cola = (await tx("cola", "readonly", (st) => st.getAll())) || [];
    for (let i = 0; i < cola.length; i += 200) {
      const lote = cola.slice(i, i + 200);
      const filas = lote.map((q) => { const doc = S[q.col] && S[q.col].find((x) => x.id === q.docId); return { finca_id: finca, coleccion: COL_NUBE(q.col), id: q.docId, datos: doc && !q.borrado ? doc : {}, borrado: q.borrado || !doc }; });
      await r.subir(filas);
      await tx("cola", "readwrite", (st) => lote.forEach((q) => st.delete(q.id)));
    }
    // 2. subir fotos pendientes
    const fotos = ((await tx("fotos", "readonly", (st) => st.getAll())) || []).filter((f) => !f.subido);
    for (const f of fotos) {
      try { await r.subirFoto(finca + "/" + f.id, f.blob, f.type); await tx("fotos", "readwrite", (st) => st.put({ ...f, subido: true })); }
      catch (e) { avisoFotos = "Las fotos quedan en este celular hasta que la nube acepte fotos (" + e.message + ")"; break; }
    }
    // 3. bajar lo nuevo (2 minutos de traslape)
    const pendientes = new Set(((await tx("cola", "readonly", (st) => st.getAll())) || []).map((q) => q.id));
    let desde = n.ultimoPull ? new Date(new Date(n.ultimoPull).getTime() - 120000).toISOString() : null, ultimo = n.ultimoPull;
    for (let vuelta = 0; vuelta < 50; vuelta++) {
      const filas = await r.bajar(finca, desde);
      for (const f of filas) {
        const col = f.coleccion.replace(/^surco_/, "");
        if (!COLS.includes(col) || pendientes.has(col + "|" + f.id)) continue;
        const local = S[col].find((x) => x.id === f.id);
        if (f.borrado) { if (local) { await del(col, f.id, { remoto: true }); cambios++; } }
        else if (!local || JSON.stringify(local) !== JSON.stringify({ ...f.datos, id: f.id })) { await save(col, { ...f.datos, id: f.id }, { remoto: true }); cambios++; }
      }
      if (filas.length) { ultimo = filas[filas.length - 1].actualizado; desde = ultimo; }
      if (filas.length < 1000) break;
    }
    await guardarNube({ ultimoPull: ultimo, ultimaSync: new Date().toISOString(), error: avisoFotos });
  } catch (e) {
    await guardarNube({ error: String(e.message || e) });
    if (!silencioso) toast("No se pudo sincronizar: " + (e.message || e));
  } finally { sincronizando = false; }
  if (cambios || S.tab === "mas") render();
  return cambios;
}
async function encolarTodo() {
  if (memOnly) return;
  await tx("cola", "readwrite", (st) => COLS.forEach((c) => S[c].forEach((d) => st.put({ id: c + "|" + d.id, col: c, docId: d.id, borrado: false }))));
}

/* ---------- navegación ---------- */
const TABS = ["resumen", "movs", "registrar", "lotes", "mas"];
document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tab)));
function irA(tab) { S.tab = tab; if (tab === "registrar" && !S.form) S.form = nuevoForm(); pref("tab", tab); render(); window.scrollTo(0, 0); }
$("#sel-ciclo").addEventListener("change", (e) => { S.ciclo = e.target.value; pref("ciclo", S.ciclo); if (S.form && !S.form.id) S.form.cicloId = S.ciclo; render(); });
function ciclosOrden() { return [...S.ciclos].sort((a, b) => (b.activo !== false ? 1 : 0) - (a.activo !== false ? 1 : 0) || String(b.siembra || b.creado || "").localeCompare(String(a.siembra || a.creado || ""))); }
const lote = (id) => S.lotes.find((l) => l.id === id);
const ciclo = (id) => S.ciclos.find((c) => c.id === id);
function nombreCiclo(c) { if (!c) return ""; const l = lote(c.loteId); return `${l ? l.nombre : "Lote"} · ${c.cultivo || ""}${c.variedad ? " " + c.variedad : ""}${c.siembra ? " · " + fechaLarga(c.siembra) : ""}`; }
function cicloActual() { if (S.ciclo && ciclo(S.ciclo)) return ciclo(S.ciclo); const c = ciclosOrden()[0]; if (c) S.ciclo = c.id; return c || null; }
const movsDe = (c) => (c ? S.movs.filter((m) => m.cicloId === c.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.creado || "").localeCompare(String(a.creado || ""))) : []);

/* ---------- render ---------- */
function render() {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
  const sel = $("#sel-ciclo"), cs = ciclosOrden(), act = cicloActual();
  sel.innerHTML = cs.length ? cs.map((c) => `<option value="${c.id}">${esc(nombreCiclo(c))}${c.activo === false ? " (terminada)" : ""}</option>`).join("") : `<option value="">Sin siembras todavía</option>`;
  if (act) sel.value = act.id;
  const v = { resumen: vResumen, registrar: vRegistrar, movs: vMovs, lotes: vLotes, mas: vMas }[S.tab] || vResumen;
  app.innerHTML = (memOnly ? `<div class="banner">Este navegador no deja guardar datos. Lo que registres se perderá al cerrar.</div>` : "") + v(act);
  enlazar(act);
  hidratarFotos(app);
}
function resumen(ms) {
  const r = { gasto: 0, ingreso: 0, bultos: 0, jornales: 0, cats: Object.fromEntries(CATS.map((c) => [c.k, 0])), labores: {} };
  for (const m of ms) {
    if (esGasto(m)) { r.gasto += m.total || 0; r.cats[catDe(m)] += m.total || 0; }
    if (m.tipo === "jornal") { const k = m.sub || "Otra labor"; r.jornales += m.cant || 0; r.labores[k] = (r.labores[k] || 0) + (m.cant || 0); }
    if (m.tipo === "venta") { r.ingreso += m.total || 0; r.bultos += m.bultos || 0; }
  }
  return r;
}
function sinCiclo() {
  return `<div class="card empty"><h2>Empieza por crear un lote y su siembra</h2>
  <p class="muted">Cada siembra lleva sus propios jornales, insumos y ventas, para saber cuánto costó y cuánto dejó.</p>
  <button class="btn" data-act="nuevo-lote">Crear lote</button>
  ${NUBE_CONF ? `<p class="muted small">¿Ya la usan en otro celular? Entra a <b>Más</b> y conéctate a la nube de la finca.</p>` : ""}</div>`;
}
function vResumen(c) {
  if (!c) return sinCiclo();
  const ms = movsDe(c), r = resumen(ms), l = lote(c.loteId), util = r.ingreso - r.gasto, max = Math.max(1, ...Object.values(r.cats));
  const dias = c.siembra ? Math.floor((Date.now() - new Date(c.siembra + "T12:00:00")) / 864e5) : null;
  const areaHa = l && l.area ? (l.unidad === "fanegada" ? l.area * 0.64 : l.area) : 0;
  const labores = Object.entries(r.labores).sort((a, b) => b[1] - a[1]);
  return `
  <section class="card" style="gap:6px">
    <span class="eyebrow">${esc(l ? l.nombre : "Lote")}${l && l.vereda ? " · " + esc(l.vereda) : ""}</span>
    <h1 style="font-size:1.6rem">${esc(c.cultivo || "")} ${esc(c.variedad || "")}</h1>
    <p class="muted small">${c.siembra ? `Sembrada el ${fechaLarga(c.siembra)}${dias >= 0 ? " · " + dias + " días" : ""}` : "Fecha de siembra sin registrar"}${c.activo === false ? " · Terminada" : ""}${l && l.area ? ` · ${l.area} ${l.unidad === "fanegada" ? "fanegadas" : "ha"}` : ""}</p>
    ${l && l.satelite && l.satelite.texto ? `<div class="sat"><b>Satélite:</b> ${esc(l.satelite.texto)}</div>` : ""}
  </section>
  <section class="kpis" aria-label="Totales de la siembra">
    <div class="kpi"><span class="eyebrow">Gastos</span><span class="v">${peso(r.gasto)}</span><span class="s">${ms.filter(esGasto).length} registros</span></div>
    <div class="kpi"><span class="eyebrow">Ventas</span><span class="v">${peso(r.ingreso)}</span><span class="s num">${r.bultos.toLocaleString("es-CO")} bultos</span></div>
    <div class="kpi"><span class="eyebrow">Utilidad</span><span class="v ${util > 0 ? "pos" : util < 0 ? "neg" : ""}">${peso(util)}</span><span class="s">${r.ingreso ? "ventas menos gastos" : "aún sin ventas"}</span></div>
    <div class="kpi"><span class="eyebrow">Costo por bulto</span><span class="v">${r.bultos ? peso(r.gasto / r.bultos) : "—"}</span><span class="s">${r.bultos ? "gasto ÷ bultos vendidos" : "se calcula al vender"}</span></div>
  </section>
  <section class="card">
    <div class="lote-h"><h2 style="font-size:1.15rem">En qué se va la plata</h2>${areaHa && r.gasto ? `<span class="tag num">${peso(r.gasto / areaHa)} por ha</span>` : ""}</div>
    ${r.gasto ? `<div class="bars">${CATS.filter((k) => r.cats[k.k] > 0).sort((a, b) => r.cats[b.k] - r.cats[a.k]).map((k) => `
      <div class="bar-row"><span class="lab"><i class="dot" style="background:var(${k.c})"></i>${k.n}</span><span class="num">${peso(r.cats[k.k])} <span class="muted small">${Math.round((r.cats[k.k] / r.gasto) * 100)}%</span></span>
      <div class="track"><div class="fill" style="width:${((r.cats[k.k] / max) * 100).toFixed(1)}%;background:var(${k.c})"></div></div></div>`).join("")}</div>`
      : `<p class="muted">Cuando registres jornales, semilla, abonos o fumigos, aquí verás cuánto pesa cada uno.</p>`}
  </section>
  ${r.jornales ? `<section class="card"><div class="lote-h"><h2 style="font-size:1.15rem">Jornales por labor</h2><span class="tag num">${r.jornales.toLocaleString("es-CO")} en total</span></div>
    <dl class="kv">${labores.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="num">${v.toLocaleString("es-CO")}</dd>`).join("")}</dl></section>` : ""}
  <section class="card">
    <div class="lote-h"><h2 style="font-size:1.15rem">Últimos registros</h2><button class="chip" data-tabgo="movs">Ver todos</button></div>
    ${ms.length ? `<div class="list">${ms.slice(0, 5).map(itemMov).join("")}</div>` : `<p class="muted">Todavía no hay registros en esta siembra.</p><button class="btn" data-tabgo="registrar">Registrar el primero</button>`}
  </section>`;
}
function iconoMov(m) {
  if (m.fotos && m.fotos.length) { const f = m.fotos[0]; return f.t === "pdf" ? `<span class="ic"><b class="small">PDF</b></span>` : `<span class="ic"><img data-foto="${f.id}" alt=""></span>`; }
  const c = m.tipo === "insumo" ? (CATS.find((k) => k.k === catDe(m)) || {}).c : TIPOS[m.tipo] && TIPOS[m.tipo].color;
  return `<span class="ic"><i class="dot" style="width:14px;height:14px;background:var(${c || "--muted"})"></i></span>`;
}
function tituloMov(m) {
  switch (m.tipo) {
    case "jornal": return `${m.sub || "Jornal"} · ${(m.cant || 0).toLocaleString("es-CO")} jornal${m.cant == 1 ? "" : "es"}`;
    case "insumo": return `${m.desc || INSUMOS[m.sub] || "Insumo"}${m.cant ? ` · ${m.cant.toLocaleString("es-CO")} ${unidadTxt(m.cant, m.unidad)}` : ""}`;
    case "maquina": return m.sub || "Maquinaria";
    case "venta": return `Venta · ${(m.bultos || 0).toLocaleString("es-CO")} bultos${m.calidad ? " " + m.calidad.toLowerCase() : ""}`;
    case "nota": return m.sub || "Nota de campo";
    default: return m.desc || "Gasto";
  }
}
function itemMov(m) {
  const val = m.tipo === "venta" ? `<span class="m pos">+${peso(m.total)}</span>` : m.tipo === "nota" ? `<span class="m muted small">nota</span>` : `<span class="m">${peso(m.total)}</span>`;
  const sub = [fechaLarga(m.fecha), m.tipo === "insumo" ? INSUMOS[m.sub] : null, m.prov || m.comprador || null, m.nota || null].filter(Boolean).join(" · ");
  return `<button class="item" data-mov="${m.id}">${iconoMov(m)}<span style="min-width:0"><span class="t">${esc(tituloMov(m))}</span><span class="d">${esc(sub)}</span></span>${val}</button>`;
}
function vMovs(c) {
  if (!c) return sinCiclo();
  let ms = movsDe(c);
  const filtros = [["todos", "Todos"], ["jornal", "Jornales"], ["insumo", "Insumos"], ["maquina", "Maquinaria"], ["otro", "Otros"], ["venta", "Ventas"], ["nota", "Notas"]];
  if (S.filtro !== "todos") ms = ms.filter((m) => m.tipo === S.filtro);
  const grupos = {}; ms.forEach((m) => { const k = (m.fecha || "").slice(0, 7); (grupos[k] = grupos[k] || []).push(m); });
  return `<div class="chips" role="group" aria-label="Filtrar">${filtros.map(([k, n]) => `<button class="chip" data-filtro="${k}" aria-pressed="${S.filtro === k}">${n}</button>`).join("")}</div>
  ${ms.length ? Object.keys(grupos).sort().reverse().map((k) => { const g = grupos[k], gt = g.filter(esGasto).reduce((a, m) => a + (m.total || 0), 0);
    return `<section class="card" style="gap:0;padding-block:8px"><div class="mes-h"><span>${mesLargo(k)}</span><span class="num">${gt ? peso(gt) + " en gastos" : ""}</span></div><div class="list">${g.map(itemMov).join("")}</div></section>`; }).join("")
  : `<div class="card empty"><p class="muted">No hay registros${S.filtro !== "todos" ? " de este tipo" : ""} en esta siembra.</p><button class="btn" data-tabgo="registrar">Registrar</button></div>`}`;
}

/* ---------- formulario de registro ---------- */
function nuevoForm(base) { return Object.assign({ id: null, tipo: "jornal", fecha: hoy(), cicloId: S.ciclo, sub: "", desc: "", cant: "", unidad: "bulto", vunit: pref("jornal") || "", total: "", prov: "", bultos: "", kgBulto: "50", precio: "", comprador: "", calidad: "Primera", nota: "", fotos: [], quitadas: [] }, base || {}); }
function vRegistrar(c) {
  if (!S.ciclos.length) return sinCiclo();
  const f = S.form || (S.form = nuevoForm());
  if (!f.cicloId || !ciclo(f.cicloId)) f.cicloId = c && c.id;
  const opc = (arr, v) => arr.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  const opcK = (obj, v) => Object.entries(obj).map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(n)}</option>`).join("");
  let campos = "";
  if (f.tipo === "jornal") campos = `
    <label class="f">Labor<select id="f-sub">${opc(LABORES, f.sub || LABORES[0])}</select></label>
    <div class="grid2"><label class="f">Número de jornales<input id="f-cant" inputmode="decimal" value="${esc(f.cant)}" placeholder="Ej. 4"></label>
    <label class="f">Valor del jornal<input id="f-vunit" inputmode="numeric" value="${esc(f.vunit)}" placeholder="Ej. 70000"></label></div>
    <label class="f">Trabajadores (opcional)<input id="f-desc" value="${esc(f.desc)}" placeholder="Ej. Don José y Pedro"></label>`;
  else if (f.tipo === "insumo") campos = `
    <div class="grid2"><label class="f">Tipo de insumo<select id="f-sub">${opcK(INSUMOS, f.sub || "abono")}</select></label>
    <label class="f">Producto<input id="f-desc" value="${esc(f.desc)}" placeholder="Ej. 10-30-10, Manzate"></label></div>
    <div class="grid2"><label class="f">Cantidad<input id="f-cant" inputmode="decimal" value="${esc(f.cant)}"></label>
    <label class="f">Unidad<select id="f-unidad">${opc(UNIDADES, f.unidad)}</select></label></div>
    <div class="grid2"><label class="f">Precio por ${esc(f.unidad || "unidad")}<input id="f-vunit" inputmode="numeric" value="${esc(f.vunit)}"></label>
    <label class="f">Proveedor<input id="f-prov" value="${esc(f.prov)}" placeholder="Agropecuaria…"></label></div>`;
  else if (f.tipo === "maquina") campos = `
    <label class="f">Concepto<select id="f-sub">${opc(MAQUINAS, f.sub || MAQUINAS[0])}</select></label>
    <div class="grid2"><label class="f">Valor total<input id="f-total" inputmode="numeric" value="${esc(f.total)}"></label>
    <label class="f">A quién se pagó<input id="f-prov" value="${esc(f.prov)}"></label></div>`;
  else if (f.tipo === "otro") campos = `
    <label class="f">Descripción<input id="f-desc" value="${esc(f.desc)}" placeholder="Ej. Arriendo, agua, herramienta"></label>
    <div class="grid2"><label class="f">Valor total<input id="f-total" inputmode="numeric" value="${esc(f.total)}"></label>
    <label class="f">A quién se pagó<input id="f-prov" value="${esc(f.prov)}"></label></div>`;
  else if (f.tipo === "venta") campos = `
    <div class="grid2"><label class="f">Bultos<input id="f-bultos" inputmode="decimal" value="${esc(f.bultos)}"></label>
    <label class="f">Precio por bulto<input id="f-precio" inputmode="numeric" value="${esc(f.precio)}" placeholder="Ej. 110000"></label></div>
    <div class="grid2"><label class="f">Calidad<select id="f-calidad">${opc(CALIDADES, f.calidad)}</select></label>
    <label class="f">Kg por bulto<input id="f-kgBulto" inputmode="numeric" value="${esc(f.kgBulto)}"></label></div>
    <label class="f">Comprador<input id="f-comprador" value="${esc(f.comprador)}" placeholder="Ej. Corabastos, intermediario, ASOGADAN"></label>`;
  else if (f.tipo === "nota") campos = `<label class="f">Qué pasó<select id="f-sub">${opc(EVENTOS, f.sub || EVENTOS[0])}</select></label>`;
  return `<section class="card">
    <h2 style="font-size:1.25rem">${f.id ? "Editar registro" : "Nuevo registro"}</h2>
    <form id="form-mov" novalidate>
      <div class="chips" role="group" aria-label="Tipo de registro">${Object.entries(TIPOS).map(([k, t]) => `<button type="button" class="chip" data-tipo="${k}" aria-pressed="${f.tipo === k}">${t.nombre}</button>`).join("")}</div>
      <div class="grid2"><label class="f">Fecha<input id="f-fecha" type="date" value="${esc(f.fecha)}"></label>
      <label class="f">Siembra<select id="f-ciclo">${ciclosOrden().map((x) => `<option value="${x.id}" ${x.id === f.cicloId ? "selected" : ""}>${esc(nombreCiclo(x))}</option>`).join("")}</select></label></div>
      ${campos}
      ${f.tipo !== "nota" ? `<div class="total-box"><span>${f.tipo === "venta" ? "Total de la venta" : "Total"}</span><b id="f-tot">${peso(calcTotal(f))}</b></div>` : ""}
      <label class="f">Nota (opcional)<textarea id="f-nota" placeholder="Detalles, dosis, observaciones">${esc(f.nota)}</textarea></label>
      <div style="display:flex;flex-direction:column;gap:6px"><span class="eyebrow">Fotos de facturas o del lote</span>
        <div class="fotos">${f.fotos.map((p, i) => `<div class="foto">${p.t === "pdf" ? `<div class="pdf">PDF</div>` : `<img data-foto="${p.id}" alt="">`}<button type="button" class="x" data-quitar="${i}" aria-label="Quitar foto">×</button></div>`).join("")}
          <button type="button" class="add-foto" data-act="camara">Tomar foto</button>
          <button type="button" class="add-foto" data-act="foto">Subir foto o PDF</button></div>
      </div>
      <div class="row-btns">${f.id ? `<button type="button" class="btn sec" data-act="cancelar">Cancelar</button>` : ""}<button class="btn" id="btn-guardar">${f.id ? "Guardar cambios" : "Guardar registro"}</button></div>
    </form></section>`;
}
function calcTotal(f) {
  if (f.tipo === "jornal" || f.tipo === "insumo") return num(f.cant) * num(f.vunit);
  if (f.tipo === "venta") return num(f.bultos) * num(f.precio);
  if (f.tipo === "nota") return 0;
  return num(f.total);
}
function leerForm() {
  const f = S.form; if (!f) return;
  ["fecha", "sub", "desc", "cant", "unidad", "vunit", "total", "prov", "bultos", "kgBulto", "precio", "comprador", "calidad", "nota"].forEach((k) => { const el = document.getElementById("f-" + k); if (el) f[k] = el.value; });
  const c = document.getElementById("f-ciclo"); if (c) f.cicloId = c.value;
}
async function guardarMov() {
  leerForm(); const f = S.form, c = ciclo(f.cicloId);
  if (!c) return toast("Elige la siembra");
  if (!f.fecha) return toast("Pon la fecha");
  const total = calcTotal(f);
  if (f.tipo !== "nota" && !(total > 0)) return toast("Falta el valor o la cantidad");
  const prev = f.id ? S.movs.find((x) => x.id === f.id) : null;
  const m = { id: f.id || uid(), cicloId: c.id, loteId: c.loteId, tipo: f.tipo, fecha: f.fecha, sub: f.tipo === "otro" ? "" : f.sub || "", desc: f.desc.trim(), nota: f.nota.trim(),
    total, fotos: f.fotos.map((p) => ({ id: p.id, t: p.t })), por: sesion ? sesion.email : null, creado: prev ? prev.creado : new Date().toISOString() };
  if (f.tipo === "jornal") { Object.assign(m, { sub: f.sub || LABORES[0], cant: num(f.cant), vunit: num(f.vunit) }); pref("jornal", String(num(f.vunit))); }
  if (f.tipo === "insumo") Object.assign(m, { sub: f.sub || "abono", cant: num(f.cant), unidad: f.unidad, vunit: num(f.vunit), prov: f.prov.trim() });
  if (f.tipo === "maquina") Object.assign(m, { sub: f.sub || MAQUINAS[0], prov: f.prov.trim() });
  if (f.tipo === "otro") m.prov = f.prov.trim();
  if (f.tipo === "venta") Object.assign(m, { bultos: num(f.bultos), precio: num(f.precio), kgBulto: num(f.kgBulto) || 50, calidad: f.calidad, comprador: f.comprador.trim() });
  if (f.tipo === "nota") m.sub = f.sub || EVENTOS[0];
  try {
    await save("movs", m);
    for (const id of f.quitadas || []) if (!S.movs.some((x) => (x.fotos || []).some((p) => p.id === id))) await borrarFoto(id);
    if (f.tipo === "nota" && m.sub === "Siembra" && c.siembra !== m.fecha) await save("ciclos", { ...c, siembra: m.fecha });
    if (f.tipo === "nota" && m.sub === "Cosecha" && !c.cosecha) await save("ciclos", { ...c, cosecha: m.fecha });
    toast(f.id ? "Cambios guardados" : "Registro guardado");
    const editando = !!f.id;
    S.form = nuevoForm({ tipo: f.tipo, cicloId: f.cicloId, fecha: f.fecha });
    if (editando) S.tab = "movs";
    render();
  } catch (e) { toast("No se pudo guardar: " + (e.message || e)); }
}
async function agregarArchivos(files) {
  const f = S.form; if (!f) return; leerForm();
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast("El archivo es muy pesado"); continue; }
    try { const c = await comprimir(file); const id = await guardarFoto(c.blob, c.t); f.fotos.push({ id, t: c.t }); }
    catch (e) { toast("No se pudo guardar el archivo"); }
  }
  if (S.form === f && S.tab === "registrar") render();
}
$("#file-in").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; agregarArchivos(fs); });
$("#file-cam").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; agregarArchivos(fs); });

/* ---------- lotes y siembras ---------- */
function vLotes() {
  const ls = [...S.lotes].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!ls.length) return sinCiclo();
  return `<div class="row-btns"><button class="btn" data-act="nuevo-lote">Nuevo lote</button><button class="btn sec" data-act="nuevo-ciclo">Nueva siembra</button></div>
  ${ls.map((l) => { const cs = ciclosOrden().filter((c) => c.loteId === l.id);
    return `<section class="card">
      <div class="lote-h"><div style="min-width:0"><h2 style="font-size:1.25rem">${esc(l.nombre)}</h2><p class="muted small">${[l.vereda, l.area ? `${l.area} ${l.unidad === "fanegada" ? "fanegadas" : "ha"}` : "", l.lat ? `${l.lat}, ${l.lon}` : ""].filter(Boolean).map(esc).join(" · ") || "Sin detalles"}</p></div>
      <button class="chip" data-editlote="${l.id}">Editar</button></div>
      ${l.satelite && l.satelite.texto ? `<div class="sat"><b>Satélite:</b> ${esc(l.satelite.texto)}</div>` : ""}
      ${cs.length ? `<div class="list">${cs.map((c) => { const r = resumen(movsDe(c));
        return `<button class="item" data-ciclo="${c.id}"><span class="ic"><i class="dot" style="width:14px;height:14px;background:var(${c.activo !== false ? "--brand" : "--muted"})"></i></span>
          <span style="min-width:0"><span class="t">${esc(c.cultivo || "")} ${esc(c.variedad || "")}</span><span class="d">${c.siembra ? "Siembra " + fechaLarga(c.siembra) : "Sin fecha de siembra"} · ${c.activo !== false ? "en curso" : "terminada"}</span></span>
          <span class="m">${peso(r.gasto)}</span></button>`; }).join("")}</div>` : `<p class="muted small">Este lote no tiene siembras registradas.</p>`}
      <button class="btn sec" data-ciclonuevo="${l.id}">Nueva siembra en este lote</button>
    </section>`; }).join("")}`;
}
function abrirDlg(html) { const d = $("#dlg"); $("#dlg-body").innerHTML = html; if (!d.open) d.showModal(); hidratarFotos(d); }
function cerrarDlg() { const d = $("#dlg"); if (d.open) d.close(); }
function dlgLote(l) {
  l = l || {};
  abrirDlg(`<div class="dlg-h"><h2 style="font-size:1.2rem">${l.id ? "Editar lote" : "Nuevo lote"}</h2><button class="icon-btn" data-act="cerrar" aria-label="Cerrar">×</button></div>
  <form id="form-lote" novalidate>
    <label class="f">Nombre del lote<input id="l-nombre" value="${esc(l.nombre || "")}" placeholder="Ej. El Alto, Lote de la quebrada"></label>
    <label class="f">Vereda o finca<input id="l-vereda" value="${esc(l.vereda || "")}" placeholder="Ej. Pasquillita"></label>
    <div class="grid2"><label class="f">Área<input id="l-area" inputmode="decimal" value="${esc(l.area || "")}"></label>
    <label class="f">Unidad<select id="l-unidad"><option value="fanegada" ${l.unidad !== "ha" ? "selected" : ""}>Fanegadas</option><option value="ha" ${l.unidad === "ha" ? "selected" : ""}>Hectáreas</option></select></label></div>
    <div class="grid2"><label class="f">Latitud<input id="l-lat" inputmode="decimal" value="${esc(l.lat ?? "")}" placeholder="4.35665"></label>
    <label class="f">Longitud<input id="l-lon" inputmode="decimal" value="${esc(l.lon ?? "")}" placeholder="-74.17346"></label></div>
    <button type="button" class="btn sec" data-act="gps">Usar mi ubicación (parado en el lote)</button>
    <p class="muted small">También salen de Google Maps o Apple Maps manteniendo el dedo sobre el centro del lote. En Colombia la longitud es negativa.</p>
    <div class="row-btns">${l.id ? `<button type="button" class="btn danger" data-borrarlote="${l.id}">Eliminar lote</button>` : ""}<button class="btn">Guardar lote</button></div>
  </form>`);
  $("#form-lote").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("#l-nombre").value.trim(); if (!nombre) return toast("Ponle un nombre al lote");
    const nf = (s) => { s = String(s).trim().replace(",", "."); return s ? parseFloat(s) : null; };
    const doc = { ...l, id: l.id || uid(), nombre, vereda: $("#l-vereda").value.trim(), area: num($("#l-area").value) || null, unidad: $("#l-unidad").value, lat: nf($("#l-lat").value), lon: nf($("#l-lon").value), creado: l.creado || new Date().toISOString() };
    if (doc.lon && doc.lon > 0 && doc.lat > 0 && doc.lat < 13) doc.lon = -doc.lon;
    await save("lotes", doc); cerrarDlg(); toast("Lote guardado");
    if (!l.id) dlgCiclo({ loteId: doc.id }); else render();
  });
}
function dlgCiclo(c) {
  c = c || {}; if (!S.lotes.length) return dlgLote();
  abrirDlg(`<div class="dlg-h"><h2 style="font-size:1.2rem">${c.id ? "Editar siembra" : "Nueva siembra"}</h2><button class="icon-btn" data-act="cerrar" aria-label="Cerrar">×</button></div>
  <form id="form-ciclo" novalidate>
    <label class="f">Lote<select id="c-lote">${S.lotes.map((l) => `<option value="${l.id}" ${l.id === c.loteId ? "selected" : ""}>${esc(l.nombre)}</option>`).join("")}</select></label>
    <div class="grid2"><label class="f">Cultivo<select id="c-cultivo">${CULTIVOS.map((x) => `<option ${x === (c.cultivo || "Papa") ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label class="f">Variedad<input id="c-variedad" list="vars" value="${esc(c.variedad || "")}" placeholder="Superior, R-12…"><datalist id="vars">${VARIEDADES.map((v) => `<option>${v}</option>`).join("")}</datalist></label></div>
    <div class="grid2"><label class="f">Fecha de siembra<input id="c-siembra" type="date" value="${esc(c.siembra || "")}"></label>
    <label class="f">Semilla (bultos)<input id="c-semilla" inputmode="decimal" value="${esc(c.semillaBultos || "")}"></label></div>
    <label class="f">Estado<select id="c-activo"><option value="1" ${c.activo !== false ? "selected" : ""}>En curso</option><option value="0" ${c.activo === false ? "selected" : ""}>Terminada</option></select></label>
    <label class="f">Nota<textarea id="c-nota">${esc(c.nota || "")}</textarea></label>
    <div class="row-btns">${c.id ? `<button type="button" class="btn danger" data-borrarciclo="${c.id}">Eliminar siembra</button>` : ""}<button class="btn">Guardar siembra</button></div>
  </form>`);
  $("#form-ciclo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const doc = { ...c, id: c.id || uid(), loteId: $("#c-lote").value, cultivo: $("#c-cultivo").value, variedad: $("#c-variedad").value.trim(), siembra: $("#c-siembra").value || null,
      semillaBultos: num($("#c-semilla").value) || null, activo: $("#c-activo").value === "1", nota: $("#c-nota").value.trim(), creado: c.creado || new Date().toISOString() };
    await save("ciclos", doc); S.ciclo = doc.id; pref("ciclo", doc.id); cerrarDlg(); toast("Siembra guardada"); render();
  });
}
function dlgMov(m) {
  const c = ciclo(m.cicloId), filas = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== "") filas.push(`<dt>${k}</dt><dd>${v}</dd>`); };
  add("Fecha", esc(fechaLarga(m.fecha))); add("Siembra", esc(nombreCiclo(c)));
  if (m.tipo === "jornal") { add("Labor", esc(m.sub)); add("Jornales", `<span class="num">${m.cant}</span>`); add("Valor jornal", peso(m.vunit)); add("Trabajadores", esc(m.desc)); }
  if (m.tipo === "insumo") { add("Tipo", esc(INSUMOS[m.sub])); add("Producto", esc(m.desc)); add("Cantidad", `${m.cant} ${esc(unidadTxt(m.cant, m.unidad))}`); add("Precio unitario", peso(m.vunit)); add("Proveedor", esc(m.prov)); }
  if (m.tipo === "maquina") { add("Concepto", esc(m.sub)); add("Pagado a", esc(m.prov)); }
  if (m.tipo === "otro") { add("Descripción", esc(m.desc)); add("Pagado a", esc(m.prov)); }
  if (m.tipo === "venta") { add("Bultos", `${m.bultos} de ${m.kgBulto || 50} kg`); add("Precio por bulto", peso(m.precio)); add("Calidad", esc(m.calidad)); add("Comprador", esc(m.comprador)); }
  if (m.tipo === "nota") add("Evento", esc(m.sub));
  if (m.tipo !== "nota") add("Total", `<b class="num">${peso(m.total)}</b>`);
  add("Nota", esc(m.nota)); add("Registró", esc(m.por));
  abrirDlg(`<div class="dlg-h"><h2 style="font-size:1.2rem">${esc(tituloMov(m))}</h2><button class="icon-btn" data-act="cerrar" aria-label="Cerrar">×</button></div>
    <dl class="kv">${filas.join("")}</dl>
    ${(m.fotos || []).map((f) => (f.t === "pdf" ? `<a class="btn sec" data-foto="${f.id}" target="_blank" rel="noopener">Abrir PDF de la factura</a>` : `<img class="big-foto" data-foto="${f.id}" alt="Foto del registro">`)).join("")}
    <div class="row-btns"><button class="btn danger" data-borrarmov="${m.id}">Eliminar</button><button class="btn" data-editmov="${m.id}">Editar</button></div>`);
}
function confirmar(texto, accion) {
  abrirDlg(`<h2 style="font-size:1.15rem">${esc(texto)}</h2><p class="muted">Esta acción no se puede deshacer.</p>
  <div class="row-btns"><button class="btn sec" data-act="cerrar">Cancelar</button><button class="btn danger" id="ok-borrar">Eliminar</button></div>`);
  $("#ok-borrar").addEventListener("click", async () => { try { await accion(); cerrarDlg(); render(); } catch (e) { toast("No se pudo eliminar"); } });
}

/* ---------- Más: instalar, nube, datos ---------- */
let instalarEvt = null, nubePaso = { email: "", enviado: false, fincas: null, codigoInv: null, miembros: null };
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); instalarEvt = e; if (S.tab === "mas") render(); });
const instalada = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function vMas() {
  const n = nubeCfg();
  let inst = "";
  if (instalada()) inst = `<p class="muted">La app ya está instalada en este celular.</p>`;
  else if (instalarEvt) inst = `<button class="btn" data-act="instalar">Instalar Surco Claro en este celular</button>`;
  else if (esIOS()) inst = `<p>En Safari toca el botón <b>Compartir</b> y luego <b>Agregar a inicio</b>.</p>`;
  else inst = `<p>En Chrome abre el menú (los tres puntos) y elige <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</p>`;
  let nube = "";
  if (!NUBE_CONF) nube = `<p class="muted">La nube no está disponible en este momento. Todo queda guardado en este celular.</p>`;
  else if (nubeActiva()) nube = `
    <div class="estado-nube"><i class="dot" style="background:var(${n.error ? "--bad" : "--ok"})"></i><span><b>${esc(n.fincaNombre)}</b> · ${esc(ROLES[n.rol] || n.rol || "")}</span></div>
    <p class="muted small">${n.ultimaSync ? "Última sincronización: " + new Date(n.ultimaSync).toLocaleString("es-CO") : "Sin sincronizar todavía"}${sesion ? " · " + esc(sesion.email) : ""}</p>
    ${n.error ? `<div class="banner">${esc(n.error)}</div>` : ""}
    <div class="row-btns"><button class="btn" data-act="sync">Sincronizar ahora</button>${n.rol === "dueno" ? `<button class="btn sec" data-act="invitar">Invitar a alguien</button>` : ""}</div>
    ${nubePaso.codigoInv ? `<div class="sat">Código para entrar a la finca: <b style="font-size:1.3rem;letter-spacing:.1em">${esc(nubePaso.codigoInv)}</b><br><span class="small">Vale 7 días. La otra persona instala la app, entra con su correo y en "Unirme con código" lo escribe.</span></div>` : ""}
    <button class="btn sec" data-act="miembros">Ver quiénes están en la finca</button>
    ${nubePaso.miembros ? `<dl class="kv">${nubePaso.miembros.map((m) => `<dt>${esc(ROLES[m.rol] || m.rol)}</dt><dd>${esc(m.email)}</dd>`).join("")}</dl>` : ""}
    <button class="btn danger" data-act="desconectar">Desconectar este celular de la nube</button>`;
  else if (!sesion) nube = `
    <p>Con la nube, la familia ve y registra en la misma finca desde varios celulares. Sin nube, todo queda solo en este celular.</p>
    <label class="f">Tu correo<input id="n-email" type="email" autocomplete="email" value="${esc(nubePaso.email)}" placeholder="tucorreo@gmail.com"></label>
    ${nubePaso.enviado ? `<label class="f">Código que llegó al correo<input id="n-codigo" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></label><button class="btn" data-act="verificar">Entrar</button>` : `<button class="btn" data-act="enviar-codigo">Enviarme el código</button>`}`;
  else nube = `
    <p class="small">Entraste como <b>${esc(sesion.email)}</b>. Elige la finca de los cultivos o crea una.</p>
    ${nubePaso.fincas ? (nubePaso.fincas.length ? `<div class="list">${nubePaso.fincas.map((f) => `<button class="item" data-finca="${f.id}"><span class="ic"><i class="dot" style="width:14px;height:14px;background:var(--brand)"></i></span><span><span class="t">${esc(f.nombre)}</span><span class="d">${esc(ROLES[f.rol] || f.rol)}</span></span><span class="m small">Usar</span></button>`).join("")}</div>` : `<p class="muted small">Todavía no estás en ninguna finca.</p>`) : `<button class="btn sec" data-act="mis-fincas">Ver mis fincas</button>`}
    <label class="f">Crear finca nueva<input id="n-finca" placeholder="Ej. Finca Pasquillita"></label><button class="btn" data-act="crear-finca">Crear y conectar</button>
    <label class="f">Unirme con código<input id="n-inv" placeholder="ABC123" autocapitalize="characters"></label><button class="btn sec" data-act="unirse">Unirme</button>
    <button class="btn sec" data-act="salir">Salir de este correo</button>`;
  return `
  <section class="card"><h2 style="font-size:1.15rem">Instalar en el celular</h2>${inst}</section>
  <section class="card"><h2 style="font-size:1.15rem">Nube y familia</h2>${nube}</section>
  <section class="card"><h2 style="font-size:1.15rem">Tus datos</h2>
    <button class="btn" data-act="excel">Descargar Excel con todos los registros</button>
    <div class="row-btns"><button class="btn sec" data-act="respaldo">Guardar copia de seguridad</button><button class="btn sec" data-act="restaurar">Cargar copia</button></div>
    <p class="muted small">La copia guarda lotes, siembras y registros (sin las fotos).</p>
  </section>
  <p class="status">Surco Claro ${VERSION_APP}</p>`;
}
async function conectarFinca(id, nombre, rol) {
  await guardarNube({ fincaId: id, fincaNombre: nombre, rol, ultimoPull: null, email: sesion && sesion.email });
  await encolarTodo();
  if (!memOnly) { const fs = (await tx("fotos", "readonly", (st) => st.getAll())) || []; await tx("fotos", "readwrite", (st) => fs.forEach((f) => st.put({ ...f, subido: false }))); }
  toast("Conectando con la finca…"); render();
  await sincronizar({ silencioso: false }); render();
}
async function accionNube(a) {
  try {
    const r = await remoto();
    if (a === "enviar-codigo") { const em = $("#n-email").value.trim(); if (!em.includes("@")) return toast("Escribe un correo válido"); nubePaso.email = em; await r.enviarCodigo(em); nubePaso.enviado = true; toast("Te llegó un código al correo"); }
    if (a === "verificar") { const t = $("#n-codigo").value.trim(); sesion = await r.verificarCodigo(nubePaso.email, t); nubePaso.fincas = await r.misFincas(); }
    if (a === "mis-fincas") nubePaso.fincas = await r.misFincas();
    if (a === "crear-finca") { const n = $("#n-finca").value.trim() || "Mi finca"; const id = await r.crearFinca(n); await conectarFinca(id, n, "dueno"); return; }
    if (a === "unirse") { const cod = $("#n-inv").value.trim(); if (!cod) return toast("Escribe el código"); const id = await r.unirse(cod); const fs = await r.misFincas(); const f = fs.find((x) => x.id === id) || { nombre: "Finca", rol: "ordenador" }; await conectarFinca(id, f.nombre, f.rol); return; }
    if (a === "invitar") nubePaso.codigoInv = await r.invitar(nubeCfg().fincaId, "ordenador");
    if (a === "miembros") nubePaso.miembros = await r.miembros(nubeCfg().fincaId);
    if (a === "sync") { const n = await sincronizar({ silencioso: false }); toast(n ? `${n} cambios recibidos` : "Todo al día"); }
    if (a === "salir") { await r.salir(); sesion = null; nubePaso = { email: "", enviado: false, fincas: null, codigoInv: null, miembros: null }; }
    if (a === "desconectar") { await guardarNube({ fincaId: null, fincaNombre: "", rol: null, ultimoPull: null }); toast("Este celular quedó sin nube; sus datos siguen aquí"); }
  } catch (e) { toast(e.message || String(e)); }
  render();
}
function descargarArchivo(nombre, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function excel() {
  let XLSX;
  try { XLSX = await cargarScript("../vendor/xlsx.full.min.js", "XLSX"); } catch (e) { return toast("Se necesita señal la primera vez para crear el Excel"); }
  const filas = [...S.movs].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map((m) => { const c = ciclo(m.cicloId), l = lote(m.loteId);
    return { Fecha: m.fecha, Lote: l ? l.nombre : "", Siembra: c ? `${c.cultivo || ""} ${c.variedad || ""}`.trim() : "", Tipo: TIPOS[m.tipo] ? TIPOS[m.tipo].nombre : m.tipo,
      Categoría: m.tipo === "insumo" ? INSUMOS[m.sub] : m.sub || "", Detalle: m.desc || "", Cantidad: m.cant ?? m.bultos ?? "", Unidad: m.tipo === "venta" ? "bulto" : m.tipo === "jornal" ? "jornal" : m.unidad || "",
      "Valor unitario": m.vunit ?? m.precio ?? "", Gasto: esGasto(m) ? m.total : "", Venta: m.tipo === "venta" ? m.total : "", "Proveedor o comprador": m.prov || m.comprador || "", Nota: m.nota || "", Fotos: (m.fotos || []).length }; });
  const res = ciclosOrden().map((c) => { const r = resumen(movsDe(c)), l = lote(c.loteId);
    return { Lote: l ? l.nombre : "", Cultivo: c.cultivo, Variedad: c.variedad || "", Siembra: c.siembra || "", Estado: c.activo === false ? "Terminada" : "En curso",
      ...Object.fromEntries(CATS.map((k) => [k.n, r.cats[k.k]])), "Gasto total": r.gasto, Jornales: r.jornales, "Bultos vendidos": r.bultos, Ventas: r.ingreso, Utilidad: r.ingreso - r.gasto, "Costo por bulto": r.bultos ? Math.round(r.gasto / r.bultos) : "" }; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res), "Resumen por siembra");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Registros");
  XLSX.writeFile(wb, `surco-claro-${hoy()}.xlsx`);
}
async function respaldo() { const d = { app: "surco-claro", version: 1, fecha: new Date().toISOString(), lotes: S.lotes, ciclos: S.ciclos, movs: S.movs }; descargarArchivo(`surco-claro-copia-${hoy()}.json`, new Blob([JSON.stringify(d)], { type: "application/json" })); }
$("#file-respaldo").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (d.app !== "surco-claro") throw new Error("No es una copia de Surco Claro");
    let n = 0; for (const c of COLS) for (const doc of d[c] || []) { if (doc && doc.id) { await save(c, doc); n++; } }
    toast(`${n} datos cargados`); render(); } catch (err) { toast(err.message || "No se pudo leer la copia"); }
});

/* ---------- eventos ---------- */
function enlazar(c) {
  app.querySelectorAll("[data-tabgo]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tabgo)));
  app.querySelectorAll("[data-filtro]").forEach((b) => b.addEventListener("click", () => { S.filtro = b.dataset.filtro; render(); }));
  app.querySelectorAll("[data-mov]").forEach((b) => b.addEventListener("click", () => { const m = S.movs.find((x) => x.id === b.dataset.mov); if (m) dlgMov(m); }));
  app.querySelectorAll("[data-ciclo]").forEach((b) => b.addEventListener("click", () => { const cc = ciclo(b.dataset.ciclo); S.ciclo = cc.id; pref("ciclo", cc.id); dlgCiclo(cc); }));
  app.querySelectorAll("[data-ciclonuevo]").forEach((b) => b.addEventListener("click", () => dlgCiclo({ loteId: b.dataset.ciclonuevo })));
  app.querySelectorAll("[data-editlote]").forEach((b) => b.addEventListener("click", () => dlgLote(lote(b.dataset.editlote))));
  app.querySelectorAll("[data-finca]").forEach((b) => b.addEventListener("click", () => { const f = nubePaso.fincas.find((x) => x.id === b.dataset.finca); conectarFinca(f.id, f.nombre, f.rol); }));
  app.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.act;
    if (a === "nuevo-lote") dlgLote();
    else if (a === "nuevo-ciclo") dlgCiclo({ loteId: c && c.loteId });
    else if (a === "foto") $("#file-in").click();
    else if (a === "camara") $("#file-cam").click();
    else if (a === "cancelar") { S.form = nuevoForm(); S.tab = "movs"; render(); }
    else if (a === "instalar" && instalarEvt) { instalarEvt.prompt(); await instalarEvt.userChoice; instalarEvt = null; render(); }
    else if (a === "excel") excel();
    else if (a === "respaldo") respaldo();
    else if (a === "restaurar") $("#file-respaldo").click();
    else accionNube(a);
  }));
  const fm = $("#form-mov");
  if (fm) {
    fm.addEventListener("submit", (e) => { e.preventDefault(); guardarMov(); });
    fm.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => { leerForm(); S.form.tipo = b.dataset.tipo; S.form.sub = ""; if (b.dataset.tipo === "jornal" && !S.form.vunit) S.form.vunit = pref("jornal") || ""; render(); }));
    fm.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => { leerForm(); const [q] = S.form.fotos.splice(+b.dataset.quitar, 1); if (q) S.form.quitadas.push(q.id); render(); }));
    fm.addEventListener("input", () => { leerForm(); const t = $("#f-tot"); if (t) t.textContent = peso(calcTotal(S.form)); });
    fm.addEventListener("change", (e) => { if (e.target.id === "f-unidad") { leerForm(); render(); } });
  }
}
$("#dlg").addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-borrarmov],[data-editmov],[data-borrarlote],[data-borrarciclo]");
  if (!t) { if (e.target.id === "dlg") cerrarDlg(); return; }
  if (t.dataset.act === "cerrar") cerrarDlg();
  if (t.dataset.act === "gps") {
    if (!navigator.geolocation) return toast("Este celular no da la ubicación");
    toast("Buscando ubicación…");
    navigator.geolocation.getCurrentPosition((p) => { $("#l-lat").value = p.coords.latitude.toFixed(5); $("#l-lon").value = p.coords.longitude.toFixed(5); toast(`Listo (±${Math.round(p.coords.accuracy)} m)`); }, () => toast("No se pudo leer la ubicación"), { enableHighAccuracy: true, timeout: 20000 });
  }
  if (t.dataset.editmov) { const m = S.movs.find((x) => x.id === t.dataset.editmov); cerrarDlg();
    S.form = nuevoForm({ ...m, id: m.id, cant: m.cant ?? "", vunit: m.vunit ?? "", total: m.total ?? "", bultos: m.bultos ?? "", precio: m.precio ?? "", kgBulto: m.kgBulto ?? "50", prov: m.prov || "", comprador: m.comprador || "", desc: m.desc || "", nota: m.nota || "", fotos: (m.fotos || []).map((f) => ({ ...f })), quitadas: [] });
    S.tab = "registrar"; render(); window.scrollTo(0, 0); }
  if (t.dataset.borrarmov) { const id = t.dataset.borrarmov, m = S.movs.find((x) => x.id === id);
    confirmar("¿Eliminar este registro?", async () => { await del("movs", id); for (const f of (m && m.fotos) || []) await borrarFoto(f.id); toast("Registro eliminado"); }); }
  if (t.dataset.borrarciclo) { const id = t.dataset.borrarciclo, n = S.movs.filter((m) => m.cicloId === id).length;
    if (n) return toast(`Esta siembra tiene ${n} registros. Márcala como terminada en vez de eliminarla.`);
    confirmar("¿Eliminar esta siembra?", async () => { await del("ciclos", id); if (S.ciclo === id) S.ciclo = null; toast("Siembra eliminada"); }); }
  if (t.dataset.borrarlote) { const id = t.dataset.borrarlote;
    if (S.ciclos.some((c) => c.loteId === id)) return toast("Primero elimina las siembras de este lote.");
    confirmar("¿Eliminar este lote?", async () => { await del("lotes", id); toast("Lote eliminado"); }); }
});

/* ---------- actualizaciones de la app ---------- */
function avisoActualizacion(reg) {
  if (document.querySelector(".update-bar")) return;
  const bar = document.createElement("div"); bar.className = "update-bar";
  bar.innerHTML = `<span>Hay una versión nueva de Surco Claro.</span><button>Actualizar</button>`;
  bar.querySelector("button").onclick = () => { if (reg.waiting) reg.waiting.postMessage("ACTUALIZAR"); };
  document.body.appendChild(bar);
}
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) avisoActualizacion(reg);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) avisoActualizacion(reg); }); });
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!recargando) { recargando = true; location.reload(); } });
}

/* ---------- arranque ---------- */
(async () => {
  await cargarTodo();
  if (!TABS.includes(S.tab)) S.tab = "resumen";
  render();
  await iniciarNube();
  if (S.tab === "mas") render();
})();
