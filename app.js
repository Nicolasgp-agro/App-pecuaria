/* Hato Claro — app para fincas lecheras.
   Todo se guarda en el celular (IndexedDB) y funciona sin señal. */
(function () {
"use strict";

const APP_VERSION = "1.0.0";
const GEST = 283, SECADO = 60, ESPERA = 45;
const COLS = ["animales", "eventos", "entregas", "calidad", "config"];
const S = { animales: [], eventos: [], entregas: [], calidad: [], config: [] };
let vista = "inicio", filtroHato = "", memOnly = false, instalarEvt = null;

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hoy = () => iso(new Date());
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const add = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((D(a) - D(b)) / 864e5);
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmt = (s) => { if (!s) return "–"; const d = D(s); return d.getDate() + " " + MES[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""); };
const nf = (n, dec = 0) => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("es-CO", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pesos = (n) => n == null || isNaN(n) ? "–" : "$" + Math.round(n).toLocaleString("es-CO");
const pn = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? null : n; };
const pint = (v) => { if (v == null || String(v).trim() === "") return null; const n = parseInt(String(v).replace(/[.\s]/g, ""), 10); return isNaN(n) ? null : n; };
const slug = (s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const porArete = (a, b) => a.arete.localeCompare(b.arete, "es", { numeric: true });

const TIPOS = {
  parto: "Parto", servicio: "Servicio / inseminación", prenez: "Preñez confirmada", vacia: "Diagnóstico: vacía",
  celo: "Celo observado", secado: "Secado", tratamiento: "Tratamiento", vacuna: "Vacuna / desparasitación", obs: "Observación"
};
const ESTADOS = { lactancia: "En ordeño", seca: "Seca", novilla: "Novilla", ternera: "Ternera/o", toro: "Toro", vendida: "Vendida / descarte" };
const OBS = ["Bajó la leche", "Ubre caliente o hinchada", "Leche con grumos", "Cojea", "No come bien", "Celo", "Otra"];
const OBS_MASTITIS = ["Bajó la leche", "Ubre caliente o hinchada", "Leche con grumos"];
const NIVELES = { alta: 3, media: 2, baja: 1 };

/* ---------- almacenamiento (IndexedDB) ---------- */
let idb = null;
function abrirDB() {
  return new Promise((res, rej) => {
    if (!("indexedDB" in window)) return rej(new Error("sin indexedDB"));
    const r = indexedDB.open("hato-claro", 1);
    r.onupgradeneeded = () => { const db = r.result; COLS.forEach((c) => { if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: "id" }); }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(col, mode, fn) {
  return new Promise((res, rej) => {
    const t = idb.transaction(col, mode); const st = t.objectStore(col); const out = fn(st);
    t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
  });
}
async function cargar() {
  try {
    idb = await abrirDB();
    for (const c of COLS) S[c] = (await tx(c, "readonly", (st) => st.getAll())) || [];
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { memOnly = true; }
}
async function save(col, obj) {
  const i = S[col].findIndex((x) => x.id === obj.id);
  i >= 0 ? (S[col][i] = obj) : S[col].push(obj);
  if (!memOnly) await tx(col, "readwrite", (st) => st.put(obj));
}
async function del(col, id) {
  S[col] = S[col].filter((x) => x.id !== id);
  if (!memOnly) await tx(col, "readwrite", (st) => st.delete(id));
}
async function vaciarTodo() {
  for (const c of COLS) { S[c] = []; if (!memOnly) await tx(c, "readwrite", (st) => st.clear()); }
}
const cfg = () => S.config.find((c) => c.id === "finca") || { id: "finca", nombre: "", precioLitro: null, comprador: "" };

/* ---------- lógica del hato ---------- */
const evDe = (a) => S.eventos.filter((e) => e.arete === a).sort((x, y) => (x.fecha < y.fecha ? -1 : 1));
function ciclo(an) {
  const ev = evDe(an.arete);
  const partos = ev.filter((e) => e.tipo === "parto");
  const ultParto = partos.length ? partos[partos.length - 1].fecha : null;
  const post = ev.filter((e) => e.fecha >= (ultParto || "0000"));
  const servicios = post.filter((e) => e.tipo === "servicio");
  const ultServ = servicios.length ? servicios[servicios.length - 1] : null;
  const pren = post.filter((e) => e.tipo === "prenez").pop();
  const vacia = post.filter((e) => e.tipo === "vacia").pop();
  let prenada = false, servPren = null;
  if (pren && (!vacia || vacia.fecha < pren.fecha)) {
    prenada = true;
    const previo = servicios.filter((s) => s.fecha <= pren.fecha).pop();
    servPren = previo ? previo.fecha : null;
  }
  const fpp = prenada && servPren ? add(servPren, GEST) : null;
  const del_ = ultParto && an.estado === "lactancia" ? diff(hoy(), ultParto) : null;
  const dAbiertos = ultParto ? (prenada && servPren ? diff(servPren, ultParto) : diff(hoy(), ultParto)) : null;
  return { ultParto, ultServ, prenada, servPren, fpp, del: del_, dAbiertos, nPartos: partos.length, nServ: servicios.length };
}
function retiro(arete) {
  const h = hoy();
  return S.eventos.filter((e) => e.arete === arete && e.tipo === "tratamiento" && e.retiroHasta && e.retiroHasta >= h)
    .sort((a, b) => (a.retiroHasta < b.retiroHasta ? 1 : -1))[0] || null;
}
function entregasOrden() { return [...S.entregas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)); }
function resumenLeche() {
  const e = entregasOrden().filter((x) => x.fecha <= hoy());
  const ult = e[e.length - 1] || null;
  const previos = ult ? e.filter((x) => x.fecha < ult.fecha && x.fecha >= add(ult.fecha, -7)) : [];
  const prom7 = previos.length ? previos.reduce((s, x) => s + x.litros, 0) / previos.length : null;
  const mes = hoy().slice(0, 7);
  const delMes = e.filter((x) => x.fecha.startsWith(mes));
  const totMes = delMes.reduce((s, x) => s + x.litros, 0);
  return { ult, prom7, totMes, diasMes: delMes.length };
}
function alertas() {
  const out = [], h = hoy();
  for (const an of S.animales) {
    if (an.estado === "vendida") continue;
    const nom = `<span class="quien">${esc(an.arete)}${an.nombre ? " · " + esc(an.nombre) : ""}</span>`;
    const r = retiro(an.arete);
    if (r) out.push({ k: "bad", o: 0, h: `${nom}<span>No entregar su leche hasta el ${fmt(r.retiroHasta)} inclusive${r.producto ? " (" + esc(r.producto) + ")" : ""}. Ordéñela aparte.</span>` });
    const obsR = S.eventos.filter((e) => e.arete === an.arete && e.tipo === "obs" && diff(h, e.fecha) <= 3 && OBS_MASTITIS.includes(e.obs));
    if (obsR.length && !r) out.push({ k: "bad", o: 1, h: `${nom}<span>${esc(obsR[obsR.length - 1].obs)} (${fmt(obsR[obsR.length - 1].fecha)}). Revise si hay mastitis: prueba de CMT o el veterinario.</span>` });
    if (["toro", "ternera"].includes(an.estado)) continue;
    const c = ciclo(an);
    if (c.fpp) {
      const f = diff(c.fpp, h);
      if (f < 0) out.push({ k: "bad", o: 2, h: `${nom}<span>Pasó la fecha probable de parto (${fmt(c.fpp)}). Revísela y registre el parto.</span>` });
      else if (f <= 21) out.push({ k: "info", o: 3, h: `${nom}<span>Parto probable en ${f} días (${fmt(c.fpp)}).</span>` });
      if (an.estado === "lactancia" && f <= SECADO && f >= 0) out.push({ k: "", o: 4, h: `${nom}<span>Toca secarla: faltan ${f} días para el parto.</span>` });
    } else if (an.estado === "lactancia" && c.ultParto) {
      const del_ = diff(h, c.ultParto);
      if (c.ultServ && c.ultServ.fecha > c.ultParto) {
        const ds = diff(h, c.ultServ.fecha);
        if (ds >= 18 && ds <= 24) out.push({ k: "info", o: 5, h: `${nom}<span>Servida hace ${ds} días: esté pendiente de si repite celo.</span>` });
        else if (ds >= 35) out.push({ k: "", o: 5, h: `${nom}<span>Servida hace ${ds} días sin diagnóstico: programe palpación o ecografía.</span>` });
      } else if (del_ > ESPERA + 15) out.push({ k: del_ > 120 ? "bad" : "", o: 6, h: `${nom}<span>${del_} días de parida y sin servicio registrado.</span>` });
    }
  }
  const L = resumenLeche();
  if (L.ult && L.prom7 && L.ult.litros < L.prom7 * 0.9) {
    const p = Math.round((1 - L.ult.litros / L.prom7) * 100);
    out.push({ k: "", o: 7, h: `<span class="quien">Tanque</span><span>El ${fmt(L.ult.fecha)} entregó ${nf(L.ult.litros)} L, ${p}% menos que el promedio de la semana. Revise comida, agua y vacas enfermas.</span>` });
  }
  const q = [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0];
  if (q) {
    if (q.ccs > 400000) out.push({ k: "bad", o: 8, h: `<span class="quien">Calidad</span><span>Células somáticas en ${nf(q.ccs)} el ${fmt(q.fecha)}. Señal de mastitis en el hato.</span>` });
    if (q.ufc > 200000) out.push({ k: "bad", o: 8, h: `<span class="quien">Calidad</span><span>Bacterias (UFC) en ${nf(q.ufc)} el ${fmt(q.fecha)}. Revise lavado del equipo y enfriamiento.</span>` });
  }
  return out.sort((a, b) => a.o - b.o);
}
function proximos(dias = 30) {
  const h = hoy(), fin = add(h, dias), out = [];
  for (const an of S.animales) {
    if (["vendida", "toro", "ternera"].includes(an.estado)) continue;
    const c = ciclo(an);
    const push = (f, t) => { if (f >= h && f <= fin) out.push({ f, t, an }); };
    if (c.fpp) { push(c.fpp, "Parto probable"); if (an.estado === "lactancia") push(add(c.fpp, -SECADO), "Secar"); }
    else if (c.ultServ && (!c.ultParto || c.ultServ.fecha > c.ultParto)) {
      push(add(c.ultServ.fecha, 21), "Vigilar repetición de celo");
      push(add(c.ultServ.fecha, 40), "Diagnóstico de preñez");
    }
    const r = retiro(an.arete); if (r) push(add(r.retiroHasta, 1), "Vuelve a entregar leche");
  }
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}

/* ---------- piezas de interfaz ---------- */
function nivelHTML(n) { const v = NIVELES[n] || 0; return v ? `<span class="nivel" title="Producción ${n}"><i class="${v >= 1 ? "on" : ""}"></i><i class="${v >= 2 ? "on" : ""}"></i><i class="${v >= 3 ? "on" : ""}"></i></span>` : ""; }
function chips(an, c) {
  let h = `<span class="chip ${an.estado === "lactancia" ? "lact" : an.estado === "seca" ? "seca" : ""}">${esc(ESTADOS[an.estado] || an.estado)}</span>`;
  if (c && c.prenada) h += `<span class="chip pren">Preñada</span>`;
  if (retiro(an.arete)) h += `<span class="chip retiro">Leche en retiro</span>`;
  if (an.ejemplo) h += `<span class="chip ej">Ejemplo</span>`;
  return h;
}
function edadTxt(nac) { if (!nac) return "–"; const d = diff(hoy(), nac); return d < 730 ? Math.max(0, Math.round(d / 30.4)) + " meses" : (d / 365.25).toFixed(1).replace(".", ",") + " años"; }

/* ---------- vistas ---------- */
function render() {
  const c = cfg();
  $("#fincaNombre").textContent = c.nombre || "Mi finca";
  $("#fechaHoy").textContent = new Date().toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
  ({ inicio: vInicio, hato: vHato, leche: vLeche, ciclos: vCiclos, mas: vMas })[vista]();
}
function setVista(v) {
  vista = v;
  $$(".tabbar button").forEach((b) => (b.dataset.v === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $$(".vista").forEach((s) => (s.hidden = s.id !== "v-" + v));
  render(); window.scrollTo(0, 0);
}

function vInicio() {
  const el = $("#v-inicio");
  if (!S.animales.length && !S.entregas.length) {
    el.innerHTML = `<div class="panel stack">
      <h2>Bienvenido a Hato Claro</h2>
      <p class="muted">Lleve el registro de su hato, la leche que entrega, los partos, servicios y tratamientos. Todo queda guardado en este celular y funciona sin señal.</p>
      <label class="f">Nombre de la finca<input id="wNombre" value="${esc(cfg().nombre)}" placeholder="Ej. Finca La Esperanza" autocomplete="off"></label>
      <button class="btn block" id="wEmpezar" type="button">Empezar con mi finca</button>
      <button class="btn ghost block" id="wEjemplo" type="button">Ver primero con datos de ejemplo</button>
    </div>`;
    $("#wEmpezar").onclick = async () => { await save("config", { ...cfg(), nombre: $("#wNombre").value.trim() }); formAnimal(); };
    $("#wEjemplo").onclick = async () => { if ($("#wNombre").value.trim()) await save("config", { ...cfg(), nombre: $("#wNombre").value.trim() }); await cargarEjemplo(); toast("Datos de ejemplo cargados"); render(); };
    return;
  }
  const lact = S.animales.filter((a) => a.estado === "lactancia");
  const adultas = S.animales.filter((a) => ["lactancia", "seca"].includes(a.estado));
  const pren = adultas.filter((a) => ciclo(a).prenada);
  const L = resumenLeche();
  const precio = cfg().precioLitro;
  let delta = "";
  if (L.ult && L.prom7) { const p = (L.ult.litros / L.prom7 - 1) * 100; delta = `<span class="delta ${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${nf(Math.abs(p))}% vs. semana</span>`; }
  const al = alertas();
  const entregaHoy = S.entregas.find((e) => e.fecha === hoy());
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi hero"><div><span class="eyebrow">${L.ult ? (L.ult.fecha === hoy() ? "Entregado hoy" : "Última entrega · " + fmt(L.ult.fecha)) : "Leche entregada"}</span><b class="num">${L.ult ? nf(L.ult.litros) + " L" : "–"}</b>${delta}</div>
        ${entregaHoy ? "" : `<button class="btn" id="qEntrega" type="button">Registrar leche de hoy</button>`}</div>
      <div class="kpi"><span class="eyebrow">Vacas en ordeño</span><b>${lact.length}</b><span class="small muted">${L.ult && lact.length ? nf(L.ult.litros / lact.length, 1) + " L por vaca" : "&nbsp;"}</span></div>
      <div class="kpi"><span class="eyebrow">Preñadas</span><b>${adultas.length ? Math.round((pren.length / adultas.length) * 100) + "%" : "–"}</b><span class="small muted">${pren.length} de ${adultas.length} vacas</span></div>
      <div class="kpi"><span class="eyebrow">Leche del mes</span><b>${nf(L.totMes)} L</b><span class="small muted">${L.diasMes} días registrados</span></div>
      <div class="kpi"><span class="eyebrow">Ingreso estimado</span><b>${precio ? pesos(L.totMes * precio) : "–"}</b><span class="small muted">${precio ? "a " + pesos(precio) + " por litro" : `<button class="btn ghost sm" id="qPrecio" type="button">Poner precio</button>`}</span></div>
    </div>
    <div class="stack">
      <div class="row spread"><h2>Para atender</h2><span class="small muted">${al.length ? al.length + " pendientes" : ""}</span></div>
      <div class="alertas">${al.length ? al.map((a) => `<div class="alerta ${a.k}">${a.h}</div>`).join("") : `<div class="empty">Todo al día. Aquí aparecerán secados, partos próximos, retiros de leche y vacas por revisar.</div>`}</div>
    </div>
    <div class="stack">
      <h2>Registro rápido</h2>
      <div class="acciones">
        <button class="accion" data-q="entrega" type="button"><b>Leche entregada</b><span class="small muted">Litros del día</span></button>
        <button class="accion" data-q="obs" type="button"><b>Observación</b><span class="small muted">Bajó leche, ubre, cojera</span></button>
        <button class="accion" data-q="tratamiento" type="button"><b>Tratamiento</b><span class="small muted">Con días de retiro</span></button>
        <button class="accion" data-q="nac" type="button"><b>Nacimiento</b><span class="small muted">Parto y cría</span></button>
        <button class="accion" data-q="servicio" type="button"><b>Servicio</b><span class="small muted">Monta o inseminación</span></button>
        <button class="accion" data-q="prenez" type="button"><b>Diagnóstico</b><span class="small muted">Preñada o vacía</span></button>
      </div>
    </div>`;
  const q = $("#qEntrega"); if (q) q.onclick = () => formEntrega();
  const qp = $("#qPrecio"); if (qp) qp.onclick = () => setVista("mas");
  $$("[data-q]", el).forEach((b) => (b.onclick = () => abrir(b.dataset.q)));
}
function abrir(q, arete) {
  ({ entrega: () => formEntrega(), obs: () => formObs(arete), tratamiento: () => formEvento("tratamiento", arete), nac: () => formNacimiento(arete),
     servicio: () => formEvento("servicio", arete), prenez: () => formEvento("prenez", arete), evento: () => formEvento("celo", arete),
     animal: () => formAnimal(), calidad: () => formCalidad(), secado: () => formEvento("secado", arete), vacuna: () => formEvento("vacuna", arete) })[q]();
}

function vHato() {
  const el = $("#v-hato");
  const filtros = [["", "Todos"], ["lactancia", "En ordeño"], ["seca", "Secas"], ["novilla", "Novillas"], ["ternera", "Terneras/os"], ["toro", "Toros"], ["vendida", "Vendidas"]];
  const lista = S.animales.filter((a) => (filtroHato ? a.estado === filtroHato : a.estado !== "vendida")).sort(porArete);
  el.innerHTML = `
    <div class="row spread"><h2>Hato · ${S.animales.filter((a) => a.estado !== "vendida").length} animales</h2><button class="btn sm" id="hNuevo" type="button">+ Nueva res</button></div>
    <div class="chips">${filtros.map(([k, v]) => `<button class="chipbtn" type="button" data-f="${k}" aria-pressed="${filtroHato === k}">${v}</button>`).join("")}</div>
    <div class="lista">${lista.length ? lista.map((an) => {
      const c = ciclo(an);
      let f2, f3;
      if (an.estado === "lactancia") { f2 = ["Días de parida", c.del ?? "–"]; f3 = ["Producción", an.nivel ? an.nivel[0].toUpperCase() + an.nivel.slice(1) : "–"]; }
      else if (c.fpp) { f2 = ["Parto probable", fmt(c.fpp)]; f3 = ["Partos", c.nPartos]; }
      else { f2 = ["Partos", c.nPartos]; f3 = ["Raza", an.raza || "–"]; }
      return `<button class="card" type="button" data-a="${esc(an.arete)}">
        <div class="row spread"><div class="row" style="gap:8px"><span class="tag">${esc(an.arete)}</span><h3>${esc(an.nombre || "Sin nombre")}</h3>${nivelHTML(an.nivel)}</div><span class="small muted">${an.sexo === "M" ? "Macho" : "Hembra"}</span></div>
        <div>${chips(an, c)}</div>
        <div class="facts small muted"><div>Edad<b>${edadTxt(an.nacimiento)}</b></div><div>${f2[0]}<b>${esc(f2[1])}</b></div><div>${f3[0]}<b>${esc(f3[1])}</b></div></div>
      </button>`;
    }).join("") : `<div class="empty">No hay animales ${filtroHato ? "en este grupo" : "todavía"}.<button class="btn" type="button" id="hNuevo2">Agregar la primera res</button></div>`}</div>`;
  $("#hNuevo").onclick = () => formAnimal();
  const n2 = $("#hNuevo2"); if (n2) n2.onclick = () => formAnimal();
  $$("[data-f]", el).forEach((b) => (b.onclick = () => { filtroHato = b.dataset.f; vHato(); }));
  $$(".card", el).forEach((b) => (b.onclick = () => detalle(b.dataset.a)));
}

function vLeche() {
  const el = $("#v-leche");
  const L = resumenLeche(); const precio = cfg().precioLitro;
  const dias = []; for (let i = 29; i >= 0; i--) dias.push(add(hoy(), -i));
  const mapa = {}; S.entregas.forEach((e) => (mapa[e.fecha] = e.litros));
  const vals = dias.map((d) => mapa[d] ?? null);
  const max = Math.max(...vals.filter((v) => v != null), 1);
  const step = max > 1000 ? 250 : max > 400 ? 100 : max > 150 ? 50 : max > 60 ? 20 : 10;
  const top = Math.ceil(max / step) * step;
  const W = 640, H = 210, Lm = 44, B = 26, T = 10, R = 8, bw = (W - Lm - R) / 30;
  let svg = "";
  for (let v = 0; v <= top; v += step) { const y = T + (H - T - B) * (1 - v / top); svg += `<line x1="${Lm}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${Lm - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`; }
  vals.forEach((v, i) => {
    const x = Lm + i * bw + bw * 0.15;
    if (v != null) { const h = (H - T - B) * (v / top); svg += `<rect x="${x}" y="${H - B - h}" width="${bw * 0.7}" height="${h}" rx="2" fill="${i === 29 ? "var(--brand)" : "var(--milk)"}"><title>${fmt(dias[i])}: ${nf(v)} L</title></rect>`; }
    if (i % 5 === 4 || i === 29) svg += `<text x="${x + bw * 0.35}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${D(dias[i]).getDate()}/${D(dias[i]).getMonth() + 1}</text>`;
  });
  const rec = entregasOrden().reverse().slice(0, 15);
  const q = [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const u = q[0];
  const bar = (v, lo, hi, good) => `<div class="qbar"><i style="width:${Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%;background:var(${good ? "--ok" : "--bad"})"></i></div>`;
  el.innerHTML = `
    <div class="row spread"><h2>Leche entregada</h2><button class="btn sm" id="lNueva" type="button">+ Registrar</button></div>
    <div class="kpis">
      <div class="kpi"><span class="eyebrow">Este mes</span><b>${nf(L.totMes)} L</b><span class="small muted">${L.diasMes ? nf(L.totMes / L.diasMes) + " L por día" : "&nbsp;"}</span></div>
      <div class="kpi"><span class="eyebrow">Ingreso estimado</span><b>${precio ? pesos(L.totMes * precio) : "–"}</b><span class="small muted">${precio ? "a " + pesos(precio) + "/L" : "Ponga el precio en Más"}</span></div>
    </div>
    <div class="panel"><div class="row spread"><h3>Últimos 30 días</h3><span class="small muted">litros por día</span></div>
      <div class="chart">${vals.some((v) => v != null) ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Litros entregados por día">${svg}</svg>` : `<div class="empty">Aún no hay entregas en los últimos 30 días.</div>`}</div></div>
    <div class="panel"><h3>Entregas recientes</h3>
      ${rec.length ? `<div class="tablewrap"><table><tr><th>Fecha</th><th class="r">Mañana</th><th class="r">Tarde</th><th class="r">Total</th><th></th></tr>${rec.map((e) => `<tr><td>${fmt(e.fecha)}</td><td class="r">${e.am != null ? nf(e.am) : "–"}</td><td class="r">${e.pm != null ? nf(e.pm) : "–"}</td><td class="r"><b>${nf(e.litros)}</b></td><td><button class="btn ghost sm" type="button" data-e="${e.id}">Editar</button></td></tr>`).join("")}</table></div>` : `<p class="muted small" style="margin-top:8px">Sin entregas registradas.</p>`}
    </div>
    <div class="row spread"><h2>Calidad de la leche</h2><button class="btn ghost sm" id="lCal" type="button">+ Análisis</button></div>
    ${u ? `<div class="panel"><span class="eyebrow">Último análisis · ${fmt(u.fecha)}</span>
      <div class="grid2" style="margin-top:10px">
        <div>Grasa <b class="num">${nf(u.grasa, 2)} %</b>${u.grasa != null ? bar(u.grasa, 2.5, 5, u.grasa >= 3.2) : ""}</div>
        <div>Proteína <b class="num">${nf(u.proteina, 2)} %</b>${u.proteina != null ? bar(u.proteina, 2.5, 4, u.proteina >= 3) : ""}</div>
        <div>Células somáticas <b class="num">${nf(u.ccs)}</b>${u.ccs != null ? bar(u.ccs, 0, 800000, u.ccs <= 400000) : ""}</div>
        <div>Bacterias (UFC) <b class="num">${nf(u.ufc)}</b>${u.ufc != null ? bar(u.ufc, 0, 400000, u.ufc <= 200000) : ""}</div>
      </div></div>
      <div class="panel"><div class="tablewrap"><table><tr><th>Fecha</th><th class="r">Grasa</th><th class="r">Proteína</th><th class="r">Sólidos</th><th class="r">CCS</th><th class="r">UFC</th></tr>${q.map((r) => `<tr><td>${fmt(r.fecha)}</td><td class="r">${nf(r.grasa, 2)}</td><td class="r">${nf(r.proteina, 2)}</td><td class="r">${nf(r.solidos, 2)}</td><td class="r" style="color:${r.ccs > 400000 ? "var(--bad)" : "inherit"}">${nf(r.ccs)}</td><td class="r" style="color:${r.ufc > 200000 ? "var(--bad)" : "inherit"}">${nf(r.ufc)}</td></tr>`).join("")}</table></div></div>`
    : `<div class="empty">Agregue los resultados que le entrega el comprador o el laboratorio.</div>`}
    <p class="small muted">Alertas de calidad: células somáticas sobre 400.000 por mL y bacterias sobre 200.000 UFC por mL. Compárelas con la tabla de pago de su comprador.</p>`;
  $("#lNueva").onclick = () => formEntrega();
  $("#lCal").onclick = () => formCalidad();
  $$("[data-e]", el).forEach((b) => (b.onclick = () => formEntrega(S.entregas.find((x) => x.id === b.dataset.e))));
}

function vCiclos() {
  const el = $("#v-ciclos");
  const vacas = S.animales.filter((a) => ["lactancia", "seca", "novilla"].includes(a.estado)).sort(porArete);
  const prox = proximos(30);
  const ev = [...S.eventos].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 15);
  el.innerHTML = `
    <div class="panel stack"><h2>Próximos 30 días</h2>
      ${prox.length ? `<div class="tablewrap"><table><tr><th>Fecha</th><th>Qué</th><th>Animal</th></tr>${prox.map((p) => `<tr><td>${fmt(p.f)}<br><span class="small muted">${diff(p.f, hoy()) === 0 ? "hoy" : "en " + diff(p.f, hoy()) + " días"}</span></td><td>${esc(p.t)}</td><td><span class="tag">${esc(p.an.arete)}</span> ${esc(p.an.nombre || "")}</td></tr>`).join("")}</table></div>` : `<p class="muted">Nada programado en el próximo mes.</p>`}
    </div>
    <div class="panel stack"><h2>Ciclo por vaca</h2>
      <p class="small muted">Parto probable a 283 días del servicio con preñez confirmada. Secado 60 días antes del parto.</p>
      ${vacas.length ? `<div class="tablewrap"><table><tr><th>Vaca</th><th>Estado</th><th>Últ. parto</th><th class="r">Días parida</th><th>Últ. servicio</th><th>Parto prob.</th><th>Secar</th><th class="r">Días abiertos</th></tr>${vacas.map((an) => { const c = ciclo(an); return `<tr><td><span class="tag">${esc(an.arete)}</span> ${esc(an.nombre || "")}</td><td>${c.prenada ? '<span class="chip pren">Preñada</span>' : `<span class="chip">${esc(ESTADOS[an.estado])}</span>`}</td><td>${fmt(c.ultParto)}</td><td class="r">${c.del ?? "–"}</td><td>${c.ultServ ? fmt(c.ultServ.fecha) : "–"}</td><td>${fmt(c.fpp)}</td><td>${c.fpp ? fmt(add(c.fpp, -SECADO)) : "–"}</td><td class="r">${c.dAbiertos ?? "–"}</td></tr>`; }).join("")}</table></div>` : `<p class="muted">Sin vacas ni novillas registradas.</p>`}
    </div>
    <div class="panel stack"><h2>Últimos registros</h2>
      <div class="timeline">${ev.length ? ev.map((e) => `<div><span class="small muted">${fmt(e.fecha)}</span><br><b>${esc(e.tipo === "obs" ? e.obs : TIPOS[e.tipo] || e.tipo)}</b> · <span class="tag">${esc(e.arete)}</span>${e.cria ? ` → cría <span class="tag">${esc(e.cria)}</span>` : ""}${e.producto ? " · " + esc(e.producto) : ""}${e.nota ? ` <span class="muted">— ${esc(e.nota)}</span>` : ""}</div>`).join("") : `<div class="muted">Sin registros todavía.</div>`}</div>
    </div>`;
}

function vMas() {
  const el = $("#v-mas"); const c = cfg();
  const nEj = COLS.reduce((s, k) => s + S[k].filter((x) => x.ejemplo).length, 0);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  el.innerHTML = `
    <div class="panel stack"><h2>Mi finca</h2>
      <form id="fFinca" class="grid2">
        <label class="f full">Nombre de la finca<input id="cNombre" value="${esc(c.nombre)}" autocomplete="off"></label>
        <label class="f">Precio por litro ($)<input id="cPrecio" inputmode="numeric" value="${c.precioLitro ?? ""}" placeholder="Ej. 1850"></label>
        <label class="f">Comprador<input id="cComprador" value="${esc(c.comprador || "")}" placeholder="Ej. Alpina, Colanta…"></label>
        <button class="btn full" type="submit">Guardar</button>
      </form>
    </div>
    ${standalone ? "" : `<div class="panel stack"><h2>Instalar en el celular</h2>
      <p class="muted">Quede con el ícono de Hato Claro en la pantalla y ábrala como cualquier app, aun sin señal.</p>
      ${instalarEvt ? `<button class="btn" id="mInstalar" type="button">Instalar Hato Claro</button>` : ios ? `<p>En iPhone: toque el botón Compartir de Safari y luego <b>Agregar a inicio</b>.</p>` : `<p>En Chrome: toque el menú ⋮ y luego <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.</p>`}
    </div>`}
    <div class="panel stack"><h2>Sus datos</h2>
      <p class="muted">Los datos se guardan solo en este celular. Saque una copia de seguridad cada semana y guárdela en WhatsApp, Drive o el correo.</p>
      <button class="btn" id="mExcel" type="button">Descargar en Excel</button>
      <button class="btn ghost" id="mBackup" type="button">Guardar copia de seguridad</button>
      <label class="btn ghost" for="mRestore" style="cursor:pointer">Restaurar una copia</label>
      <input type="file" id="mRestore" accept="application/json,.json" hidden>
      ${memOnly ? `<p class="small" style="color:var(--bad)">Este navegador no permite guardar datos. Lo que registre se perderá al cerrar. Abra Hato Claro en Chrome.</p>` : ""}
    </div>
    <div class="panel stack"><h2>Datos de ejemplo</h2>
      ${nEj ? `<p class="muted">Hay ${nEj} registros de ejemplo mezclados con los suyos.</p><button class="btn ghost" id="mBorrarEj" type="button">Borrar datos de ejemplo</button>` : `<p class="muted">Cargue una finca de ejemplo para ver cómo funciona la app.</p><button class="btn ghost" id="mCargarEj" type="button">Cargar datos de ejemplo</button>`}
    </div>
    <p class="small muted" style="text-align:center">Hato Claro versión ${APP_VERSION}</p>`;
  $("#fFinca").onsubmit = async (e) => { e.preventDefault(); await save("config", { ...c, nombre: $("#cNombre").value.trim(), precioLitro: pint($("#cPrecio").value), comprador: $("#cComprador").value.trim() }); toast("Datos de la finca guardados"); render(); };
  const mi = $("#mInstalar"); if (mi) mi.onclick = async () => { instalarEvt.prompt(); await instalarEvt.userChoice.catch(() => {}); instalarEvt = null; render(); };
  $("#mExcel").onclick = exportarExcel;
  $("#mBackup").onclick = backup;
  $("#mRestore").onchange = (e) => restaurar(e.target.files[0]);
  const be = $("#mBorrarEj"); if (be) be.onclick = function () { confirmar(this, "Toque otra vez para borrar los ejemplos", async () => { for (const k of COLS) for (const r of S[k].filter((x) => x.ejemplo)) await del(k, r.id); toast("Ejemplos borrados"); render(); }); };
  const ce = $("#mCargarEj"); if (ce) ce.onclick = async () => { await cargarEjemplo(); toast("Datos de ejemplo cargados"); render(); };
}

/* ---------- hojas y formularios ---------- */
function sheet(html, ready) {
  $("#sheetHost").innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = $("#sheetHost .sheet-bg");
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  $$("[data-close]", bg).forEach((b) => (b.onclick = cerrar));
  ready && ready($(".sheet", bg));
}
function cerrar() { $("#sheetHost").innerHTML = ""; }
const cab = (t) => `<div class="row spread"><h2>${t}</h2><button class="btn ghost sm" data-close type="button">Cerrar</button></div>`;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2400); }
function confirmar(btn, texto, fn) { if (btn.dataset.ok) return fn(); btn.dataset.ok = "1"; btn.className = "btn danger"; btn.textContent = texto; }
async function guardarYcerrar(fn, msg) { try { await fn(); cerrar(); toast(msg); render(); } catch (e) { toast("No se pudo guardar. Intente de nuevo."); } }
const opts = (arr, sel) => arr.sort(porArete).map((a) => `<option value="${esc(a.arete)}"${a.arete === sel ? " selected" : ""}>${esc(a.arete)}${a.nombre ? " · " + esc(a.nombre) : ""}</option>`).join("");
const hembras = () => S.animales.filter((a) => a.sexo !== "M" && !["ternera", "vendida"].includes(a.estado));
const activos = () => S.animales.filter((a) => a.estado !== "vendida");
function faltanAnimales() { sheet(cab("Primero agregue sus animales") + `<p class="muted">Para este registro necesita tener al menos una res en el hato.</p><button class="btn" type="button" id="xA">Agregar una res</button>`, (s) => ($("#xA", s).onclick = () => formAnimal())); }

function menuRegistrar() {
  const items = [["entrega", "Leche entregada"], ["obs", "Observación de una vaca"], ["tratamiento", "Tratamiento"], ["nac", "Nacimiento"], ["servicio", "Servicio o inseminación"], ["prenez", "Diagnóstico de preñez"], ["secado", "Secado"], ["vacuna", "Vacuna o desparasitación"], ["calidad", "Análisis de calidad"], ["animal", "Nueva res"]];
  sheet(cab("¿Qué quiere registrar?") + `<div class="acciones">${items.map(([k, v]) => `<button class="accion" type="button" data-go="${k}"><b>${v}</b></button>`).join("")}</div>`,
    (s) => $$("[data-go]", s).forEach((b) => (b.onclick = () => abrir(b.dataset.go))));
}

function formEntrega(e) {
  const x = e || {};
  sheet(cab(e ? "Editar entrega" : "Leche entregada") + `
    <form id="fL" class="grid2">
      <label class="f full">Fecha<input type="date" id="lF" value="${x.fecha || hoy()}" max="${hoy()}" required></label>
      <label class="f">Mañana (litros)<input class="big" id="lAM" inputmode="decimal" value="${x.am ?? ""}" placeholder="0"></label>
      <label class="f">Tarde (litros)<input class="big" id="lPM" inputmode="decimal" value="${x.pm ?? ""}" placeholder="0"></label>
      <div class="full row spread"><span class="muted">Total del día</span><b class="num" id="lTot" style="font-size:1.4rem">–</b></div>
      <label class="f full">Nota (opcional)<input id="lN" value="${esc(x.nota || "")}" placeholder="Ej. el carro pasó tarde"></label>
      <p class="small muted full">Si entrega una sola vez al día, ponga todo en Mañana. Use lo que mide el comprador o el carrotanque.</p>
      <button class="btn full" type="submit">Guardar</button>
      ${e ? `<button class="btn ghost full" type="button" id="lDel">Eliminar esta entrega</button>` : ""}
    </form>`, (s) => {
    const tot = () => { const a = pn($("#lAM", s).value), b = pn($("#lPM", s).value); $("#lTot", s).textContent = a == null && b == null ? "–" : nf((a || 0) + (b || 0), 1) + " L"; };
    $("#lAM", s).oninput = tot; $("#lPM", s).oninput = tot; tot(); $("#lAM", s).focus();
    $("#fL", s).onsubmit = (ev) => { ev.preventDefault();
      const fecha = $("#lF", s).value, am = pn($("#lAM", s).value), pm = pn($("#lPM", s).value);
      if (am == null && pm == null) return toast("Escriba los litros entregados");
      const ya = S.entregas.find((y) => y.fecha === fecha && (!e || y.id !== e.id));
      guardarYcerrar(async () => { if (e && e.id !== fecha) await del("entregas", e.id); if (ya) await del("entregas", ya.id);
        await save("entregas", { id: fecha, fecha, am, pm, litros: Math.round(((am || 0) + (pm || 0)) * 10) / 10, nota: $("#lN", s).value.trim() }); }, "Entrega guardada");
    };
    const d = $("#lDel", s); if (d) d.onclick = function () { confirmar(this, "Toque otra vez para eliminar", () => guardarYcerrar(() => del("entregas", e.id), "Entrega eliminada")); };
  });
}

function formAnimal(an) {
  const e = an || {};
  sheet(cab(an ? "Editar res" : "Nueva res") + `
    <form id="fA" class="grid2">
      <label class="f">Número o arete<input id="aArete" required value="${esc(e.arete || "")}" ${an ? "readonly" : ""} autocomplete="off"></label>
      <label class="f">Nombre<input id="aNombre" value="${esc(e.nombre || "")}" autocomplete="off"></label>
      <label class="f">Raza<input id="aRaza" list="razas" value="${esc(e.raza || "")}"><datalist id="razas"><option>Holstein</option><option>Jersey</option><option>Normando</option><option>Ayrshire</option><option>Pardo Suizo</option><option>Gyr</option><option>Girolando</option><option>Cruce</option></datalist></label>
      <label class="f">Sexo<select id="aSexo"><option value="H">Hembra</option><option value="M"${e.sexo === "M" ? " selected" : ""}>Macho</option></select></label>
      <label class="f">Fecha de nacimiento<input type="date" id="aNac" value="${esc(e.nacimiento || "")}" max="${hoy()}"></label>
      <label class="f">Estado<select id="aEstado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}"${(e.estado || "lactancia") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Madre (número)<input id="aMadre" value="${esc(e.madre || "")}" autocomplete="off"></label>
      <label class="f">Origen<select id="aOrigen"><option value="nacida">Nacida en la finca</option><option value="comprada"${e.origen === "comprada" ? " selected" : ""}>Comprada</option></select></label>
      <label class="f full">Fecha del último parto (si ya parió)<input type="date" id="aParto" max="${hoy()}"></label>
      <button class="btn full" type="submit">Guardar</button>
    </form>`, (s) => {
    if (an) $("#aParto", s).closest("label").hidden = true;
    $("#fA", s).onsubmit = (ev) => { ev.preventDefault();
      const arete = $("#aArete", s).value.trim(); if (!arete) return;
      const id = slug(arete);
      if (!an && S.animales.some((a) => a.id === id)) return toast("Ya existe una res con ese número");
      const data = { ...e, id, arete, nombre: $("#aNombre", s).value.trim(), raza: $("#aRaza", s).value.trim(), sexo: $("#aSexo", s).value, nacimiento: $("#aNac", s).value, estado: $("#aEstado", s).value, madre: $("#aMadre", s).value.trim(), origen: $("#aOrigen", s).value };
      const parto = $("#aParto", s).value;
      guardarYcerrar(async () => { await save("animales", data); if (!an && parto) await save("eventos", { id: uid(), arete, tipo: "parto", fecha: parto, nota: "Registrado al ingresar la res" }); }, "Res guardada");
    };
  });
}

function formNacimiento(madre) {
  if (!hembras().length) return faltanAnimales();
  sheet(cab("Nacimiento") + `<p class="muted small">Se registra el parto, la cría entra al hato y la madre pasa a ordeño.</p>
    <form id="fN" class="grid2">
      <label class="f">Madre<select id="nMadre" required>${opts(hembras(), madre)}</select></label>
      <label class="f">Fecha del parto<input type="date" id="nFecha" value="${hoy()}" max="${hoy()}" required></label>
      <label class="f">Número de la cría<input id="nArete" required autocomplete="off"></label>
      <label class="f">Nombre de la cría<input id="nNombre" autocomplete="off"></label>
      <label class="f">Sexo<select id="nSexo"><option value="H">Hembra</option><option value="M">Macho</option></select></label>
      <label class="f">Raza o padre<input id="nRaza" placeholder="Ej. Holstein × Jersey"></label>
      <label class="f full">Cómo fue el parto<input id="nNota" placeholder="Normal, asistido, retuvo placenta…"></label>
      <button class="btn full" type="submit">Guardar nacimiento</button>
    </form>`, (s) => {
    $("#fN", s).onsubmit = (ev) => { ev.preventDefault();
      const m = S.animales.find((a) => a.arete === $("#nMadre", s).value); const arete = $("#nArete", s).value.trim();
      if (!m || !arete) return; if (S.animales.some((a) => a.id === slug(arete))) return toast("Ya existe una res con ese número");
      const fecha = $("#nFecha", s).value;
      guardarYcerrar(async () => {
        await save("animales", { id: slug(arete), arete, nombre: $("#nNombre", s).value.trim(), sexo: $("#nSexo", s).value, raza: $("#nRaza", s).value.trim() || m.raza || "", nacimiento: fecha, estado: "ternera", madre: m.arete, origen: "nacida" });
        await save("eventos", { id: uid(), arete: m.arete, tipo: "parto", fecha, cria: arete, nota: $("#nNota", s).value.trim() });
        await save("animales", { ...m, estado: "lactancia" });
      }, "Nacimiento registrado");
    };
  });
}

function formEvento(tipo, arete) {
  if (!activos().length) return faltanAnimales();
  const esTrat = tipo === "tratamiento";
  const titulo = { tratamiento: "Tratamiento", servicio: "Servicio o inseminación", prenez: "Diagnóstico de preñez", secado: "Secado", vacuna: "Vacuna o desparasitación", celo: "Celo observado" }[tipo] || "Registro";
  const lista = tipo === "secado" ? S.animales.filter((a) => a.estado === "lactancia") : ["servicio", "prenez", "celo"].includes(tipo) ? hembras() : activos();
  if (!lista.length) return sheet(cab(titulo) + `<p class="muted">No hay animales para este registro.</p>`);
  sheet(cab(titulo) + `
    <form id="fE" class="grid2">
      <label class="f">Animal<select id="eA" required>${opts([...lista], arete)}</select></label>
      <label class="f">Fecha<input type="date" id="eF" value="${hoy()}" required></label>
      ${tipo === "prenez" ? `<div class="full"><span class="f" style="font-size:.88rem;color:var(--muted);font-weight:700">Resultado</span><div class="opciones" style="margin-top:6px"><button type="button" class="chipbtn" data-r="prenez" aria-pressed="true">Preñada</button><button type="button" class="chipbtn" data-r="vacia" aria-pressed="false">Vacía</button></div></div>` : ""}
      ${tipo === "servicio" ? `<label class="f full">Toro o pajilla<input id="eP" placeholder="Ej. Pajilla Holstein, toro de la finca"></label>` : ""}
      ${esTrat || tipo === "vacuna" ? `<label class="f full">Producto<input id="eP" placeholder="${esTrat ? "Nombre del medicamento" : "Ej. Aftosa, ivermectina"}"></label>` : ""}
      ${esTrat ? `<label class="f">Días de retiro de leche<input id="eR" inputmode="numeric" placeholder="Ver etiqueta"></label><label class="f">Causa<input id="eC" placeholder="Mastitis, cojera…"></label><p class="small muted full">Los días de retiro vienen en la etiqueta del producto. Mientras dure, la app le recordará no entregar la leche de esta vaca.</p>` : ""}
      <label class="f full">Nota (opcional)<input id="eN"></label>
      <button class="btn full" type="submit">Guardar</button>
    </form>`, (s) => {
    let res = "prenez";
    $$("[data-r]", s).forEach((b) => (b.onclick = () => { res = b.dataset.r; $$("[data-r]", s).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $("#fE", s).onsubmit = (ev) => { ev.preventDefault();
      const a = S.animales.find((x) => x.arete === $("#eA", s).value); const fecha = $("#eF", s).value;
      const t = tipo === "prenez" ? res : tipo;
      const o = { id: uid(), arete: a.arete, tipo: t, fecha, nota: [$("#eC", s)?.value.trim(), $("#eN", s).value.trim()].filter(Boolean).join(" · ") };
      const p = $("#eP", s); if (p && p.value.trim()) o.producto = p.value.trim();
      if (esTrat) { const r = pint($("#eR", s).value); if (r != null) { o.retiroDias = r; o.retiroHasta = add(fecha, r); } }
      guardarYcerrar(async () => { await save("eventos", o); if (t === "secado") await save("animales", { ...a, estado: "seca" }); },
        esTrat && o.retiroHasta ? `Guardado. Leche en retiro hasta el ${fmt(o.retiroHasta)}` : "Guardado");
    };
  });
}

function formObs(arete) {
  if (!activos().length) return faltanAnimales();
  sheet(cab("Observación") + `
    <form id="fO" class="stack">
      <label class="f">Animal<select id="oA">${opts(activos(), arete)}</select></label>
      <div><span class="small muted" style="font-weight:700">¿Qué vio?</span><div class="opciones" style="margin-top:6px">${OBS.map((o, i) => `<button type="button" class="chipbtn" data-o="${esc(o)}" aria-pressed="${i === 0}">${esc(o)}</button>`).join("")}</div></div>
      <label class="f">Detalle (opcional)<input id="oN" placeholder="Ej. cuarto trasero derecho"></label>
      <button class="btn" type="submit">Guardar</button>
    </form>`, (s) => {
    let sel = OBS[0];
    $$("[data-o]", s).forEach((b) => (b.onclick = () => { sel = b.dataset.o; $$("[data-o]", s).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $("#fO", s).onsubmit = (ev) => { ev.preventDefault();
      const a = $("#oA", s).value;
      const o = sel === "Celo" ? { id: uid(), arete: a, tipo: "celo", fecha: hoy(), nota: $("#oN", s).value.trim() } : { id: uid(), arete: a, tipo: "obs", obs: sel, fecha: hoy(), nota: $("#oN", s).value.trim() };
      guardarYcerrar(() => save("eventos", o), "Observación guardada");
    };
  });
}

function formCalidad() {
  sheet(cab("Análisis de calidad") + `
    <form id="fC" class="grid2">
      <label class="f full">Fecha del análisis<input type="date" id="cF" value="${hoy()}" required></label>
      <label class="f">Grasa %<input id="cG" inputmode="decimal" placeholder="3,50"></label>
      <label class="f">Proteína %<input id="cP" inputmode="decimal" placeholder="3,10"></label>
      <label class="f">Sólidos totales %<input id="cS" inputmode="decimal" placeholder="12,20"></label>
      <label class="f">Células somáticas<input id="cC" inputmode="numeric" placeholder="250000"></label>
      <label class="f full">Bacterias (UFC)<input id="cU" inputmode="numeric" placeholder="80000"></label>
      <button class="btn full" type="submit">Guardar</button>
    </form>`, (s) => {
    $("#fC", s).onsubmit = (ev) => { ev.preventDefault();
      guardarYcerrar(() => save("calidad", { id: uid(), fecha: $("#cF", s).value, grasa: pn($("#cG", s).value), proteina: pn($("#cP", s).value), solidos: pn($("#cS", s).value), ccs: pint($("#cC", s).value), ufc: pint($("#cU", s).value) }), "Análisis guardado");
    };
  });
}

function detalle(arete) {
  const an = S.animales.find((a) => a.arete === arete); if (!an) return;
  const c = ciclo(an); const ev = evDe(arete).reverse(); const crias = S.animales.filter((a) => a.madre === arete);
  const r = retiro(arete);
  const hembraAdulta = an.sexo !== "M" && !["ternera"].includes(an.estado);
  sheet(`<div class="row spread"><div class="row" style="gap:8px"><span class="tag">${esc(an.arete)}</span><h2>${esc(an.nombre || "Sin nombre")}</h2></div><button class="btn ghost sm" data-close type="button">Cerrar</button></div>
    <div>${chips(an, c)}</div>
    ${r ? `<div class="alerta bad"><span class="quien">Leche en retiro</span><span>No entregar hasta el ${fmt(r.retiroHasta)} inclusive${r.producto ? " · " + esc(r.producto) : ""}.</span></div>` : ""}
    <div class="facts small muted"><div>Raza<b>${esc(an.raza || "–")}</b></div><div>Edad<b>${edadTxt(an.nacimiento)}</b></div><div>Madre<b>${esc(an.madre || "–")}</b></div>
      <div>Partos<b>${c.nPartos}</b></div><div>Días parida<b>${c.del ?? "–"}</b></div><div>Parto prob.<b>${fmt(c.fpp)}</b></div></div>
    ${an.estado === "lactancia" ? `<div><span class="small muted" style="font-weight:700">¿Cómo está dando leche?</span><div class="opciones" style="margin-top:6px">${["alta", "media", "baja"].map((n) => `<button type="button" class="chipbtn" data-n="${n}" aria-pressed="${an.nivel === n}">${n[0].toUpperCase() + n.slice(1)}</button>`).join("")}</div></div>` : ""}
    ${crias.length ? `<div class="small"><span class="eyebrow">Crías</span><br>${crias.map((x) => `<span class="tag">${esc(x.arete)}</span> ${esc(x.nombre || "")}`).join(" · ")}</div>` : ""}
    <div class="acciones">
      <button class="accion" type="button" data-x="obs"><b>Observación</b></button>
      <button class="accion" type="button" data-x="tratamiento"><b>Tratamiento</b></button>
      ${hembraAdulta ? `<button class="accion" type="button" data-x="servicio"><b>Servicio</b></button><button class="accion" type="button" data-x="prenez"><b>Diagnóstico</b></button><button class="accion" type="button" data-x="nac"><b>Parto</b></button>` : ""}
      ${an.estado === "lactancia" ? `<button class="accion" type="button" data-x="secado"><b>Secar</b></button>` : ""}
    </div>
    <div><span class="eyebrow">Historial</span><div class="timeline" style="margin-top:8px">${ev.length ? ev.map((e) => `<div><span class="small muted">${fmt(e.fecha)}</span> · <b>${esc(e.tipo === "obs" ? e.obs : TIPOS[e.tipo] || e.tipo)}</b>${e.cria ? ` (cría ${esc(e.cria)})` : ""}${e.producto ? " · " + esc(e.producto) : ""}${e.retiroHasta ? ` · retiro hasta ${fmt(e.retiroHasta)}` : ""}${e.nota ? `<br><span class="small muted">${esc(e.nota)}</span>` : ""}</div>`).join("") : '<div class="muted">Sin registros.</div>'}</div></div>
    <div class="row"><button class="btn ghost sm" type="button" data-x="editar">Editar datos</button><button class="btn ghost sm" type="button" data-x="vender">Marcar vendida</button><button class="btn ghost sm" type="button" data-x="borrar">Eliminar</button></div>`,
  (s) => {
    $$("[data-n]", s).forEach((b) => (b.onclick = async () => { await save("animales", { ...an, nivel: b.dataset.n }); toast("Producción actualizada"); render(); detalle(arete); }));
    $$("[data-x]", s).forEach((b) => (b.onclick = function () {
      const x = b.dataset.x;
      if (x === "editar") formAnimal(an);
      else if (x === "vender") guardarYcerrar(() => save("animales", { ...an, estado: "vendida" }), "Marcada como vendida");
      else if (x === "borrar") confirmar(this, "Toque otra vez para eliminar", () => guardarYcerrar(() => del("animales", an.id), "Res eliminada"));
      else abrir(x, arete);
    }));
  });
}

/* ---------- exportar y copias ---------- */
function descargar(nombre, blob) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportarExcel() {
  if (!window.XLSX) return toast("No se pudo preparar el Excel. Recargue la app.");
  const wb = XLSX.utils.book_new();
  const hoja = (nombre, filas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ "Sin datos": "" }]), nombre);
  hoja("Hato", [...S.animales].sort(porArete).map((a) => { const c = ciclo(a); return { "Número": a.arete, "Nombre": a.nombre, "Raza": a.raza, "Sexo": a.sexo === "M" ? "Macho" : "Hembra", "Nacimiento": a.nacimiento, "Estado": ESTADOS[a.estado], "Madre": a.madre, "Producción": a.nivel || "", "Partos": c.nPartos, "Último parto": c.ultParto || "", "Preñada": c.prenada ? "Sí" : "No", "Parto probable": c.fpp || "" }; }));
  hoja("Leche", entregasOrden().map((e) => ({ "Fecha": e.fecha, "Mañana (L)": e.am, "Tarde (L)": e.pm, "Total (L)": e.litros, "Nota": e.nota || "" })));
  hoja("Registros", [...S.eventos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((e) => ({ "Fecha": e.fecha, "Animal": e.arete, "Tipo": e.tipo === "obs" ? "Observación: " + e.obs : TIPOS[e.tipo] || e.tipo, "Producto": e.producto || "", "Retiro hasta": e.retiroHasta || "", "Cría": e.cria || "", "Nota": e.nota || "" })));
  hoja("Calidad", [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((q) => ({ "Fecha": q.fecha, "Grasa %": q.grasa, "Proteína %": q.proteina, "Sólidos %": q.solidos, "Células somáticas": q.ccs, "UFC": q.ufc })));
  XLSX.writeFile(wb, `Hato Claro ${cfg().nombre || "finca"} ${hoy()}.xlsx`);
}
function backup() {
  const data = { app: "hato-claro", version: APP_VERSION, fecha: new Date().toISOString(), datos: Object.fromEntries(COLS.map((c) => [c, S[c]])) };
  descargar(`copia-hato-claro-${hoy()}.json`, new Blob([JSON.stringify(data)], { type: "application/json" }));
  toast("Copia descargada. Guárdela en un lugar seguro.");
}
function restaurar(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let d; try { d = JSON.parse(r.result); } catch (e) { return toast("Ese archivo no es una copia de Hato Claro"); }
    if (!d || d.app !== "hato-claro" || !d.datos) return toast("Ese archivo no es una copia de Hato Claro");
    sheet(cab("Restaurar copia") + `<p>Copia del ${esc(new Date(d.fecha).toLocaleDateString("es-CO"))} con ${(d.datos.animales || []).length} animales y ${(d.datos.entregas || []).length} entregas.</p><p class="muted">Lo que hay ahora en este celular se reemplaza por la copia.</p><button class="btn danger" type="button" id="rOk">Reemplazar mis datos</button>`,
      (s) => ($("#rOk", s).onclick = () => guardarYcerrar(async () => { await vaciarTodo(); for (const c of COLS) for (const o of d.datos[c] || []) if (o && o.id) await save(c, o); }, "Copia restaurada")));
  };
  r.readAsText(file);
}

/* ---------- datos de ejemplo (fechas relativas a hoy) ---------- */
async function cargarEjemplo() {
  const h = hoy(), d = (n) => add(h, n), E = { ejemplo: true };
  const animales = [
    ["101", "Lucero", "Holstein", "2020-03-14", "lactancia", "", "alta"], ["102", "Canela", "Normando", "2019-07-02", "lactancia", "", "alta"],
    ["103", "Mariposa", "Jersey", "2021-01-20", "lactancia", "", "media"], ["104", "Paloma", "Holstein", "2018-10-05", "lactancia", "", "baja"],
    ["105", "Estrella", "Cruce", "2021-09-11", "lactancia", "", "media"], ["106", "Negra", "Normando", "2019-02-27", "seca", "", ""],
    ["201", "Princesa", "Holstein", "2024-12-03", "novilla", "104", ""], ["301", "Nube", "Holstein × Normando", d(-44), "ternera", "102", ""]];
  for (const [arete, nombre, raza, nac, estado, madre, nivel] of animales) await save("animales", { id: arete, arete, nombre, raza, sexo: "H", nacimiento: nac, estado, madre, origen: "nacida", nivel, ...E });
  const ev = [["101", "parto", -110], ["101", "servicio", -59, "Pajilla Holstein"], ["101", "prenez", -23, "Ecografía"], ["102", "parto", -44, "Parto normal", "301"],
    ["103", "parto", -189], ["103", "servicio", -146, "Toro Jersey"], ["103", "prenez", -110], ["104", "parto", -332], ["104", "servicio", -269, "Pajilla Holstein"], ["104", "prenez", -230, "Palpación"],
    ["105", "parto", -85], ["105", "servicio", -21, "Pajilla Gyr"], ["106", "parto", -402], ["106", "servicio", -245], ["106", "prenez", -207], ["106", "secado", -28], ["102", "vacuna", -8, "", "", "Aftosa"]];
  let i = 0;
  for (const [arete, tipo, off, nota, cria, producto] of ev) { const o = { id: "ej" + i++, arete, tipo, fecha: d(off), nota: nota || "", ...E }; if (cria) o.cria = cria; if (producto) o.producto = producto; await save("eventos", o); }
  await save("eventos", { id: "ej-t1", arete: "103", tipo: "tratamiento", fecha: d(-1), producto: "Antibiótico intramamario", retiroDias: 4, retiroHasta: d(3), nota: "Mastitis cuarto delantero", ...E });
  await save("eventos", { id: "ej-o1", arete: "105", tipo: "obs", obs: "Bajó la leche", fecha: d(0), nota: "", ...E });
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let k = 1; k <= 28; k++) { const base = 96 + (rnd() - 0.5) * 8 - (k <= 2 ? 6 : 0); const am = Math.round(base * 0.56), pm = Math.round(base - am); await save("entregas", { id: d(-k), fecha: d(-k), am, pm, litros: am + pm, nota: "", ...E }); }
  const cal = [[-28, 3.6, 3.15, 12.3, 280000, 60000], [-14, 3.5, 3.1, 12.1, 350000, 90000], [-2, 3.55, 3.12, 12.2, 430000, 70000]];
  for (const [off, grasa, proteina, solidos, ccs, ufc] of cal) await save("calidad", { id: "ejq" + off, fecha: d(off), grasa, proteina, solidos, ccs, ufc, ...E });
  if (!cfg().precioLitro) await save("config", { ...cfg(), precioLitro: 1850 });
}

/* ---------- arranque ---------- */
function registrarSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    const mostrar = (w) => { $("#avisoUpdate").hidden = false; $("#btnUpdate").onclick = () => w.postMessage("ACTUALIZAR"); };
    if (reg.waiting && navigator.serviceWorker.controller) mostrar(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) mostrar(w); }); });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (recargando) return; recargando = true; location.reload(); });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); instalarEvt = e; if (vista === "mas") render(); });

$$(".tabbar button").forEach((b) => (b.onclick = () => setVista(b.dataset.v)));
$("#fab").onclick = menuRegistrar;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });

(async () => {
  await cargar();
  setVista("inicio");
  registrarSW();
})();
})();
