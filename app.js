/* Hato Claro — app para fincas lecheras.
   Todo se guarda en el celular (IndexedDB) y funciona sin señal. */
(function () {
"use strict";

const APP_VERSION = "2.0.0";
const GEST = 283, SECADO = 60, ESPERA = 45;
const COLS = ["animales", "eventos", "entregas", "calidad", "liquidaciones", "gastos", "potreros", "ocupaciones", "config"];
const S = { animales: [], eventos: [], entregas: [], calidad: [], liquidaciones: [], gastos: [], potreros: [], ocupaciones: [], config: [] };
const CONFIG_LOCAL = ["mercado", "avisos", "avisosVistos", "nube"]; // nunca se sincronizan
let vista = "inicio", subHato = "animales", filtroHato = "", buscaHato = "", memOnly = false, instalarEvt = null;

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
const pesos = (n) => n == null || isNaN(n) ? "–" : (n < -0.5 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-CO");
const pn = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? null : n; };
const pint = (v) => { if (v == null || String(v).trim() === "") return null; const n = parseInt(String(v).replace(/[.\s]/g, ""), 10); return isNaN(n) ? null : n; };
const slug = (s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const porArete = (a, b) => a.arete.localeCompare(b.arete, "es", { numeric: true });

const TIPOS = {
  parto: "Parto", servicio: "Servicio / inseminación", prenez: "Preñez confirmada", vacia: "Diagnóstico: vacía",
  celo: "Celo observado", secado: "Secado", tratamiento: "Tratamiento", vacuna: "Vacuna / desparasitación", obs: "Observación", peso: "Pesaje", venta: "Venta", salud: "Revisión de síntomas"
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
    const r = indexedDB.open("hato-claro", 3);
    r.onupgradeneeded = () => { const db = r.result; [...COLS, "cola"].forEach((c) => { if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: "id" }); }); };
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
const sincroniza = (col, id) => !(col === "config" && CONFIG_LOCAL.includes(id));
async function encolar(col, id, borrado) {
  if (memOnly || !nubeActiva() || !sincroniza(col, id)) return;
  await tx("cola", "readwrite", (st) => st.put({ id: col + "|" + id, col, docId: id, borrado: !!borrado }));
  programarSync();
}
async function save(col, obj, opt = {}) {
  const i = S[col].findIndex((x) => x.id === obj.id);
  i >= 0 ? (S[col][i] = obj) : S[col].push(obj);
  if (!memOnly) await tx(col, "readwrite", (st) => st.put(obj));
  if (!opt.remoto) await encolar(col, obj.id, false);
}
async function del(col, id, opt = {}) {
  S[col] = S[col].filter((x) => x.id !== id);
  if (!memOnly) await tx(col, "readwrite", (st) => st.delete(id));
  if (!opt.remoto) await encolar(col, id, true);
}
async function vaciarTodo(conservar = []) {
  for (const c of COLS) {
    const keep = c === "config" ? S.config.filter((x) => conservar.includes(x.id)) : [];
    S[c] = keep;
    if (!memOnly) await tx(c, "readwrite", (st) => { st.clear(); keep.forEach((x) => st.put(x)); });
  }
  if (!memOnly) await tx("cola", "readwrite", (st) => st.clear());
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
  const fin = ult ? ult.fecha : hoy();
  const sem = e.filter((x) => x.fecha > add(fin, -7) && x.fecha <= fin);
  const litrosDia = sem.length ? sem.reduce((s, x) => s + x.litros, 0) / 7 : null;
  return { ult, prom7, totMes, diasMes: delMes.length, litrosDia };
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
      const vac = S.eventos.filter((e) => e.arete === an.arete && e.tipo === "vacia" && c.ultServ && e.fecha >= c.ultServ.fecha).pop();
      if (vac) out.push({ k: "", o: 5, h: `${nom}<span>Diagnosticada vacía el ${fmt(vac.fecha)}. Esté pendiente del celo para volver a servirla.</span>` });
      else if (c.ultServ && c.ultServ.fecha > c.ultParto) {
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
  candidatasDescarte().forEach(({ an, d }) => out.push({ k: "", o: 9, h: `<span class="quien">${esc(an.arete)}${an.nombre ? " · " + esc(an.nombre) : ""} · candidata a descarte</span><span>${esc(capital(d.motivos.join(", ")))}.${d.valor && d.valor.descarte ? ` Como descarte vale cerca de ${pesos(d.valor.descarte.valor)}${d.valor.descarte.tope ? " (tope)" : ""}.` : ""}</span>` }));
  const t = tendenciaGordo();
  if (t && t.pct >= 3) out.push({ k: "info", o: 10, h: `<span class="quien">Buen precio del ganado</span><span>El ganado gordo en ${esc(t.reg)} va en ${pesos(t.ult[t.reg])} por kilo, ${nf(t.pct, 1)}% por encima de los últimos 3 meses. Buen momento si piensa vender.</span>` });
  const q = [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0];
  if (q) {
    if (q.ccs > 400000) out.push({ k: "bad", o: 8, h: `<span class="quien">Calidad</span><span>Células somáticas en ${nf(q.ccs)} el ${fmt(q.fecha)}. Señal de mastitis en el hato.</span>` });
    if (q.ufc > 200000) out.push({ k: "bad", o: 8, h: `<span class="quien">Calidad</span><span>Bacterias (UFC) en ${nf(q.ufc)} el ${fmt(q.fecha)}. Revise lavado del equipo y enfriamiento.</span>` });
  }
  out.push(...alertasPotreros());
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
  const tPlata = $('.tabbar [data-v="plata"]'); if (tPlata) tPlata.hidden = !puedeVerPlata();
  if (vista === "plata" && !puedeVerPlata()) vista = "inicio";
  ({ inicio: vInicio, hato: vHato, leche: vLeche, potreros: vPotreros, plata: vPlata, mas: vMas })[vista]();
  clearTimeout(render.t); render.t = setTimeout(() => guardarAvisos().catch(() => {}), 1500);
}
function setVista(v) {
  vista = v;
  $$(".tabbar button").forEach((b) => (b.dataset.v === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  const bm = $("#btnMas"); if (bm) bm.setAttribute("aria-pressed", v === "mas");
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
      <button class="btn ghost block" id="wPDF" type="button">Empezar cargando la liquidación de Colanta</button>
      <button class="btn ghost block" id="wEjemplo" type="button">Ver primero con datos de ejemplo</button>
    </div>`;
    $("#wEmpezar").onclick = async () => { await save("config", { ...cfg(), nombre: $("#wNombre").value.trim() }); formAnimal(); };
    $("#wPDF").onclick = async () => { if ($("#wNombre").value.trim()) await save("config", { ...cfg(), nombre: $("#wNombre").value.trim() }); pedirPDF(); };
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
      <div class="kpi"><span class="eyebrow">Vacas en ordeño</span><b>${lact.length}</b><span class="small muted">${L.litrosDia && lact.length ? nf(L.litrosDia / lact.length, 1) + " L por vaca al día" : "&nbsp;"}</span></div>
      <div class="kpi"><span class="eyebrow">Preñadas</span><b>${adultas.length ? Math.round((pren.length / adultas.length) * 100) + "%" : "–"}</b><span class="small muted">${pren.length} de ${adultas.length} vacas</span></div>
      <div class="kpi"><span class="eyebrow">Leche del mes</span><b>${nf(L.totMes)} L</b><span class="small muted">${L.litrosDia ? nf(L.litrosDia) + " L por día" : "&nbsp;"}</span></div>
      ${puedeVerPlata() ? `<div class="kpi"><span class="eyebrow">Ingreso estimado</span><b>${precio ? pesos(L.totMes * precio) : "–"}</b><span class="small muted">${precio ? "a " + pesos(precio) + " por litro" : `<button class="btn ghost sm" id="qPrecio" type="button">Poner precio</button>`}</span></div>` : ""}
    </div>
    <div class="stack">
      <div class="row spread"><h2>Para atender</h2><span class="small muted">${al.length ? al.length + " pendientes" : ""}</span></div>
      <div class="alertas">${al.length ? al.map((a) => `<div class="alerta ${a.k}">${a.h}</div>`).join("") : `<div class="empty">Todo al día. Aquí aparecerán secados, partos próximos, retiros de leche y vacas por revisar.</div>`}</div>
    </div>
    <div class="stack">
      <h2>Registro rápido</h2>
      <div class="acciones">
        <button class="accion" data-q="entrega" type="button"><b>Leche entregada</b><span class="small muted">Litros del día</span></button>
        <button class="accion" data-q="pdf" type="button"><b>Liquidación Colanta</b><span class="small muted">Cargar el PDF</span></button>
        <button class="accion" data-q="obs" type="button"><b>Observación</b><span class="small muted">Bajó leche, ubre, cojera</span></button>
        <button class="accion" data-q="tratamiento" type="button"><b>Tratamiento</b><span class="small muted">Con días de retiro</span></button>
        <button class="accion" data-q="nac" type="button"><b>Nacimiento</b><span class="small muted">Parto y cría</span></button>
        <button class="accion" data-q="servicio" type="button"><b>Servicio</b><span class="small muted">Monta o inseminación</span></button>
        <button class="accion" data-q="sintomas" type="button"><b>Animal enfermo</b><span class="small muted">Revisar síntomas</span></button>
        ${puedeVerPlata() ? `<button class="accion" data-q="gasto" type="button"><b>Gasto</b><span class="small muted">Compras y pagos</span></button>` : `<button class="accion" data-q="mover" type="button"><b>Mover ganado</b><span class="small muted">Cambio de potrero</span></button>`}
      </div>
      <button class="btn ghost block" type="button" id="qVoz">🎙 Registrar hablando</button>
    </div>`;
  const q = $("#qEntrega"); if (q) q.onclick = () => formEntrega();
  const qp = $("#qPrecio"); if (qp) qp.onclick = () => setVista("mas");
  const qv = $("#qVoz"); if (qv) qv.onclick = abrirVoz;
  $$("[data-q]", el).forEach((b) => (b.onclick = () => abrir(b.dataset.q)));
}
function abrir(q, arete) {
  ({ entrega: () => formEntrega(), obs: () => formObs(arete), tratamiento: () => formEvento("tratamiento", arete), nac: () => formNacimiento(arete),
     servicio: () => formEvento("servicio", arete), prenez: () => formEvento("prenez", arete), evento: () => formEvento("celo", arete),
     animal: () => formAnimal(), calidad: () => formCalidad(), pdf: () => pedirPDF(), secado: () => formEvento("secado", arete), vacuna: () => formEvento("vacuna", arete),
     gasto: () => formGasto(), sintomas: () => formSintomas(arete), mover: () => moverGanado(), potrero: () => formPotrero(), voz: () => abrirVoz() })[q]();
}

function vHato() {
  const el = $("#v-hato");
  const SUBS = [["animales", "Animales"], ["ciclos", "Ciclos"], ["salud", "Salud"]];
  el.innerHTML = `<div class="seg" role="tablist">${SUBS.map(([k, v]) => `<button type="button" role="tab" data-sub="${k}" aria-selected="${subHato === k}">${v}</button>`).join("")}</div><div id="hCont" class="vista"></div>`;
  $$("[data-sub]", el).forEach((b) => (b.onclick = () => { subHato = b.dataset.sub; vHato(); }));
  const cont = $("#hCont", el);
  if (subHato === "ciclos") return vCiclos(cont);
  if (subHato === "salud") return vSalud(cont);
  const filtros = [["", "Todos"], ["lactancia", "En ordeño"], ["seca", "Secas"], ["novilla", "Novillas"], ["ternera", "Terneras/os"], ["toro", "Toros"], ["vendida", "Vendidas"]];
  cont.innerHTML = `
    <div class="row spread"><h2>Hato · ${S.animales.filter((a) => a.estado !== "vendida").length} animales</h2><button class="btn sm" id="hNuevo" type="button">+ Nueva res</button></div>
    ${S.animales.length && puedeVerPlata() ? panelMercado() : ""}
    <input type="search" id="hBusca" placeholder="Buscar por número o nombre" value="${esc(buscaHato)}" autocomplete="off" aria-label="Buscar animal">
    <div class="chips">${filtros.map(([k, v]) => `<button class="chipbtn" type="button" data-f="${k}" aria-pressed="${filtroHato === k}">${v}</button>`).join("")}</div>
    <div class="lista" id="hLista"></div>`;
  const pintarLista = () => {
    const t = buscaHato.trim().toLowerCase();
    const lista = S.animales.filter((a) => (filtroHato ? a.estado === filtroHato : a.estado !== "vendida") && (!t || a.arete.toLowerCase().includes(t) || (a.nombre || "").toLowerCase().includes(t))).sort(porArete);
    $("#hLista", cont).innerHTML = lista.length ? lista.map((an) => {
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
    }).join("") : `<div class="empty">${t ? "Ningún animal coincide con la búsqueda." : `No hay animales ${filtroHato ? "en este grupo" : "todavía"}.<button class="btn" type="button" id="hNuevo2">Agregar la primera res</button>`}</div>`;
    $$("#hLista .card", cont).forEach((b) => (b.onclick = () => detalle(b.dataset.a)));
    const n2 = $("#hNuevo2", cont); if (n2) n2.onclick = () => formAnimal();
  };
  pintarLista();
  $("#hBusca", cont).oninput = (e) => { buscaHato = e.target.value; pintarLista(); };
  $("#hNuevo", cont).onclick = () => formAnimal();
  const hp = $("#hPrecios", cont); if (hp) hp.onclick = formPrecios;
  $$("[data-f]", cont).forEach((b) => (b.onclick = () => { filtroHato = b.dataset.f; vHato(); }));
  $$(".panel .card[data-a]", cont).forEach((b) => (b.onclick = () => detalle(b.dataset.a)));
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
  const liqs = [...S.liquidaciones].sort((a, b) => (a.hasta < b.hasta ? 1 : -1));
  const lq = liqs[0];
  const bar = (v, lo, hi, color) => `<div class="qbar"><i style="width:${Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%;background:var(${color})"></i></div>`;
  const param = (nombre, v, unidad, dec, lo, hi, color) => v == null ? "" : `<div>${nombre} <b class="num">${nf(v, dec)}${unidad}</b>${bar(v, lo, hi, color)}</div>`;
  const conc = lq && lq.compras ? lq.compras.find((c) => /CONCENTRADO/i.test(c.grupo)) : null;
  const hayGP = q.some((r) => r.grasa != null || r.proteina != null);
  el.innerHTML = `
    <div class="row spread"><h2>Leche entregada</h2><button class="btn sm" id="lNueva" type="button">+ Registrar</button></div>
    ${puedeVerPlata() ? `<button class="btn ghost block" id="lPDF" type="button">Cargar liquidación de Colanta (PDF)</button>` : ""}
    <div class="kpis">
      <div class="kpi"><span class="eyebrow">Este mes</span><b>${nf(L.totMes)} L</b><span class="small muted">${L.litrosDia ? nf(L.litrosDia) + " L por día" : "&nbsp;"}</span></div>
      <div class="kpi"${puedeVerPlata() ? "" : " hidden"}><span class="eyebrow">Ingreso estimado</span><b>${precio ? pesos(L.totMes * precio) : "–"}</b><span class="small muted">${precio ? "a " + pesos(precio) + "/L" : "Ponga el precio en Más"}</span></div>
    </div>
    ${lq && puedeVerPlata() ? `<div class="panel stack">
      <div class="row spread"><h3>Liquidación semana ${lq.semana ?? ""}</h3><span class="small muted">${fmt(lq.desde)} al ${fmt(lq.hasta)}</span></div>
      <div class="kpis">
        <div class="kpi"><span class="eyebrow">Litros</span><b>${nf(lq.litros)}</b><span class="small muted">${nf(lq.litros / 7)} L por día</span></div>
        <div class="kpi"><span class="eyebrow">Neto a pagar</span><b>${pesos(lq.neto)}</b><span class="small muted">pago ${fmt(lq.fechaLiquidacion)}</span></div>
      </div>
      <div class="tablewrap"><table>
        <tr><th>Concepto</th><th class="r">$ por litro</th><th class="r">Total</th></tr>
        ${lq.precioBase != null ? `<tr><td>Precio base por sólidos</td><td class="r">${pesos(lq.precioBase)}</td><td class="r">${pesos(lq.ingresoBase)}</td></tr>` : ""}
        ${(lq.bonificaciones || []).map((b) => `<tr><td>${esc(capital(b.concepto))}</td><td class="r">+${pesos(b.porLitro)}</td><td class="r">${pesos(b.total)}</td></tr>`).join("")}
        <tr><td><b>Precio por litro</b></td><td class="r"><b>${pesos(lq.precioLitro)}</b></td><td class="r">${pesos(lq.ingresoBruto)}</td></tr>
        ${lq.fleteLitro != null ? `<tr><td>Flete</td><td class="r">−${pesos(lq.fleteLitro)}</td><td class="r">−${pesos(lq.flete)}</td></tr>` : ""}
        <tr><td><b>Pagado por litro</b></td><td class="r"><b>${pesos(lq.precioPagado)}</b></td><td class="r"><b>${pesos(lq.ingresoLeche)}</b></td></tr>
        ${(lq.deducciones || []).map((d) => `<tr><td>${esc(capital(d.concepto))}</td><td></td><td class="r">−${pesos(d.valor)}</td></tr>`).join("")}
        <tr><td><b>Neto a pagar</b></td><td></td><td class="r"><b>${pesos(lq.neto)}</b></td></tr>
      </table></div>
      ${conc ? `<div class="alerta info"><span class="quien">Compras en Agrocolanta esta semana</span><span>Concentrado y sales: ${nf(conc.kg)} kg por ${pesos(conc.valor)}, el ${nf((conc.valor / lq.ingresoLeche) * 100)}% de lo que le pagaron por la leche (${pesos(conc.valor / lq.litros)} por litro). Son compras de la semana, no necesariamente lo que comieron.</span></div>` : ""}
      <button class="btn ghost" type="button" id="lSim">¿Cuánto más le pagarían? Simular</button>
      ${liqs.length > 1 ? `<div><span class="eyebrow">Semanas anteriores</span><div class="tablewrap"><table><tr><th>Semana</th><th class="r">Litros</th><th class="r">$/L pagado</th><th class="r">Neto</th></tr>${liqs.map((x) => `<tr><td>${x.semana ?? ""} · ${fmt(x.hasta)}</td><td class="r">${nf(x.litros)}</td><td class="r">${pesos(x.precioPagado)}</td><td class="r">${pesos(x.neto)}</td></tr>`).join("")}</table></div></div>` : ""}
    </div>` : ""}
    <div class="panel"><div class="row spread"><h3>Últimos 30 días</h3><span class="small muted">litros por día de entrega</span></div>
      <div class="chart">${vals.some((v) => v != null) ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Litros entregados por día">${svg}</svg>` : `<div class="empty">Aún no hay entregas en los últimos 30 días.</div>`}</div></div>
    <div class="panel"><h3>Entregas recientes</h3>
      ${rec.length ? `<div class="tablewrap"><table><tr><th>Fecha</th><th class="r">Mañana</th><th class="r">Tarde</th><th class="r">Total</th><th class="r">°C</th><th></th></tr>${rec.map((e) => `<tr><td>${fmt(e.fecha)}${e.fuente === "colanta" ? ' <span class="chip">Colanta</span>' : ""}</td><td class="r">${e.am != null ? nf(e.am) : "–"}</td><td class="r">${e.pm != null ? nf(e.pm) : "–"}</td><td class="r"><b>${nf(e.litros)}</b></td><td class="r">${e.temp != null ? nf(e.temp, 1) : "–"}</td><td><button class="btn ghost sm" type="button" data-e="${e.id}">Editar</button></td></tr>`).join("")}</table></div>` : `<p class="muted small" style="margin-top:8px">Sin entregas registradas.</p>`}
    </div>
    <div class="row spread"><h2>Calidad de la leche</h2><button class="btn ghost sm" id="lCal" type="button">+ Análisis</button></div>
    ${u ? `<div class="panel"><span class="eyebrow">Último análisis · ${u.semana ? "semana " + u.semana + " · " : ""}${fmt(u.fecha)}</span>
      <div class="grid2" style="margin-top:10px">
        ${param("Sólidos totales", u.solidos, " %", 2, 11, 14, "--milk")}
        ${param("Grasa", u.grasa, " %", 2, 2.5, 5, "--milk")}
        ${param("Proteína", u.proteina, " %", 2, 2.5, 4, "--milk")}
        ${param("Células somáticas", u.ccs, "", 0, 0, 800000, u.ccs > 400000 ? "--bad" : "--ok")}
        ${param("Bacterias (UFC)", u.ufc, "", 0, 0, 400000, u.ufc > 200000 ? "--bad" : "--ok")}
        ${param("Urea (MUN)", u.mun, " mg/dl", 1, 0, 25, "--milk")}
      </div></div>
      <div class="panel"><div class="tablewrap"><table><tr><th>Semana</th><th class="r">Sólidos %</th>${hayGP ? '<th class="r">Grasa</th><th class="r">Proteína</th>' : ""}<th class="r">Células</th><th class="r">UFC</th><th class="r">MUN</th></tr>${q.map((r) => `<tr><td>${r.semana ? r.semana + " · " : ""}${fmt(r.fecha)}</td><td class="r">${nf(r.solidos, 2)}</td>${hayGP ? `<td class="r">${nf(r.grasa, 2)}</td><td class="r">${nf(r.proteina, 2)}</td>` : ""}<td class="r" style="color:${r.ccs > 400000 ? "var(--bad)" : "inherit"}">${nf(r.ccs)}</td><td class="r" style="color:${r.ufc > 200000 ? "var(--bad)" : "inherit"}">${nf(r.ufc)}</td><td class="r">${nf(r.mun, 1)}</td></tr>`).join("")}</table></div></div>`
    : `<div class="empty">Cargue la liquidación de Colanta o escriba los resultados del laboratorio.</div>`}
    <p class="small muted">Alertas de calidad: células somáticas sobre 400.000 por mL y bacterias sobre 200.000 UFC por mL. Compárelas con la tabla de pago de su comprador.</p>`;
  $("#lNueva").onclick = () => formEntrega();
  const lp = $("#lPDF"); if (lp) lp.onclick = pedirPDF;
  const ls = $("#lSim"); if (ls) ls.onclick = formSimulador;
  $("#lCal").onclick = () => formCalidad();
  $$("[data-e]", el).forEach((b) => (b.onclick = () => formEntrega(S.entregas.find((x) => x.id === b.dataset.e))));
}

const capital = (t) => { const s = String(t || "").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/* ---------- liquidación de Colanta en PDF ---------- */
let pdfLib = null;
function cargarPdfjs() {
  if (pdfLib) return Promise.resolve(pdfLib);
  return new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "vendor/pdf.min.js";
    sc.onload = () => { pdfLib = window.pdfjsLib; pdfLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; res(pdfLib); };
    sc.onerror = () => rej(new Error("No se pudo cargar el lector de PDF"));
    document.head.appendChild(sc);
  });
}
function pedirPDF() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,.pdf"; inp.multiple = true;
  inp.onchange = () => leerPDFs([...inp.files]);
  inp.click();
}
async function textoPDF(file) {
  const lib = await cargarPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); pages.push(tc.items.map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))); }
  return pages;
}
async function leerPDFs(files) {
  if (!files.length) return;
  sheet(cab("Leyendo PDF…") + `<p class="muted">Un momento, estamos sacando los datos de ${files.length > 1 ? files.length + " archivos" : "la liquidación"}.</p>`);
  const ok = [], malos = [];
  for (const f of files) {
    try { const r = window.parseColanta(await textoPDF(f)); r && r.desde ? ok.push(r) : malos.push(f.name); }
    catch (e) { malos.push(f.name); }
  }
  if (!ok.length) return sheet(cab("No se pudo leer") + `<p>No reconocimos ${malos.length > 1 ? "estos archivos" : "este archivo"} como una liquidación semanal de Colanta.</p><p class="muted small">Si es una foto o un escaneo, todavía no lo podemos leer. Pida el PDF original que envía Colanta.</p>`);
  ok.sort((a, b) => (a.desde < b.desde ? -1 : 1));
  const reemplaza = ok.reduce((n, r) => n + r.recibos.filter((x) => S.entregas.some((e) => e.fecha === x.fecha && e.fuente !== "colanta")).length, 0);
  sheet(cab("Revise antes de guardar") + ok.map((r) => `<div class="panel stack">
      <h3>Semana ${r.semana ?? ""} · ${fmt(r.desde)} al ${fmt(r.hasta)}</h3>
      <div class="facts small muted"><div>Litros<b>${nf(r.litros)}</b></div><div>Recogidas<b>${r.recibos.length}</b></div><div>Pagado/L<b>${pesos(r.liquidacion.precioPagado)}</b></div>
        <div>Neto<b>${pesos(r.liquidacion.neto)}</b></div><div>Semanas de calidad<b>${r.calidad.length}</b></div><div>Células sem. ${r.calidad.length ? r.calidad[r.calidad.length - 1].semana : ""}<b>${r.calidad.length ? nf(r.calidad[r.calidad.length - 1].ccs) : "–"}</b></div></div>
    </div>`).join("") +
    (malos.length ? `<p class="small" style="color:var(--bad)">No se pudo leer: ${malos.map(esc).join(", ")}</p>` : "") +
    (reemplaza ? `<p class="small muted">${reemplaza} entregas que había escrito a mano se reemplazan por lo que midió Colanta.</p>` : "") +
    `<p class="small muted">No se guardan su nombre, cédula ni correo, solo los datos de la leche.</p>
    <button class="btn" type="button" id="pGuardar">Guardar ${ok.length > 1 ? ok.length + " semanas" : "liquidación"}</button>`,
  (s) => ($("#pGuardar", s).onclick = () => guardarYcerrar(async () => {
    for (const r of ok) await guardarLiquidacion(r);
    const ult = ok[ok.length - 1], c = cfg();
    await save("config", { ...c, comprador: c.comprador || "Colanta", precioLitro: ult.liquidacion.precioPagado ? Math.round(ult.liquidacion.precioPagado) : c.precioLitro, nombre: c.nombre || capitalPalabras(ult.predio) });
    vista = "leche"; setVista("leche");
  }, ok.length > 1 ? `${ok.length} semanas guardadas` : "Liquidación guardada")));
}
const capitalPalabras = (t) => String(t || "").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
async function guardarLiquidacion(r) {
  for (const x of r.recibos) await save("entregas", { id: x.fecha, fecha: x.fecha, am: null, pm: null, litros: x.litros, temp: x.temp, fuente: "colanta", nota: "Recibo Colanta" });
  for (const q of r.calidad) {
    const id = `colanta-${q.fecha}`;
    const viejo = S.calidad.find((c) => c.id === id);
    if (viejo && q.semana !== r.semana) continue; // semanas anteriores: no pisar lo que ya había
    await save("calidad", { id, fuente: "colanta", ...q });
  }
  const L = r.liquidacion;
  await save("liquidaciones", { id: `colanta-${r.anio}-${r.semana ?? r.hasta}`, comprador: "Colanta", semana: r.semana, anio: r.anio, desde: r.desde, hasta: r.hasta, fechaLiquidacion: r.fechaLiquidacion, litros: r.litros,
    precioBase: L.precioBase, ingresoBase: L.ingresoBase, bonificaciones: L.bonificaciones, precioLitro: L.precioLitro, ingresoBruto: L.ingresoBruto, fleteLitro: L.fleteLitro, flete: L.flete,
    precioPagado: L.precioPagado, ingresoLeche: L.ingresoLeche, deducciones: L.deducciones, totalDeducciones: L.totalDeducciones, neto: L.neto, compras: r.compras, stRef: L.stRef ?? null });
  if (r.coords && !cfg().lat) await save("config", { ...cfg(), lat: r.coords.lat, lng: r.coords.lng });
}

function vCiclos(el) {
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
    ${panelNube()}
    <div class="panel stack"><h2>Avisos en el celular</h2>
      <p class="muted" id="avEstado">Revisando…</p>
      <div class="row"><button class="btn" id="avActivar" type="button">Activar avisos</button><button class="btn ghost" id="avProbar" type="button" hidden>Probar un aviso</button></div>
    </div>
    <div class="panel stack"${puedeVerPlata() ? "" : " hidden"}><h2>Precios del ganado</h2>
      <p class="muted">${MERCADO ? `Referencia de Fedegán actualizada al ${fmt(MERCADO.actualizado)}. Ponga también lo que le pagan en su zona.` : "Se descargan de Fedegán cuando la app tiene señal."}</p>
      <button class="btn ghost" id="mPrecios" type="button">Ver y ajustar precios</button>
    </div>
    <div class="panel stack"><h2>Sus datos</h2>
      <p class="muted">${nubeActiva() ? "Sus datos están en este celular y en la nube." : "Los datos se guardan solo en este celular. Saque una copia de seguridad cada semana y guárdela en WhatsApp, Drive o el correo."}</p>
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
  enlazarNube(el);
  estadoAvisos().then((st) => {
    const t = $("#avEstado"); if (!t) return;
    const pr = $("#avProbar"), ac = $("#avActivar");
    if (!st.soporta) { t.textContent = "Este celular o navegador no permite avisos de la app."; ac.hidden = true; return; }
    if (st.permiso === "granted") {
      ac.hidden = !(st.periodico && !st.registrado); pr.hidden = false;
      t.textContent = st.registrado ? "Activados. El celular revisa una o dos veces al día y le avisa de partos, secados, retiros, celos y potreros listos, aunque no abra la app." : st.periodico ? "Permiso dado. Toque Activar avisos para que revise solo cada día." : "Permiso dado, pero este celular solo muestra los avisos cuando abre la app. En Android con la app instalada desde Chrome funcionan sin abrirla.";
    } else if (st.permiso === "denied") { t.textContent = "Los avisos están bloqueados. Actívelos en los ajustes del celular, en Notificaciones de Hato Claro."; ac.hidden = true; }
    else t.textContent = "Reciba en el celular los partos, secados, retiros de leche, celos por vigilar y potreros listos, aunque no abra la app.";
  });
  $("#avActivar").onclick = activarAvisos;
  $("#avProbar").onclick = probarAviso;
  $("#mExcel").onclick = exportarExcel;
  $("#mPrecios").onclick = formPrecios;
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
  const items = [["voz", "🎙 Registrar hablando"], ["entrega", "Leche entregada"], ["pdf", "Liquidación de Colanta (PDF)"], ...(puedeVerPlata() ? [["gasto", "Gasto"]] : []), ["sintomas", "Revisar síntomas"], ["mover", "Mover ganado de potrero"], ["obs", "Observación de una vaca"], ["tratamiento", "Tratamiento"], ["nac", "Nacimiento"], ["servicio", "Servicio o inseminación"], ["prenez", "Diagnóstico de preñez"], ["secado", "Secado"], ["vacuna", "Vacuna o desparasitación"], ["calidad", "Análisis de calidad"], ["animal", "Nueva res"]];
  sheet(cab("¿Qué quiere registrar?") + `<div class="acciones">${items.map(([k, v]) => `<button class="accion" type="button" data-go="${k}"><b>${v}</b></button>`).join("")}</div>`,
    (s) => $$("[data-go]", s).forEach((b) => (b.onclick = () => abrir(b.dataset.go))));
}

function formEntrega(e, pre = {}) {
  const x = e || pre;
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
      <label class="f full">Peso en kg (opcional; también puede medirlo con cinta desde la ficha)<input id="aPeso" inputmode="numeric" value="${e.peso ?? ""}"></label>
      <button class="btn full" type="submit">Guardar</button>
    </form>`, (s) => {
    if (an) $("#aParto", s).closest("label").hidden = true;
    $("#fA", s).onsubmit = (ev) => { ev.preventDefault();
      const arete = $("#aArete", s).value.trim(); if (!arete) return;
      const id = slug(arete);
      if (!an && S.animales.some((a) => a.id === id)) return toast("Ya existe una res con ese número");
      const data = { ...e, id, arete, nombre: $("#aNombre", s).value.trim(), raza: $("#aRaza", s).value.trim(), sexo: $("#aSexo", s).value, nacimiento: $("#aNac", s).value, estado: $("#aEstado", s).value, madre: $("#aMadre", s).value.trim(), origen: $("#aOrigen", s).value };
      const kg = pint($("#aPeso", s).value);
      if (kg && kg !== e.peso) Object.assign(data, { peso: kg, pesoFecha: hoy(), pesoMetodo: "bascula" });
      if (!kg) { delete data.peso; delete data.pesoFecha; delete data.pesoMetodo; }
      const parto = $("#aParto", s).value;
      guardarYcerrar(async () => { await save("animales", data); if (!an && parto) await save("eventos", { id: uid(), arete, tipo: "parto", fecha: parto, nota: "Registrado al ingresar la res" }); }, "Res guardada");
    };
  });
}

function formNacimiento(madre, pre = {}) {
  if (!hembras().length) return faltanAnimales();
  const selM = selectorAnimales(hembras(), { sel: madre ? [madre] : [] });
  sheet(cab("Nacimiento") + `<p class="muted small">Se registra el parto, la cría entra al hato y la madre pasa a ordeño.</p>
    <form id="fN" class="grid2">
      <div class="full"><span class="small muted" style="font-weight:700">Madre</span>${selM.html}</div>
      <label class="f">Fecha del parto<input type="date" id="nFecha" value="${hoy()}" max="${hoy()}" required></label>
      <label class="f">Número de la cría<input id="nArete" required autocomplete="off" value="${esc(pre.cria || "")}"></label>
      <label class="f">Nombre de la cría<input id="nNombre" autocomplete="off"></label>
      <label class="f">Sexo<select id="nSexo"><option value="H">Hembra</option><option value="M"${pre.sexo === "M" ? " selected" : ""}>Macho</option></select></label>
      <label class="f">Raza o padre<input id="nRaza" placeholder="Ej. Holstein × Jersey"></label>
      <label class="f full">Cómo fue el parto<input id="nNota" placeholder="Normal, asistido, retuvo placenta…"></label>
      <button class="btn full" type="submit">Guardar nacimiento</button>
    </form>`, (s) => {
    selM.init(s);
    $("#fN", s).onsubmit = (ev) => { ev.preventDefault();
      const m = S.animales.find((a) => a.arete === selM.get()[0]); if (!m) return toast("Elija la madre"); const arete = $("#nArete", s).value.trim();
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

function formEvento(tipo, arete, pre = {}) {
  if (!activos().length) return faltanAnimales();
  const esTrat = tipo === "tratamiento", multi = ["tratamiento", "vacuna"].includes(tipo);
  const titulo = { tratamiento: "Tratamiento", servicio: "Servicio o inseminación", prenez: "Diagnóstico de preñez", secado: "Secado", vacuna: "Vacuna o desparasitación", celo: "Celo observado" }[tipo] || "Registro";
  const lista = tipo === "secado" ? S.animales.filter((a) => a.estado === "lactancia") : ["servicio", "prenez", "celo"].includes(tipo) ? hembras() : activos();
  if (!lista.length) return sheet(cab(titulo) + `<p class="muted">No hay animales para este registro.</p>`);
  const selA = selectorAnimales(lista, { multi, atajos: tipo === "vacuna", sel: pre.animales || (arete ? [arete] : []) });
  sheet(cab(titulo) + `
    <form id="fE" class="stack">
      <div><span class="small muted" style="font-weight:700">${multi ? "Animales (puede elegir varios)" : "Animal"}</span>${selA.html}</div>
      <div class="grid2">
      <label class="f">Fecha<input type="date" id="eF" value="${hoy()}" required></label>
      ${tipo === "prenez" ? `<div class="full"><span class="f" style="font-size:.88rem;color:var(--muted);font-weight:700">Resultado</span><div class="opciones" style="margin-top:6px"><button type="button" class="chipbtn" data-r="prenez" aria-pressed="${pre.resultado !== "vacia"}">Preñada</button><button type="button" class="chipbtn" data-r="vacia" aria-pressed="${pre.resultado === "vacia"}">Vacía</button></div></div>` : ""}
      ${tipo === "servicio" ? `<label class="f full">Toro o pajilla<input id="eP" value="${esc(pre.nota || "")}" placeholder="Ej. Pajilla Holstein, toro de la finca"></label>` : ""}
      ${esTrat || tipo === "vacuna" ? `<label class="f full">Producto<input id="eP" list="prodList" value="${esc(pre.producto || "")}" placeholder="${esTrat ? "Nombre del medicamento" : "Ej. Aftosa, ivermectina"}" autocomplete="off">${datalistProductos(tipo)}</label>` : ""}
      ${esTrat ? `<label class="f">Días de retiro de leche<input id="eR" inputmode="numeric" value="${pre.retiroDias ?? ""}" placeholder="Ver etiqueta"></label><label class="f">Causa<input id="eC" value="${esc(pre.nota || "")}" placeholder="Mastitis, cojera…"></label><p class="small muted full">Los días de retiro vienen en la etiqueta del producto. Mientras dure, la app le recordará no entregar la leche de esa vaca.</p>` : ""}
      <label class="f full">Nota (opcional)<input id="eN"></label>
      </div>
      <button class="btn" type="submit">Guardar</button>
    </form>`, (s) => {
    selA.init(s);
    let res = pre.resultado === "vacia" ? "vacia" : "prenez";
    $$("[data-r]", s).forEach((b) => (b.onclick = () => { res = b.dataset.r; $$("[data-r]", s).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    const prodIn = $("#eP", s), retIn = $("#eR", s);
    if (prodIn && retIn) prodIn.addEventListener("input", () => { const p = cfgProd().lista[prodKey(prodIn.value)]; if (p && p.retiroDias != null && !retIn.value) retIn.value = p.retiroDias; });
    $("#fE", s).onsubmit = (ev) => { ev.preventDefault();
      const aretes = selA.get(); if (!aretes.length) return toast(multi ? "Elija al menos un animal" : "Elija el animal");
      const fecha = $("#eF", s).value, t = tipo === "prenez" ? res : tipo;
      const nota = [$("#eC", s)?.value.trim(), $("#eN", s).value.trim()].filter(Boolean).join(" · ");
      const producto = prodIn && prodIn.value.trim() ? prodIn.value.trim() : null;
      const r = esTrat ? pint(retIn.value) : null;
      guardarYcerrar(async () => {
        for (const ar of aretes) {
          const a = S.animales.find((x) => x.arete === ar);
          const o = { id: uid(), arete: ar, tipo: t, fecha, nota };
          if (producto) o.producto = producto;
          if (esTrat && r != null) { o.retiroDias = r; o.retiroHasta = add(fecha, r); }
          await save("eventos", o);
          if (t === "secado") await save("animales", { ...a, estado: "seca" });
        }
        if (producto && (esTrat || tipo === "vacuna")) await recordarProducto(producto, tipo, r);
      }, esTrat && r != null ? `Guardado. Leche en retiro hasta el ${fmt(add(fecha, r))}` : aretes.length > 1 ? `Guardado en ${aretes.length} animales` : "Guardado");
    };
  });
}

function formObs(arete, obsPre) {
  if (!activos().length) return faltanAnimales();
  const selA = selectorAnimales(activos(), { sel: arete ? [arete] : [] });
  const ini = OBS.includes(obsPre) ? obsPre : OBS[0];
  sheet(cab("Observación") + `
    <form id="fO" class="stack">
      <div><span class="small muted" style="font-weight:700">Animal</span>${selA.html}</div>
      <div><span class="small muted" style="font-weight:700">¿Qué vio?</span><div class="opciones" style="margin-top:6px">${OBS.map((o) => `<button type="button" class="chipbtn" data-o="${esc(o)}" aria-pressed="${o === ini}">${esc(o)}</button>`).join("")}</div></div>
      <label class="f">Detalle (opcional)<input id="oN" placeholder="Ej. cuarto trasero derecho"></label>
      <button class="btn" type="submit">Guardar</button>
      <button class="btn ghost" type="button" id="oSint">Está enfermo: revisar síntomas</button>
    </form>`, (s) => {
    selA.init(s);
    let sel = ini;
    $$("[data-o]", s).forEach((b) => (b.onclick = () => { sel = b.dataset.o; $$("[data-o]", s).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $("#oSint", s).onclick = () => formSintomas(selA.get()[0]);
    $("#fO", s).onsubmit = (ev) => { ev.preventDefault();
      const a = selA.get()[0]; if (!a) return toast("Elija el animal");
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
  const w = pesoAnimal(an), v = valorAnimal(an), dsc = evalDescarte(an);
  sheet(`<div class="row spread"><div class="row" style="gap:8px"><span class="tag">${esc(an.arete)}</span><h2>${esc(an.nombre || "Sin nombre")}</h2></div><button class="btn ghost sm" data-close type="button">Cerrar</button></div>
    <div>${chips(an, c)}</div>
    ${r ? `<div class="alerta bad"><span class="quien">Leche en retiro</span><span>No entregar hasta el ${fmt(r.retiroHasta)} inclusive${r.producto ? " · " + esc(r.producto) : ""}.</span></div>` : ""}
    <div class="facts small muted"><div>Raza<b>${esc(an.raza || "–")}</b></div><div>Edad<b>${edadTxt(an.nacimiento)}</b></div><div>Madre<b>${esc(an.madre || "–")}</b></div>
      <div>Partos<b>${c.nPartos}</b></div><div>Días parida<b>${c.del ?? "–"}</b></div><div>Parto prob.<b>${fmt(c.fpp)}</b></div>
      <div>Peso<b>${nf(w.kg)} kg${w.aprox ? " aprox." : ""}</b></div><div class="full" style="grid-column:span 2">Valor estimado<b>${v ? pesos(v.valor) : "–"}</b></div></div>
    ${v ? `<p class="small muted" style="margin-top:-6px">${esc(v.base)}${v.descarte && /por cabeza/.test(v.base) ? ` · como descarte ${pesos(v.descarte.valor)}` : ""}${v.tope ? ". Es un tope: ponga en Precios lo que pagan por vaca de descarte en su zona." : ""}</p>` : ""}
    ${dsc ? `<div class="alerta"><span class="quien">Candidata a descarte</span><span>${esc(capital(dsc.motivos.join(", ")))}.</span></div>` : ""}
    ${an.estado === "lactancia" ? `<div><span class="small muted" style="font-weight:700">¿Cómo está dando leche?</span><div class="opciones" style="margin-top:6px">${["alta", "media", "baja"].map((n) => `<button type="button" class="chipbtn" data-n="${n}" aria-pressed="${an.nivel === n}">${n[0].toUpperCase() + n.slice(1)}</button>`).join("")}</div></div>` : ""}
    ${crias.length ? `<div class="small"><span class="eyebrow">Crías</span><br>${crias.map((x) => `<span class="tag">${esc(x.arete)}</span> ${esc(x.nombre || "")}`).join(" · ")}</div>` : ""}
    <div class="acciones">
      <button class="accion" type="button" data-x="obs"><b>Observación</b></button>
      <button class="accion" type="button" data-x="tratamiento"><b>Tratamiento</b></button>
      ${hembraAdulta ? `<button class="accion" type="button" data-x="servicio"><b>Servicio</b></button><button class="accion" type="button" data-x="prenez"><b>Diagnóstico</b></button><button class="accion" type="button" data-x="nac"><b>Parto</b></button>` : ""}
      ${an.estado === "lactancia" ? `<button class="accion" type="button" data-x="secado"><b>Secar</b></button>` : ""}
      <button class="accion" type="button" data-x="peso"><b>Registrar peso</b></button>
      <button class="accion" type="button" data-x="sintomas"><b>Revisar síntomas</b></button>
    </div>
    <div><span class="eyebrow">Historial</span><div class="timeline" style="margin-top:8px">${ev.length ? ev.map((e) => `<div><span class="small muted">${fmt(e.fecha)}</span> · <b>${esc(e.tipo === "obs" ? e.obs : TIPOS[e.tipo] || e.tipo)}</b>${e.cria ? ` (cría ${esc(e.cria)})` : ""}${e.producto ? " · " + esc(e.producto) : ""}${e.retiroHasta ? ` · retiro hasta ${fmt(e.retiroHasta)}` : ""}${e.kg ? ` · ${nf(e.kg)} kg` : ""}${e.valor ? ` · ${pesos(e.valor)}` : ""}${e.tipo === "salud" && e.posibles ? `<br><span class="small">Posibles: ${esc(e.posibles.slice(0, 3).join(", ") || "sin coincidencias")}</span>` : ""}${e.nota ? `<br><span class="small muted">${esc(e.nota)}</span>` : ""}</div>`).join("") : '<div class="muted">Sin registros.</div>'}</div></div>
    <div class="row"><button class="btn ghost sm" type="button" data-x="editar">Editar datos</button><button class="btn ghost sm" type="button" data-x="vender">${an.estado === "vendida" ? "Ya vendida" : "Vender"}</button><button class="btn ghost sm" type="button" data-x="borrar">Eliminar</button></div>`,
  (s) => {
    $$("[data-n]", s).forEach((b) => (b.onclick = async () => { await save("animales", { ...an, nivel: b.dataset.n }); toast("Producción actualizada"); render(); detalle(arete); }));
    $$("[data-x]", s).forEach((b) => (b.onclick = function () {
      const x = b.dataset.x;
      if (x === "editar") formAnimal(an);
      else if (x === "vender") { if (an.estado !== "vendida") formVenta(an); }
      else if (x === "peso") formPeso(an);
      else if (x === "sintomas") formSintomas(arete);
      else if (x === "borrar") confirmar(this, "Toque otra vez para eliminar", () => guardarYcerrar(() => del("animales", an.id), "Res eliminada"));
      else abrir(x, arete);
    }));
  });
}

/* ---------- mercado: peso, precios del ganado y descarte ---------- */
let MERCADO = null; // precios de referencia (precios.json, de Fedegán)
const PESO_RAZA = { holstein: 600, jersey: 400, normando: 560, ayrshire: 500, "pardo suizo": 620, gyr: 450, girolando: 500, cruce: 500 };
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const razaKey = (r) => String(r || "").trim() || "Sin raza";
function pesoAdultoRaza(raza) { const r = String(raza || "").toLowerCase(); const k = Object.keys(PESO_RAZA).find((x) => r.includes(x)); return k ? PESO_RAZA[k] : 500; }
function pesoCinta(cm) { const m = cm / 100; return Math.round(80 * m * m * m); } // fórmula de Crevat: perímetro torácico
function pesoAnimal(an) {
  if (an.peso) return { kg: an.peso, aprox: false, fecha: an.pesoFecha, metodo: an.pesoMetodo };
  const adulto = pesoAdultoRaza(an.raza) * (an.sexo === "M" && an.estado !== "ternera" ? 1.4 : 1);
  if (!an.nacimiento) return { kg: an.estado === "ternera" ? 90 : Math.round(adulto * (an.estado === "novilla" ? 0.75 : 1)), aprox: true };
  const dias = Math.max(0, diff(hoy(), an.nacimiento));
  return { kg: Math.round(Math.min(adulto, adulto * 0.07 + dias * (adulto > 550 ? 0.7 : 0.55))), aprox: true };
}
const cfgP = () => ({ regionGordo: "Bogotá", regionFlaco: "Magdalena Medio y Santanderes", cabeza: {}, ...(S.config.find((c) => c.id === "precios") || {}), id: "precios" });
const fmtPer = (p) => { if (!p) return "–"; if (/^\d{4}-\d{2}$/.test(p)) { const [y, m] = p.split("-"); return MES[Number(m) - 1] + " " + y; } return fmt(p); };
function ultimoDe(serie, region) { for (let i = serie.length - 1; i >= 0; i--) if (serie[i][region]) return { v: serie[i][region], f: serie[i].fecha || serie[i].periodo }; return null; }
function refPrecios() {
  const p = cfgP(), m = MERCADO;
  if (!m) return {};
  return { gordo: ultimoDe(m.gordo.serie, p.regionGordo) || ultimoDe(m.gordo.serie, "Nacional"), flacoM: ultimoDe(m.flacoMachos.serie, p.regionFlaco), flacoH: ultimoDe(m.flacoHembras.serie, p.regionFlaco) };
}
function precioKg(cat) {
  const p = cfgP(), r = refPrecios();
  const propio = { descarte: p.descarteKg, gordo: p.gordoKg, macho: p.machoKg, hembra: p.hembraKg }[cat];
  if (propio) return { v: propio, propio: true };
  const ref = { descarte: r.gordo, gordo: r.gordo, macho: r.flacoM, hembra: r.flacoH }[cat];
  return ref ? { v: ref.v, propio: false, fecha: ref.f } : null;
}
function valorAnimal(an) {
  if (an.estado === "vendida") return null;
  const c = ciclo(an), w = pesoAnimal(an), cab = (cfgP().cabeza || {})[razaKey(an.raza)] || {};
  const porKg = (cat, nombre) => { const pr = precioKg(cat); return pr ? { valor: Math.round(w.kg * pr.v), base: `${nf(w.kg)} kg${w.aprox ? " aprox." : ""} × ${pesos(pr.v)} (${nombre}${pr.propio ? ", su precio" : ", referencia Fedegán"})`, tope: cat === "descarte" && !pr.propio } : null; };
  let res, descarte = null;
  if (an.sexo === "M") res = an.estado === "ternera" ? porKg("macho", "ternero de levante") : porKg("gordo", "ganado gordo");
  else if (an.estado === "ternera") res = porKg("hembra", "hembra de levante");
  else if (an.estado === "novilla") res = c.prenada && cab.novilla ? { valor: cab.novilla, base: `novilla preñada ${razaKey(an.raza)}, su precio por cabeza` } : porKg("hembra", "hembra de levante");
  else { descarte = porKg("descarte", "vaca de descarte"); res = cab.vaca ? { valor: cab.vaca, base: `vaca lechera ${razaKey(an.raza)}, su precio por cabeza` } : descarte; }
  return res ? { ...res, descarte, peso: w } : null;
}
function evalDescarte(an) {
  if (an.sexo === "M" || !["lactancia", "seca"].includes(an.estado)) return null;
  const c = ciclo(an), h = hoy(), motivos = []; let pts = 0;
  if (an.estado === "lactancia" && an.nivel === "baja") { pts += 2; motivos.push("da poca leche"); }
  if (!c.prenada) {
    const post = evDe(an.arete).filter((e) => e.fecha >= (c.ultParto || "0000"));
    if (c.nServ >= 3) { pts += 2; motivos.push(`${c.nServ} servicios sin quedar preñada`); }
    if (c.dAbiertos != null && c.dAbiertos > 150) { pts += c.dAbiertos > 200 ? 2 : 1; motivos.push(`${c.dAbiertos} días abierta`); }
    if (post.some((e) => e.tipo === "vacia")) { pts += 1; motivos.push("diagnóstico de vacía"); }
  }
  const mast = S.eventos.filter((e) => e.arete === an.arete && e.fecha >= add(h, -365) &&
    ((e.tipo === "tratamiento" && /mastitis|ubre|intramamari/i.test((e.nota || "") + " " + (e.producto || ""))) || (e.tipo === "obs" && ["Ubre caliente o hinchada", "Leche con grumos"].includes(e.obs)))).length;
  if (mast >= 2) { pts += 2; motivos.push(`${mast} casos de mastitis en el último año`); }
  const edad = an.nacimiento ? diff(h, an.nacimiento) / 365.25 : null;
  if ((edad && edad >= 10) || c.nPartos >= 7) { pts += 1; motivos.push(edad && edad >= 10 ? `${Math.floor(edad)} años de edad` : `${c.nPartos} partos`); }
  if (c.prenada) pts -= 2;
  return pts >= 3 ? { pts, motivos, valor: valorAnimal(an) } : null;
}
function candidatasDescarte() { return S.animales.map((an) => ({ an, d: evalDescarte(an) })).filter((x) => x.d).sort((a, b) => b.d.pts - a.d.pts); }
function tendenciaGordo() {
  if (!MERCADO) return null;
  const reg = cfgP().regionGordo, s = MERCADO.gordo.serie.filter((x) => x[reg]);
  if (s.length < 12) return null;
  const v = s.map((x) => x[reg]), ult4 = avg(v.slice(-4)), prev = avg(v.slice(-16, -4));
  return { reg, pct: (ult4 / prev - 1) * 100, ult: s[s.length - 1], serie: s.slice(-26).map((x) => ({ f: x.fecha, v: x[reg] })) };
}
function resumenValor() {
  const vivos = S.animales.filter((a) => a.estado !== "vendida");
  let total = 0, aprox = 0, sinPrecio = 0;
  vivos.forEach((an) => { const v = valorAnimal(an); if (!v) { sinPrecio++; return; } total += v.valor; if (v.peso.aprox && !/por cabeza/.test(v.base)) aprox++; });
  return { total, aprox, sinPrecio, n: vivos.length };
}
function sparkline(puntos, w = 280, h = 56) {
  if (!puntos || puntos.length < 2) return "";
  const vs = puntos.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
  const xy = puntos.map((p, i) => [4 + (i * (w - 8)) / (puntos.length - 1), 6 + (h - 12) * (1 - (p.v - lo) / r)]);
  const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const u = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Precio de las últimas semanas"><path d="${d} L${u[0].toFixed(1)} ${h} L4 ${h} Z" fill="var(--brand-soft)"/><path d="${d}" fill="none" stroke="var(--brand)" stroke-width="2"/><circle cx="${u[0]}" cy="${u[1]}" r="3.5" fill="var(--brand)"/></svg>`;
}
async function cargarMercado() {
  const guard = S.config.find((c) => c.id === "mercado"); if (guard) MERCADO = guard.datos;
  try {
    const r = await fetch("precios.json", { cache: "no-cache" });
    if (r.ok) { const d = await r.json(); if (d && d.gordo && d.gordo.serie) { MERCADO = d; await save("config", { id: "mercado", datos: d }); render(); } }
  } catch (e) { /* sin señal: se usan los últimos precios guardados */ }
}

function panelMercado() {
  const t = tendenciaGordo(), rv = resumenValor(), cand = candidatasDescarte(), r = refPrecios();
  return `<div class="panel stack">
    <div class="row spread"><h3>Valor del hato</h3><button class="btn ghost sm" type="button" id="hPrecios">Precios</button></div>
    <div class="kpis">
      <div class="kpi"><span class="eyebrow">Valor estimado</span><b>${rv.total ? pesos(rv.total) : "–"}</b><span class="small muted">${rv.n} animales${rv.aprox ? ` · ${rv.aprox} con peso aproximado` : ""}</span></div>
      <div class="kpi"><span class="eyebrow">Ganado gordo · ${esc(t ? t.reg : cfgP().regionGordo)}</span><b>${r.gordo ? pesos(r.gordo.v) : "–"}</b><span class="small muted">${t ? `<span class="delta ${t.pct >= 0 ? "up" : "down"}">${t.pct >= 0 ? "▲" : "▼"} ${nf(Math.abs(t.pct), 1)}%</span> vs. 3 meses` : MERCADO ? "" : "Sin precios todavía"}</span></div>
    </div>
    ${t ? `<div>${sparkline(t.serie)}<div class="row spread small muted"><span>${fmt(t.serie[0].f)}</span><span>$ por kilo en pie, semanal</span><span>${fmt(t.ult.fecha)}</span></div></div>` : ""}
    ${rv.aprox ? `<p class="small muted">Los pesos aproximados salen de la raza y la edad. Mida el pecho con cinta en la ficha de cada animal para un valor más real.</p>` : ""}
    <div class="stack">
      <div class="row spread"><b>Candidatas a descarte</b><span class="small muted">${cand.length || "ninguna"}</span></div>
      ${cand.length ? cand.map(({ an, d }) => `<button class="card" type="button" data-a="${esc(an.arete)}">
        <div class="row spread"><div class="row" style="gap:8px"><span class="tag">${esc(an.arete)}</span><h3>${esc(an.nombre || "Sin nombre")}</h3></div><b class="num">${d.valor && d.valor.descarte ? "≈ " + pesos(d.valor.descarte.valor) : ""}</b></div>
        <span class="small muted">${esc(capital(d.motivos.join(", ")))}.</span></button>`).join("")
      : `<p class="small muted">Aquí aparecen las vacas que conviene revisar para vender: poca leche, muchos días vacía, servicios repetidos o mastitis frecuente.</p>`}
    </div>
  </div>`;
}

function formPrecios() {
  const p = cfgP(), m = MERCADO, r = refPrecios();
  const razas = [...new Set(S.animales.filter((a) => a.sexo !== "M" && a.estado !== "vendida").map((a) => razaKey(a.raza)))].sort();
  const sel = (id, lista, actual) => `<select id="${id}">${lista.map((x) => `<option${x === actual ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const campo = (id, label, val, ref) => `<label class="f">${label}<input id="${id}" inputmode="numeric" value="${val ?? ""}" placeholder="${ref ? "Ref. " + nf(ref.v) : ""}"></label>`;
  sheet(cab("Precios del ganado") + `
    ${m ? `<div class="panel stack">
      <span class="eyebrow">Referencia Fedegán · ${esc(m.unidad || "$ por kilo en pie")}</span>
      <div class="grid2">
        <label class="f">Región ganado gordo${sel("pRegG", m.gordo.regiones, p.regionGordo)}</label>
        <label class="f">Región ganado flaco${sel("pRegF", m.flacoMachos.regiones, p.regionFlaco)}</label>
      </div>
      <div class="tablewrap"><table>
        <tr><th>Categoría</th><th class="r">$/kg</th><th>Fecha</th></tr>
        <tr><td>Ganado gordo (novillo)</td><td class="r">${r.gordo ? pesos(r.gordo.v) : "–"}</td><td>${r.gordo ? fmt(r.gordo.f) : "–"}</td></tr>
        <tr><td>Machos de levante</td><td class="r">${r.flacoM ? pesos(r.flacoM.v) : "–"}</td><td>${r.flacoM ? fmtPer(r.flacoM.f) : "–"}</td></tr>
        <tr><td>Hembras de levante</td><td class="r">${r.flacoH ? pesos(r.flacoH.v) : "–"}</td><td>${r.flacoH ? fmtPer(r.flacoH.f) : "–"}</td></tr>
      </table></div>
      <p class="small muted">Fuente: <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.fuente)}</a>. Fedegán no publica precio de vaca de descarte ni de lecheras por cabeza; mientras no ponga los suyos, la vaca se valora al precio del ganado gordo, que es un tope: normalmente se paga menos.</p>
    </div>` : `<p class="muted">Todavía no hay precios de referencia. Abra la app con señal para descargarlos.</p>`}
    <form id="fP" class="stack">
      <div class="panel stack"><span class="eyebrow">Lo que le pagan en su zona ($ por kilo en pie, opcional)</span>
        <div class="grid2">
          ${campo("pDesc", "Vaca de descarte", p.descarteKg, null)}
          ${campo("pGordo", "Ganado gordo / toro", p.gordoKg, r.gordo)}
          ${campo("pMacho", "Ternero macho", p.machoKg, r.flacoM)}
          ${campo("pHembra", "Hembra de levante", p.hembraKg, r.flacoH)}
        </div>
      </div>
      <div class="panel stack"><span class="eyebrow">Lecheras por cabeza ($, opcional)</span>
        <p class="small muted">Lo que se paga en su zona por una vaca en producción o una novilla preñada de cada raza.</p>
        ${razas.length ? `<div class="tablewrap"><table><tr><th>Raza</th><th>Vaca en producción</th><th>Novilla preñada</th></tr>
          ${razas.map((rz, i) => { const c = (p.cabeza || {})[rz] || {}; return `<tr><td>${esc(rz)}</td><td><input id="pV${i}" data-raza="${esc(rz)}" inputmode="numeric" value="${c.vaca ?? ""}" placeholder="$"></td><td><input id="pN${i}" inputmode="numeric" value="${c.novilla ?? ""}" placeholder="$"></td></tr>`; }).join("")}
        </table></div>` : `<p class="small muted">Agregue vacas al hato para poner precios por raza.</p>`}
      </div>
      <button class="btn" type="submit">Guardar precios</button>
    </form>`, (s) => {
    $("#fP", s).onsubmit = (ev) => { ev.preventDefault();
      const cabeza = { ...(p.cabeza || {}) };
      razas.forEach((rz, i) => { cabeza[rz] = { vaca: pint($("#pV" + i, s).value), novilla: pint($("#pN" + i, s).value) }; });
      const g = $("#pRegG", s), f = $("#pRegF", s);
      guardarYcerrar(() => save("config", { ...p, regionGordo: g ? g.value : p.regionGordo, regionFlaco: f ? f.value : p.regionFlaco,
        descarteKg: pint($("#pDesc", s).value), gordoKg: pint($("#pGordo", s).value), machoKg: pint($("#pMacho", s).value), hembraKg: pint($("#pHembra", s).value), cabeza }), "Precios guardados");
    };
  });
}

function formPeso(an) {
  sheet(cab(`Peso de ${esc(an.arete)}${an.nombre ? " · " + esc(an.nombre) : ""}`) + `
    <form id="fW" class="stack">
      <div class="opciones"><button type="button" class="chipbtn" data-m="cinta" aria-pressed="true">Con cinta</button><button type="button" class="chipbtn" data-m="bascula" aria-pressed="false">Con báscula</button></div>
      <label class="f" id="wLabel">Perímetro del pecho (cm)<input class="big" id="wVal" inputmode="decimal" placeholder="0"></label>
      <p class="small muted" id="wAyuda">Pase la cinta por detrás de las patas delanteras, justo detrás de la cruz, con el animal parado derecho.</p>
      <div class="row spread"><span class="muted">Peso</span><b class="num" id="wKg" style="font-size:1.4rem">–</b></div>
      <label class="f">Fecha<input type="date" id="wF" value="${hoy()}" max="${hoy()}"></label>
      <button class="btn" type="submit">Guardar peso</button>
    </form>`, (s) => {
    let metodo = "cinta";
    const calc = () => { const v = pn($("#wVal", s).value); const kg = v == null ? null : metodo === "cinta" ? pesoCinta(v) : Math.round(v); $("#wKg", s).textContent = kg ? nf(kg) + " kg" + (metodo === "cinta" ? " aprox." : "") : "–"; return kg; };
    $$("[data-m]", s).forEach((b) => (b.onclick = () => { metodo = b.dataset.m; $$("[data-m]", s).forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("#wLabel", s).firstChild.textContent = metodo === "cinta" ? "Perímetro del pecho (cm)" : "Peso en báscula (kg)"; $("#wAyuda", s).hidden = metodo !== "cinta"; calc(); }));
    $("#wVal", s).oninput = calc; $("#wVal", s).focus();
    $("#fW", s).onsubmit = (ev) => { ev.preventDefault();
      const kg = calc(); if (!kg || kg < 20 || kg > 1500) return toast("Revise la medida: el peso no da razonable");
      const fecha = $("#wF", s).value, v = pn($("#wVal", s).value);
      guardarYcerrar(async () => {
        await save("animales", { ...an, peso: kg, pesoFecha: fecha, pesoMetodo: metodo });
        await save("eventos", { id: uid(), arete: an.arete, tipo: "peso", fecha, kg, nota: metodo === "cinta" ? `Cinta: ${nf(v)} cm` : "Báscula" });
      }, `Peso guardado: ${nf(kg)} kg`);
    };
  });
}

function formVenta(an) {
  const v = valorAnimal(an), w = pesoAnimal(an), d = evalDescarte(an);
  sheet(cab(`Vender ${esc(an.arete)}${an.nombre ? " · " + esc(an.nombre) : ""}`) + `
    ${v ? `<p class="muted small">Valor estimado: <b>${pesos(v.valor)}</b> (${esc(v.base)}).</p>` : ""}
    <form id="fV" class="grid2">
      <label class="f">Fecha<input type="date" id="vF" value="${hoy()}" max="${hoy()}" required></label>
      <label class="f">Motivo<select id="vM"><option>Descarte</option><option>Venta de cría</option><option>Venta de novilla o vaca</option><option>Otra</option></select></label>
      <label class="f">Precio recibido ($)<input id="vP" inputmode="numeric" placeholder="Total"></label>
      <label class="f">Peso de venta (kg)<input id="vK" inputmode="numeric" value="${w.aprox ? "" : w.kg}"></label>
      <label class="f full">Comprador o nota<input id="vN" autocomplete="off"></label>
      <button class="btn full" type="submit">Registrar venta</button>
    </form>`, (s) => {
    if (!d && an.estado === "ternera") $("#vM", s).value = "Venta de cría";
    else if (!d) $("#vM", s).value = "Venta de novilla o vaca";
    $("#fV", s).onsubmit = (ev) => { ev.preventDefault();
      const valor = pint($("#vP", s).value), kg = pint($("#vK", s).value), fecha = $("#vF", s).value;
      const nota = [$("#vM", s).value, kg && valor ? `${pesos(valor / kg)}/kg` : "", $("#vN", s).value.trim()].filter(Boolean).join(" · ");
      guardarYcerrar(async () => {
        await save("eventos", { id: uid(), arete: an.arete, tipo: "venta", fecha, valor, kg, nota });
        await save("animales", { ...an, estado: "vendida", fechaSalida: fecha });
      }, "Venta registrada");
    };
  });
}

/* ---------- plata: costos, utilidad por litro y simulador de pago ---------- */
const CATS = ["Concentrado y sales", "Medicamentos y veterinario", "Inseminación y genética", "Mano de obra", "Fertilizantes y potreros",
  "Combustible, energía y agua", "Arriendo", "Mantenimiento y equipos", "Cuotas y parafiscales", "Otros"];
const CAT_COLANTA = (g) => /CONCENTRADO|SAL/i.test(g) ? "Concentrado y sales" : /MEDICAMENTO|AGROQU/i.test(g) ? "Medicamentos y veterinario" : "Otros";
let mesPlata = hoy().slice(0, 7);
const cfgCostos = () => ({ fijos: [], familiarMes: null, incluirFamiliar: true, ...(S.config.find((c) => c.id === "costos") || {}), id: "costos" });
const nombreMes = (m) => { const [y, mm] = m.split("-"); return ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][Number(mm) - 1] + " " + y; };
const mesMas = (m, n) => { const [y, mm] = m.split("-").map(Number); const d = new Date(y, mm - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
const enMes = (f, m) => typeof f === "string" && f.startsWith(m);

function liqDeFecha(f) { return S.liquidaciones.find((l) => l.desde <= f && f <= l.hasta) || null; }
function ingresoLecheMes(m) {
  const precioCfg = cfg().precioLitro; let litros = 0, ingreso = 0, estimado = false;
  S.entregas.filter((e) => enMes(e.fecha, m)).forEach((e) => {
    litros += e.litros || 0;
    const l = liqDeFecha(e.fecha);
    if (l && l.precioPagado) ingreso += e.litros * l.precioPagado;
    else if (precioCfg) { ingreso += e.litros * precioCfg; estimado = true; }
  });
  return { litros, ingreso, estimado };
}
function gastosMes(m) {
  const filas = [];
  S.gastos.filter((g) => enMes(g.fecha, m)).forEach((g) => filas.push({ ...g, origen: "manual" }));
  S.liquidaciones.filter((l) => enMes(l.hasta, m)).forEach((l) => {
    (l.compras || []).forEach((c) => c.valor && filas.push({ id: `col-${l.id}-${c.grupo}`, fecha: l.hasta, categoria: CAT_COLANTA(c.grupo), descripcion: `Agrocolanta sem. ${l.semana}: ${capital(c.grupo)}${c.kg ? ` (${nf(c.kg)} kg)` : ""}`, valor: c.valor, origen: "colanta" }));
    (l.deducciones || []).filter((d) => /FOMENTO/i.test(d.concepto)).forEach((d) => filas.push({ id: `col-${l.id}-fomento`, fecha: l.hasta, categoria: "Cuotas y parafiscales", descripcion: `Cuota de fomento sem. ${l.semana}`, valor: d.valor, origen: "colanta" }));
  });
  const cc = cfgCostos();
  if (m <= hoy().slice(0, 7)) {
    (cc.fijos || []).forEach((f) => f.valor && filas.push({ id: `fijo-${f.id}-${m}`, fecha: m + "-01", categoria: f.categoria, descripcion: f.descripcion + " (fijo mensual)", valor: f.valor, origen: "fijo" }));
    if (cc.familiarMes && cc.incluirFamiliar) filas.push({ id: `familiar-${m}`, fecha: m + "-01", categoria: "Mano de obra", descripcion: "Trabajo familiar no pagado (valor estimado)", valor: cc.familiarMes, origen: "familiar" });
  }
  return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
function ventasMes(m) { return S.eventos.filter((e) => e.tipo === "venta" && e.valor && enMes(e.fecha, m)); }
function resumenMes(m) {
  const L = ingresoLecheMes(m), G = gastosMes(m), V = ventasMes(m);
  const gastos = G.reduce((s, g) => s + (g.valor || 0), 0), ventas = V.reduce((s, v) => s + v.valor, 0);
  const porCat = {}; G.forEach((g) => (porCat[g.categoria] = (porCat[g.categoria] || 0) + g.valor));
  const costoL = L.litros ? (gastos - ventas) / L.litros : null;
  return { m, ...L, G, V, gastos, ventas, porCat, utilidad: L.ingreso + ventas - gastos, costoL, precioL: L.litros ? L.ingreso / L.litros : null };
}

function vPlata() {
  const el = $("#v-plata");
  if (!puedeVerPlata()) { el.innerHTML = `<div class="empty">Esta sección es solo para el dueño de la finca.</div>`; return; }
  const r = resumenMes(mesPlata), cc = cfgCostos();
  const maxCat = Math.max(1, ...Object.values(r.porCat));
  const hist = []; for (let i = 5; i >= 0; i--) hist.push(resumenMes(mesMas(mesPlata, -i)));
  const util = r.utilidad, utilL = r.litros ? util / r.litros : null;
  el.innerHTML = `
    <div class="row spread"><button class="btn ghost sm" id="pPrev" type="button" aria-label="Mes anterior">‹</button><h2>${nombreMes(mesPlata)}</h2><button class="btn ghost sm" id="pNext" type="button" aria-label="Mes siguiente" ${mesPlata >= hoy().slice(0, 7) ? "disabled" : ""}>›</button></div>
    <div class="kpis">
      <div class="kpi hero"><div><span class="eyebrow">Ganancia del mes</span><b class="num" style="color:var(${util >= 0 ? "--ok" : "--bad"})">${r.litros || r.gastos ? pesos(util) : "–"}</b><span class="small muted">${utilL != null ? `${pesos(utilL)} por litro` : "Registre leche y gastos para calcularla"}</span></div>
        <button class="btn" id="pGasto" type="button">+ Gasto</button></div>
      <div class="kpi"><span class="eyebrow">Costo por litro</span><b>${r.costoL != null ? pesos(r.costoL) : "–"}</b><span class="small muted">${r.precioL ? `le pagan ${pesos(r.precioL)}` : "&nbsp;"}</span></div>
      <div class="kpi"><span class="eyebrow">Leche</span><b>${nf(r.litros)} L</b><span class="small muted">${pesos(r.ingreso)}${r.estimado ? " aprox." : ""}</span></div>
      <div class="kpi"><span class="eyebrow">Gastos</span><b>${pesos(r.gastos)}</b><span class="small muted">${r.G.length} registros</span></div>
      <div class="kpi"><span class="eyebrow">Venta de animales</span><b>${pesos(r.ventas)}</b><span class="small muted">${r.V.length ? r.V.length + " ventas" : "&nbsp;"}</span></div>
    </div>
    ${r.precioL && r.costoL != null ? `<div class="alerta ${r.costoL > r.precioL ? "bad" : r.costoL > r.precioL * 0.85 ? "" : "info"}"><span class="quien">${r.costoL > r.precioL ? "Está perdiendo plata con cada litro" : r.costoL > r.precioL * 0.85 ? "Margen apretado" : "Margen sano"}</span><span>Cada litro le cuesta ${pesos(r.costoL)} y se lo pagan a ${pesos(r.precioL)}. ${r.costoL > r.precioL ? "Revise abajo en qué se va la plata." : `Le quedan ${pesos(r.precioL - r.costoL)} por litro.`}</span></div>` : ""}
    <div class="panel stack"><h3>En qué se va la plata</h3>
      ${Object.keys(r.porCat).length ? Object.entries(r.porCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div><div class="row spread small"><span>${esc(c)}</span><b class="num">${pesos(v)} · ${nf((v / r.gastos) * 100)}%</b></div><div class="qbar"><i style="width:${(v / maxCat) * 100}%;background:var(--brand)"></i></div></div>`).join("")
      : `<p class="muted small">Sin gastos este mes. Las compras en Agrocolanta se suman solas al cargar la liquidación.</p>`}
    </div>
    <div class="panel stack"><div class="row spread"><h3>Gastos del mes</h3><button class="btn ghost sm" id="pFijos" type="button">Fijos y mano de obra</button></div>
      ${r.G.length ? `<div class="tablewrap"><table><tr><th>Fecha</th><th>Concepto</th><th class="r">Valor</th><th></th></tr>${r.G.map((g) => `<tr><td>${fmt(g.fecha)}</td><td>${esc(g.descripcion || g.categoria)}<br><span class="small muted">${esc(g.categoria)}${g.origen === "colanta" ? " · de la liquidación" : g.origen === "fijo" ? " · fijo" : g.origen === "familiar" ? " · estimado" : ""}</span></td><td class="r">${pesos(g.valor)}</td><td>${g.origen === "manual" ? `<button class="btn ghost sm" type="button" data-g="${esc(g.id)}">Editar</button>` : ""}</td></tr>`).join("")}</table></div>` : `<p class="muted small">Nada registrado.</p>`}
    </div>
    <div class="panel stack"><h3>Últimos 6 meses</h3>
      <div class="tablewrap"><table><tr><th>Mes</th><th class="r">Litros</th><th class="r">Costo/L</th><th class="r">Pagado/L</th><th class="r">Ganancia</th></tr>
      ${hist.map((h) => `<tr><td>${esc(nombreMes(h.m))}</td><td class="r">${nf(h.litros)}</td><td class="r">${h.costoL != null ? pesos(h.costoL) : "–"}</td><td class="r">${h.precioL ? pesos(h.precioL) : "–"}</td><td class="r" style="color:var(${h.utilidad >= 0 ? "--ok" : "--bad"})">${h.litros || h.gastos ? pesos(h.utilidad) : "–"}</td></tr>`).join("")}</table></div>
    </div>
    <div class="panel stack"><h3>¿Cuánto más le pagarían?</h3>
      <p class="muted small">Simule cómo cambia el precio por litro si mejora la calidad o certifica el hato.</p>
      <button class="btn ghost" id="pSim" type="button">Abrir simulador de pago</button>
    </div>
    <div class="panel stack"><h3>Precios del ganado</h3><p class="muted small">Referencia de Fedegán y lo que pagan en su zona.</p><button class="btn ghost" id="pPrecios" type="button">Ver precios</button></div>`;
  $("#pPrev").onclick = () => { mesPlata = mesMas(mesPlata, -1); vPlata(); };
  $("#pNext").onclick = () => { if (mesPlata < hoy().slice(0, 7)) { mesPlata = mesMas(mesPlata, 1); vPlata(); } };
  $("#pGasto").onclick = () => formGasto();
  $("#pFijos").onclick = formFijos;
  $("#pSim").onclick = formSimulador;
  $("#pPrecios").onclick = formPrecios;
  $$("[data-g]", el).forEach((b) => (b.onclick = () => formGasto(S.gastos.find((g) => g.id === b.dataset.g))));
}

function formGasto(g, pre = {}) {
  const x = { fecha: hoy(), categoria: CATS[0], ...pre, ...(g || {}) };
  sheet(cab(g ? "Editar gasto" : "Nuevo gasto") + `
    <form id="fG" class="stack">
      <div class="opciones">${CATS.map((c) => `<button type="button" class="chipbtn" data-c="${esc(c)}" aria-pressed="${x.categoria === c}">${esc(c)}</button>`).join("")}</div>
      <div class="grid2">
        <label class="f">Valor ($)<input class="big" id="gV" inputmode="numeric" value="${x.valor ? nf(x.valor) : ""}" placeholder="0" required></label>
        <label class="f">Fecha<input type="date" id="gF" value="${x.fecha}" max="${hoy()}"></label>
        <label class="f full">Descripción<input id="gD" value="${esc(x.descripcion || "")}" placeholder="Ej. 10 bultos de concentrado"></label>
        ${S.potreros.length ? `<label class="f full">Potrero (opcional)<select id="gP"><option value="">Ninguno</option>${S.potreros.map((p) => `<option value="${esc(p.id)}"${x.potreroId === p.id ? " selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></label>` : ""}
      </div>
      <button class="btn" type="submit">Guardar gasto</button>
      ${g ? `<button class="btn ghost" type="button" id="gDel">Eliminar</button>` : ""}
    </form>`, (s) => {
    let cat = x.categoria;
    $$("[data-c]", s).forEach((b) => (b.onclick = () => { cat = b.dataset.c; $$("[data-c]", s).forEach((y) => y.setAttribute("aria-pressed", y === b)); }));
    $("#gV", s).focus();
    $("#fG", s).onsubmit = (ev) => { ev.preventDefault();
      const valor = pint($("#gV", s).value); if (!valor) return toast("Escriba el valor del gasto");
      const p = $("#gP", s);
      guardarYcerrar(() => save("gastos", { id: g ? g.id : uid(), fecha: $("#gF", s).value, categoria: cat, descripcion: $("#gD", s).value.trim(), valor, potreroId: p && p.value ? p.value : null }), "Gasto guardado");
    };
    const d = $("#gDel", s); if (d) d.onclick = function () { confirmar(this, "Toque otra vez para eliminar", () => guardarYcerrar(() => del("gastos", g.id), "Gasto eliminado")); };
  });
}

function formFijos() {
  const cc = cfgCostos(); const fijos = [...(cc.fijos || [])];
  const fila = (f, i) => `<div class="grid2" data-i="${i}" style="align-items:end">
      <label class="f">Concepto<input data-k="descripcion" value="${esc(f.descripcion || "")}" placeholder="Ej. Sueldo ordeñador"></label>
      <label class="f">Valor al mes<input data-k="valor" inputmode="numeric" value="${f.valor ? nf(f.valor) : ""}"></label>
      <label class="f full">Categoría<select data-k="categoria">${CATS.map((c) => `<option${c === (f.categoria || "Mano de obra") ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    </div>`;
  sheet(cab("Gastos fijos y mano de obra") + `
    <p class="muted small">Lo que paga igual todos los meses (sueldos, arriendo, energía). Se suma solo a cada mes, sin tener que registrarlo.</p>
    <form id="fF" class="stack">
      <div id="fFl" class="stack">${(fijos.length ? fijos : [{}]).map(fila).join("")}</div>
      <button class="btn ghost sm" type="button" id="fAdd">+ Otro gasto fijo</button>
      <div class="panel stack"><span class="eyebrow">Trabajo de la familia</span>
        <p class="small muted">Si usted o su familia ordeñan o trabajan en la finca sin sueldo, ese trabajo también cuesta. Póngale un valor mensual para que el costo por litro sea real.</p>
        <label class="f">Valor mensual estimado ($)<input id="fFam" inputmode="numeric" value="${cc.familiarMes ? nf(cc.familiarMes) : ""}" placeholder="Ej. 1.423.500 (un salario mínimo)"></label>
        <label class="row small"><input type="checkbox" id="fInc" style="width:auto;min-height:0" ${cc.incluirFamiliar ? "checked" : ""}> Incluirlo en el costo por litro</label>
      </div>
      <button class="btn" type="submit">Guardar</button>
    </form>`, (s) => {
    $("#fAdd", s).onclick = () => { $("#fFl", s).insertAdjacentHTML("beforeend", fila({}, $$("[data-i]", s).length)); };
    $("#fF", s).onsubmit = (ev) => { ev.preventDefault();
      const nuevos = $$("[data-i]", s).map((row, i) => ({ id: (fijos[i] && fijos[i].id) || uid(), descripcion: $('[data-k="descripcion"]', row).value.trim(), valor: pint($('[data-k="valor"]', row).value), categoria: $('[data-k="categoria"]', row).value })).filter((f) => f.descripcion && f.valor);
      guardarYcerrar(() => save("config", { ...cc, fijos: nuevos, familiarMes: pint($("#fFam", s).value), incluirFamiliar: $("#fInc", s).checked }), "Gastos fijos guardados");
    };
  });
}

/* Simulador: tabla del Ministerio (Res. 017 de 2012, cartilla 2024-2025, Región 1 trópico alto) ajustada con la última liquidación */
const TABLA_UFC = [[25, 165, 15], [50, 140, 15], [100, 113, 15], [150, 84, 10], [175, 52, 10], [200, 0, 0], [300, -29, 0], [400, -52, 0], [500, -84, 0], [600, -113, 0], [Infinity, -140, 0]];
const BONO_SANITARIO = 14.5; // por cada enfermedad (brucelosis, tuberculosis) y por BPG
const G_POR_PUNTO = 10.32; // gramos de sólidos por litro por cada punto de % (densidad de la leche)
const tramoUFC = (miles) => TABLA_UFC.find((t) => miles <= t[0]);
function baseSimulador() {
  const lq = [...S.liquidaciones].sort((a, b) => (a.hasta < b.hasta ? 1 : -1))[0];
  if (!lq || !lq.precioBase) return null;
  const cal = S.calidad.filter((q) => q.fecha <= lq.hasta && q.fecha > add(lq.hasta, -42) && q.solidos).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const stRef = lq.stRef || (cal.length ? avg(cal.map((q) => q.solidos)) : null);
  const ult = cal[cal.length - 1] || [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] || {};
  if (!stRef) return null;
  const porGramo = lq.precioBase / (stRef * G_POR_PUNTO);
  const bon = lq.bonificaciones || [];
  const bUFC = (bon.find((b) => /BACTER|RECUENTO/i.test(b.concepto)) || {}).porLitro || 0;
  const bFrio = (bon.find((b) => /FR[IÍ]O/i.test(b.concepto)) || {}).porLitro || 0;
  const sanit = bon.filter((b) => /BRUCEL|TUBERC|HATO LIBRE|SANITAR/i.test(b.concepto));
  const bBPG = (bon.find((b) => /BPG|BUENAS PR/i.test(b.concepto)) || {}).porLitro || 0;
  const otras = bon.filter((b) => !/BACTER|RECUENTO|FR[IÍ]O|BRUCEL|TUBERC|HATO LIBRE|SANITAR|BPG|BUENAS PR/i.test(b.concepto)).reduce((s, b) => s + (b.porLitro || 0), 0);
  const ufcMiles = ult.ufc ? ult.ufc / 1000 : null;
  const t = ufcMiles != null ? tramoUFC(ufcMiles) : null;
  const factor = t && t[1] > 0 && bUFC > 0 ? bUFC / t[1] : 1;
  const factorFrio = t && t[2] > 0 && bFrio > 0 ? bFrio / t[2] : factor;
  return { lq, factorFrio, stRef, porGramo, bUFC, bFrio, nSanit: sanit.length, bBPG, otras, ufcMiles, factor, flete: lq.fleteLitro || 0, litrosSemana: lq.litros };
}
function precioSimulado(b, st, ufcMiles, bruc, tb, bpg) {
  const t = tramoUFC(ufcMiles);
  const base = st * G_POR_PUNTO * b.porGramo;
  const ufc = t[1] * b.factor, frio = t[2] * b.factorFrio;
  const sanit = ((bruc ? 1 : 0) + (tb ? 1 : 0)) * BONO_SANITARIO * b.factor, bp = bpg ? BONO_SANITARIO * b.factor : 0;
  return { base, ufc, frio, sanit, bp, otras: b.otras, total: base + ufc + frio + sanit + bp + b.otras - b.flete };
}
function formSimulador() {
  const b = baseSimulador();
  if (!b) return sheet(cab("Simulador de pago") + `<p class="muted">Cargue al menos una liquidación de Colanta en PDF (pestaña Leche) para poder simular con sus números reales.</p>`);
  const actual = precioSimulado(b, b.stRef, b.ufcMiles ?? 150, b.nSanit >= 1, b.nSanit >= 2, b.bBPG > 0);
  sheet(cab("Simulador de pago") + `
    <p class="small muted">Con su liquidación de la semana ${b.lq.semana} (${pesos(b.lq.precioPagado)} pagado por litro). Mueva los valores y vea cuánto cambiaría.</p>
    <div class="grid2">
      <label class="f">Sólidos totales (%)<input id="sST" inputmode="decimal" value="${nf(b.stRef, 2)}"></label>
      <label class="f">Bacterias (UFC miles/mL)<input id="sU" inputmode="numeric" value="${b.ufcMiles != null ? Math.round(b.ufcMiles) : ""}" placeholder="Ej. 129"></label>
    </div>
    <div class="stack small">
      <label class="row"><input type="checkbox" id="sB" style="width:auto;min-height:0" ${b.nSanit >= 1 ? "checked" : ""}> Hato libre de brucelosis (certificado ICA)</label>
      <label class="row"><input type="checkbox" id="sT" style="width:auto;min-height:0" ${b.nSanit >= 2 ? "checked" : ""}> Hato libre de tuberculosis (certificado ICA)</label>
      <label class="row"><input type="checkbox" id="sP" style="width:auto;min-height:0" ${b.bBPG > 0 ? "checked" : ""}> Certificado en Buenas Prácticas Ganaderas (BPG)</label>
    </div>
    <div class="opciones"><button type="button" class="chipbtn" data-e="ufc">Bajar bacterias a 40.000</button><button type="button" class="chipbtn" data-e="cert">Certificar hato libre y BPG</button><button type="button" class="chipbtn" data-e="st">+0,2 en sólidos</button></div>
    <div class="panel stack" id="sOut"></div>
    <p class="small muted">Tabla del Ministerio de Agricultura (Resolución 017 de 2012, valores 2024-2025, región 1), ajustada con lo que Colanta le pagó en su última liquidación. Colanta puede usar valores algo distintos; tómelo como estimado. Las células somáticas no aparecen como bonificación en su liquidación.</p>`, (s) => {
    const calc = () => {
      const st = pn($("#sST", s).value) || b.stRef, u = pn($("#sU", s).value) ?? b.ufcMiles ?? 150;
      const sim = precioSimulado(b, st, u, $("#sB", s).checked, $("#sT", s).checked, $("#sP", s).checked);
      const dif = sim.total - actual.total, sem = dif * b.litrosSemana;
      $("#sOut", s).innerHTML = `
        <div class="row spread"><span class="muted">Precio por litro estimado</span><b class="num" style="font-size:1.5rem">${pesos(sim.total)}</b></div>
        <div class="row spread"><span class="muted">Diferencia por litro</span><b class="num" style="color:var(${dif >= 0 ? "--ok" : "--bad"})">${dif >= 0 ? "+" : ""}${pesos(dif)}</b></div>
        <div class="tablewrap"><table>
          <tr><td>Por sólidos (${nf(st, 2)}%)</td><td class="r">${pesos(sim.base)}</td></tr>
          <tr><td>Bonificación por bacterias</td><td class="r">${pesos(sim.ufc)}</td></tr>
          <tr><td>Bonificación por frío</td><td class="r">${pesos(sim.frio)}</td></tr>
          <tr><td>Hato libre</td><td class="r">${pesos(sim.sanit)}</td></tr>
          <tr><td>BPG</td><td class="r">${pesos(sim.bp)}</td></tr>
          <tr><td>Otras bonificaciones de Colanta</td><td class="r">${pesos(sim.otras)}</td></tr>
          <tr><td>Flete</td><td class="r">−${pesos(b.flete)}</td></tr>
        </table></div>
        ${Math.abs(dif) >= 1 ? `<div class="alerta ${dif >= 0 ? "info" : "bad"}"><span class="quien">${dif >= 0 ? "Ganaría más" : "Ganaría menos"}</span><span>Con ${nf(b.litrosSemana)} litros a la semana: ${pesos(sem)} a la semana, ${pesos(sem * 4.33)} al mes y ${pesos(sem * 52)} al año.</span></div>` : ""}`;
    };
    ["#sST", "#sU"].forEach((id) => ($(id, s).oninput = calc)); ["#sB", "#sT", "#sP"].forEach((id) => ($(id, s).onchange = calc));
    $$("[data-e]", s).forEach((x) => (x.onclick = () => {
      if (x.dataset.e === "ufc") $("#sU", s).value = 40;
      if (x.dataset.e === "cert") { $("#sB", s).checked = true; $("#sT", s).checked = true; $("#sP", s).checked = true; }
      if (x.dataset.e === "st") $("#sST", s).value = nf((pn($("#sST", s).value) || b.stRef) + 0.2, 2);
      calc();
    }));
    calc();
  });
}

/* ---------- registro rápido: buscador de animales, varios a la vez, productos recordados ---------- */
function selectorAnimales(lista, { multi = false, sel = [], atajos = false } = {}) {
  const elegidos = new Set(sel.filter(Boolean));
  if (!multi && !elegidos.size && lista.length === 1) elegidos.add(lista[0].arete);
  const ordenada = [...lista].sort(porArete);
  const html = `<div class="selA">
    <input type="search" class="selQ" placeholder="Buscar por número o nombre" autocomplete="off" aria-label="Buscar animal">
    ${multi && atajos ? `<div class="opciones"><button type="button" class="chipbtn" data-at="ordeno">Todas en ordeño</button><button type="button" class="chipbtn" data-at="todo">Todo el hato</button><button type="button" class="chipbtn" data-at="nada">Ninguna</button></div>` : ""}
    <div class="selL">${ordenada.map((a) => `<button type="button" class="selI" data-a="${esc(a.arete)}" aria-pressed="${elegidos.has(a.arete)}"><span class="tag">${esc(a.arete)}</span> ${esc(a.nombre || "")}<span class="small muted">${esc(ESTADOS[a.estado] || "")}</span></button>`).join("")}</div>
    <div class="small muted selN"></div>
  </div>`;
  const api = {
    html,
    init(s) {
      const box = $(".selA", s), q = $(".selQ", box), cuenta = () => ($(".selN", box).textContent = multi ? `${elegidos.size} seleccionada${elegidos.size === 1 ? "" : "s"}` : elegidos.size ? `Elegida: ${[...elegidos][0]}` : "Toque un animal");
      const pintar = () => $$(".selI", box).forEach((b) => b.setAttribute("aria-pressed", elegidos.has(b.dataset.a)));
      q.oninput = () => { const t = q.value.trim().toLowerCase(); $$(".selI", box).forEach((b) => (b.hidden = !!t && !b.textContent.toLowerCase().includes(t))); const vis = $$(".selI", box).filter((b) => !b.hidden); if (!multi && vis.length === 1) { elegidos.clear(); elegidos.add(vis[0].dataset.a); pintar(); cuenta(); } };
      $$(".selI", box).forEach((b) => (b.onclick = () => { const a = b.dataset.a; if (multi) elegidos.has(a) ? elegidos.delete(a) : elegidos.add(a); else { elegidos.clear(); elegidos.add(a); } pintar(); cuenta(); }));
      $$("[data-at]", box).forEach((b) => (b.onclick = () => { elegidos.clear(); if (b.dataset.at === "ordeno") ordenada.filter((a) => a.estado === "lactancia").forEach((a) => elegidos.add(a.arete)); if (b.dataset.at === "todo") ordenada.forEach((a) => elegidos.add(a.arete)); pintar(); cuenta(); }));
      const primero = $(".selI[aria-pressed=true]", box); if (primero) primero.scrollIntoView && primero.scrollIntoView({ block: "nearest" });
      cuenta();
    },
    get: () => [...elegidos],
  };
  return api;
}
const cfgProd = () => ({ lista: {}, ...(S.config.find((c) => c.id === "productos") || {}), id: "productos" });
const prodKey = (n) => String(n || "").trim().toLowerCase();
function datalistProductos(tipo) { return `<datalist id="prodList">${Object.values(cfgProd().lista).filter((p) => !tipo || p.tipo === tipo).map((p) => `<option value="${esc(p.nombre)}">${p.retiroDias != null ? esc(p.retiroDias + " días de retiro") : ""}</option>`).join("")}</datalist>`; }
async function recordarProducto(nombre, tipo, retiroDias) {
  if (!nombre) return; const c = cfgProd(), k = prodKey(nombre);
  const prev = c.lista[k] || {};
  await save("config", { ...c, lista: { ...c.lista, [k]: { nombre: prev.nombre || nombre.trim(), tipo, retiroDias: retiroDias ?? prev.retiroDias ?? null, usos: (prev.usos || 0) + 1 } } });
}

/* ---------- registro por voz ---------- */
const NUM_PAL = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
function palabrasANumeros(t) {
  return t.replace(/\b((?:(?:cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil)(?:\s+y\s+|\s+)?)+)\b/g, (m) => {
    const ws = m.trim().split(/\s+/).filter((w) => w !== "y"); let total = 0, parcial = 0;
    for (const w of ws) { if (w === "mil") { total += (parcial || 1) * 1000; parcial = 0; } else if (NUM_PAL[w] != null) parcial += NUM_PAL[w]; }
    return String(total + parcial) + " ";
  });
}
function plata(t) {
  const re = /(\bpor\s+|\$\s*)?(\d[\d.,]*)\s*(millones|millon|mil|lucas|barras)?(\s*pesos)?/g; let m, mejor = null;
  while ((m = re.exec(t))) {
    let n = parseFloat(m[2].replace(/\./g, "").replace(",", ".")); if (isNaN(n)) continue;
    if (/mill|barras/.test(m[3] || "")) n *= 1e6; else if (/mil|lucas/.test(m[3] || "")) n *= 1000;
    const puntos = (m[1] ? 2 : 0) + (m[3] || m[4] ? 2 : 0) + (n >= 1000 ? 1 : 0);
    if (!mejor || puntos > mejor.p || (puntos === mejor.p && n > mejor.n)) mejor = { n, p: puntos };
  }
  return mejor ? Math.round(mejor.n) : null;
}
function animalesEnTexto(t) {
  const out = new Set();
  const re = /\b(?:la|el|vaca|novilla|ternera|ternero|toro|numero|res|a la|de la)\s+(\d{1,6})\b/g; let m;
  while ((m = re.exec(t))) { const a = S.animales.find((x) => sinTildes(x.arete.toLowerCase()) === m[1]); if (a) out.add(a.arete); }
  S.animales.forEach((a) => { if (a.nombre && a.nombre.length > 2 && new RegExp("\\b" + sinTildes(a.nombre.toLowerCase()) + "\\b").test(t)) out.add(a.arete); });
  if (!out.size) { (t.match(/\b\d{2,6}\b/g) || []).forEach((n) => { const a = S.animales.find((x) => x.arete === n); if (a) out.add(a.arete); }); }
  return [...out];
}
function despuesDe(t, palabras, corta = /\b(por|durante|retiro|dias|dia|a la|al|la vaca|con un)\b|[,.]/) {
  const m = new RegExp("\\b(?:" + palabras + ")\\s+(.+)").exec(t); if (!m) return "";
  return m[1].split(corta)[0].trim();
}
function parseVoz(texto) {
  const cifras = (x) => x.replace(/(\d+(?:[.,]\d+)?)\s*(millones|millon)\b/g, (m, n) => String(Math.round(pn(n) * 1e6))).replace(/(\d+(?:[.,]\d+)?)\s*(mil|lucas)\b/g, (m, n) => String(Math.round(pn(n) * 1000)));
  const t = palabrasANumeros(cifras(sinTildes(texto.toLowerCase()))).replace(/\s+/g, " ").trim();
  const frases = t.split(/\s*(?:\.|;|\by tambien\b|\bademas\b)\s*/).filter(Boolean);
  const acciones = [];
  for (const f of frases) {
    const an = animalesEnTexto(f), todas = /\b(todas|todo el hato|todos)\b/.test(f);
    const dias = (/(\d+)\s*dias?\s*(?:de\s*)?retiro/.exec(f) || /retiro\s*(?:de\s*)?(\d+)\s*dias?/.exec(f) || [])[1];
    if (/\b(compr|pagu|pague|gast|pagamos)/.test(f) && plata(f)) {
      const cat = /concentrad|bulto|purina|alimento/.test(f) ? "Concentrado y sales" : /\bsal\b|sales|mineral/.test(f) ? "Concentrado y sales" : /droga|drogueria|medic|veterinari|antibi|vacuna/.test(f) ? "Medicamentos y veterinario" : /pajilla|insemin|semen/.test(f) ? "Inseminación y genética" : /jornal|sueldo|ordenador|trabajador|pago al/.test(f) ? "Mano de obra" : /abono|urea|fertiliz|cal agricola|semilla/.test(f) ? "Fertilizantes y potreros" : /gasolina|acpm|luz|energia|agua|planta/.test(f) ? "Combustible, energía y agua" : /arriendo/.test(f) ? "Arriendo" : /arregl|repuest|manguera|cerca|alambre/.test(f) ? "Mantenimiento y equipos" : "Otros";
      acciones.push({ tipo: "gasto", valor: plata(f), categoria: cat, descripcion: capital(texto.trim()).slice(0, 80) }); continue;
    }
    if (!an.length && /(entreg|litros|leche del dia|tanque)/.test(f)) {
      const l = (/(\d+(?:[.,]\d+)?)\s*litros/.exec(f) || /(?:entreg\w*|tanque)\D*(\d+(?:[.,]\d+)?)/.exec(f) || [])[1];
      if (l) { acciones.push({ tipo: "entrega", litros: pn(l), turno: /tarde/.test(f) ? "pm" : "am" }); continue; }
    }
    if (/(antibi|tratamiento|tratad|inyect|aplic|medic|penicil|oxitetra|intramam|curamos|cure)/.test(f) && !/vacun|purg|desparasit/.test(f)) {
      let producto = despuesDe(f, "con|le aplicamos|aplicamos|aplique|inyectamos|le pusimos|le puse");
      if (!producto && /antibi/.test(f)) producto = ("antibiotico " + despuesDe(f, "antibiotico")).trim();
      producto = producto.replace(/(\s+\d+)+\s*$/, "").replace(/^(un|una|el|la)\s+/, "").replace(/antibiotico/g, "antibiótico").trim();
      acciones.push({ tipo: "tratamiento", animales: an, producto: capital(producto), retiroDias: dias ? Number(dias) : null, causa: /mastitis|ubre|cuarto/.test(f) ? "Mastitis" : /coj|pata|pezu/.test(f) ? "Cojera" : /diarrea/.test(f) ? "Diarrea" : /neumon|tos/.test(f) ? "Respiratorio" : "" }); continue;
    }
    if (/(vacun|purg|desparasit|ivermectina|aftosa|brucel|vitamin)/.test(f)) {
      const producto = /aftosa/.test(f) ? "Aftosa" : /brucel/.test(f) ? "Brucelosis" : despuesDe(f, "con|contra|vacunamos|purgamos|desparasitamos") || (/purg|desparasit/.test(f) ? "Purgante" : "Vacuna");
      acciones.push({ tipo: "vacuna", animales: todas ? activos().map((a) => a.arete) : an, producto: capital(producto), todas }); continue;
    }
    if (/(pario|parto|nacio|nacimiento|tuvo cria|tuvo un|tuvo una)/.test(f)) {
      const cria = (/cria\s*(?:numero\s*)?(\d+)/.exec(f) || [])[1];
      acciones.push({ tipo: "parto", animales: an.filter((a) => a !== cria), sexo: /(macho|torito|ternero\b)/.test(f) ? "M" : /(hembra|ternera|novillita)/.test(f) ? "H" : null, cria: cria || null }); continue;
    }
    if (/(servicio|servimos|insemin|monto|monta|pajilla|la cubrio|la cargo)/.test(f)) {
      acciones.push({ tipo: "servicio", animales: an, nota: capital(despuesDe(f, "con|pajilla|toro") ? (/pajilla/.test(f) ? "Pajilla " : /toro/.test(f) ? "Toro " : "") + despuesDe(f, "con|pajilla|toro") : "") }); continue;
    }
    if (/(prenad|carga|cargada)/.test(f) && !/no esta prenad/.test(f)) { acciones.push({ tipo: "prenez", animales: an }); continue; }
    if (/(vacia|no esta prenad|no quedo)/.test(f)) { acciones.push({ tipo: "vacia", animales: an }); continue; }
    if (/\bcelo\b|caliente de celo|esta alborotada/.test(f)) { acciones.push({ tipo: "celo", animales: an }); continue; }
    if (/(secamos|secar|la seque|secada|se seco)/.test(f)) { acciones.push({ tipo: "secado", animales: an }); continue; }
    if (/(centimetros|cm\b|pecho|cinta)/.test(f)) { const cm = (/(\d+(?:[.,]\d+)?)\s*(?:centimetros|cm)/.exec(f) || [])[1]; if (cm) { acciones.push({ tipo: "peso", animales: an, cm: pn(cm) }); continue; } }
    if (/(pesa|peso|kilos|kg)/.test(f)) { const kg = (/(\d+(?:[.,]\d+)?)\s*(?:kilos|kg)/.exec(f) || [])[1]; if (kg) { acciones.push({ tipo: "peso", animales: an, kg: pn(kg) }); continue; } }
    const obs = /(ubre|cuarto).*(calient|hinchad|dura)|(calient|hinchad).*(ubre|cuarto)/.test(f) ? "Ubre caliente o hinchada" : /grumo|leche con sangre|leche aguada|cortada/.test(f) ? "Leche con grumos" : /(bajo|bajando|poca).*(leche)|leche.*(bajo|menos)/.test(f) ? "Bajó la leche" : /coj|renque/.test(f) ? "Cojea" : /no come|no quiere comer|desganada/.test(f) ? "No come bien" : null;
    if (obs) { acciones.push({ tipo: "obs", animales: an, obs }); continue; }
    acciones.push({ tipo: "nada", texto: f });
  }
  return acciones;
}
const NOMBRE_ACCION = { entrega: "Leche entregada", tratamiento: "Tratamiento", vacuna: "Vacuna o purga", parto: "Parto", servicio: "Servicio", prenez: "Preñez confirmada", vacia: "Diagnóstico: vacía", celo: "Celo", secado: "Secado", peso: "Peso", obs: "Observación", gasto: "Gasto", nada: "No entendí" };
function accionCompleta(a) {
  if (a.tipo === "nada") return false;
  if (a.tipo === "entrega") return a.litros > 0;
  if (a.tipo === "gasto") return a.valor > 0;
  if (a.tipo === "parto") return a.animales.length === 1 && a.cria && a.sexo;
  if (a.tipo === "tratamiento") return a.animales.length > 0 && a.retiroDias != null;
  return a.animales && a.animales.length > 0;
}
function resumenAccion(a) {
  const quien = a.animales && a.animales.length ? (a.animales.length > 4 ? `${a.animales.length} animales` : a.animales.join(", ")) : "¿cuál animal?";
  switch (a.tipo) {
    case "entrega": return `${nf(a.litros)} L en la ${a.turno === "pm" ? "tarde" : "mañana"}, hoy`;
    case "gasto": return `${pesos(a.valor)} · ${a.categoria}`;
    case "tratamiento": return `${quien} · ${a.producto || "producto sin nombre"} · ${a.retiroDias != null ? a.retiroDias + " días de retiro" : "¿días de retiro?"}${a.causa ? " · " + a.causa : ""}`;
    case "vacuna": return `${quien} · ${a.producto}`;
    case "parto": return `${quien} · ${a.sexo === "M" ? "macho" : a.sexo === "H" ? "hembra" : "¿macho o hembra?"} · ${a.cria ? "cría " + a.cria : "¿número de la cría?"}`;
    case "servicio": return `${quien}${a.nota ? " · " + a.nota : ""}`;
    case "peso": return `${quien} · ${a.kg ? nf(a.kg) + " kg" : nf(a.cm) + " cm de pecho (≈ " + nf(pesoCinta(a.cm)) + " kg)"}`;
    case "obs": return `${quien} · ${a.obs}`;
    case "nada": return `"${a.texto}"`;
    default: return quien;
  }
}
async function ejecutarAccion(a) {
  const f = hoy();
  if (a.tipo === "entrega") {
    const ex = S.entregas.find((e) => e.fecha === f) || { id: f, fecha: f, am: null, pm: null, nota: "" };
    const n = { ...ex, [a.turno]: a.litros }; n.litros = Math.round(((n.am || 0) + (n.pm || 0)) * 10) / 10; delete n.fuente;
    return save("entregas", n);
  }
  if (a.tipo === "gasto") return save("gastos", { id: uid(), fecha: f, categoria: a.categoria, descripcion: a.descripcion, valor: a.valor });
  if (a.tipo === "parto") {
    const m = S.animales.find((x) => x.arete === a.animales[0]);
    await save("animales", { id: slug(a.cria), arete: a.cria, nombre: "", sexo: a.sexo, raza: m.raza || "", nacimiento: f, estado: "ternera", madre: m.arete, origen: "nacida" });
    await save("eventos", { id: uid(), arete: m.arete, tipo: "parto", fecha: f, cria: a.cria, nota: "Registrado por voz" });
    return save("animales", { ...m, estado: "lactancia" });
  }
  for (const ar of a.animales) {
    const an = S.animales.find((x) => x.arete === ar); if (!an) continue;
    if (a.tipo === "tratamiento") await save("eventos", { id: uid(), arete: ar, tipo: "tratamiento", fecha: f, producto: a.producto, retiroDias: a.retiroDias, retiroHasta: a.retiroDias != null ? add(f, a.retiroDias) : null, nota: [a.causa, "por voz"].filter(Boolean).join(" · ") });
    else if (a.tipo === "vacuna") await save("eventos", { id: uid(), arete: ar, tipo: "vacuna", fecha: f, producto: a.producto, nota: "por voz" });
    else if (a.tipo === "obs") await save("eventos", { id: uid(), arete: ar, tipo: "obs", obs: a.obs, fecha: f, nota: "por voz" });
    else if (a.tipo === "peso") { const kg = a.kg || pesoCinta(a.cm); await save("animales", { ...an, peso: kg, pesoFecha: f, pesoMetodo: a.kg ? "bascula" : "cinta" }); await save("eventos", { id: uid(), arete: ar, tipo: "peso", fecha: f, kg, nota: a.cm ? `Cinta: ${nf(a.cm)} cm` : "" }); }
    else { await save("eventos", { id: uid(), arete: ar, tipo: a.tipo, fecha: f, nota: a.nota || "por voz" }); if (a.tipo === "secado") await save("animales", { ...an, estado: "seca" }); }
  }
  if (a.tipo === "tratamiento") await recordarProducto(a.producto, "tratamiento", a.retiroDias);
  if (a.tipo === "vacuna") await recordarProducto(a.producto, "vacuna", null);
}
function completarAccion(a) {
  const ar = a.animales && a.animales[0];
  if (a.tipo === "entrega") return formEntrega(null, { [a.turno]: a.litros });
  if (a.tipo === "gasto") return formGasto(null, { valor: a.valor, categoria: a.categoria, descripcion: a.descripcion });
  if (a.tipo === "parto") return formNacimiento(ar, { sexo: a.sexo, cria: a.cria });
  if (a.tipo === "obs") return formObs(ar, a.obs);
  if (a.tipo === "peso") { const an = S.animales.find((x) => x.arete === ar); return an ? formPeso(an) : toast("Diga el número del animal"); }
  if (["tratamiento", "vacuna", "servicio", "prenez", "vacia", "celo", "secado"].includes(a.tipo)) return formEvento(a.tipo === "vacia" ? "prenez" : a.tipo, ar, { animales: a.animales, producto: a.producto, retiroDias: a.retiroDias, nota: a.causa || a.nota, resultado: a.tipo === "vacia" ? "vacia" : null });
  abrirVoz();
}
let reconocedor = null;
function abrirVoz() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  sheet(cab("Registrar hablando") + `
    <p class="small muted">Ejemplos: <i>"La 104 recibió antibiótico intramamario, 4 días de retiro"</i> · <i>"Entregamos 430 litros"</i> · <i>"Vacunamos todas contra aftosa"</i> · <i>"La 105 está en celo"</i> · <i>"Compré 10 bultos de concentrado por 720 mil"</i></p>
    ${SR ? `<button class="btn block" type="button" id="vMic">🎙 Tocar y hablar</button>` : `<p class="small">Este celular no permite el dictado dentro de la app. Use el micrófono del teclado en la caja de abajo.</p>`}
    <label class="f">Lo que dijo (puede corregirlo)<textarea id="vTxt" rows="3" style="font:inherit;font-size:16px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:11px 12px;width:100%" placeholder="Hable o escriba aquí"></textarea></label>
    <button class="btn ghost block" type="button" id="vOk">Entender</button>
    <div id="vRes" class="stack"></div>`, (s) => {
    const txt = $("#vTxt", s), mic = $("#vMic", s);
    const entender = () => {
      const acc = parseVoz(txt.value || ""); if (!txt.value.trim()) return;
      $("#vRes", s).innerHTML = acc.map((a, i) => `<div class="panel stack"><div class="row spread"><b>${NOMBRE_ACCION[a.tipo]}</b>${a.tipo === "nada" ? "" : accionCompleta(a) ? '<span class="chip pren">Listo</span>' : '<span class="chip seca">Falta un dato</span>'}</div><span class="small">${esc(resumenAccion(a))}</span>
        ${a.tipo === "nada" ? `<span class="small muted">Intente decirlo de otra forma o use el botón +.</span>` : `<div class="row">${accionCompleta(a) ? `<button class="btn sm" type="button" data-ok="${i}">Guardar</button>` : ""}<button class="btn ghost sm" type="button" data-ed="${i}">${accionCompleta(a) ? "Corregir" : "Completar"}</button></div>`}</div>`).join("") +
        (acc.filter(accionCompleta).length > 1 ? `<button class="btn" type="button" id="vTodo">Guardar todo (${acc.filter(accionCompleta).length})</button>` : "");
      $$("[data-ok]", s).forEach((b) => (b.onclick = () => guardarYcerrar(() => ejecutarAccion(acc[b.dataset.ok]), "Guardado: " + NOMBRE_ACCION[acc[b.dataset.ok].tipo])));
      $$("[data-ed]", s).forEach((b) => (b.onclick = () => completarAccion(acc[b.dataset.ed])));
      const todo = $("#vTodo", s); if (todo) todo.onclick = () => guardarYcerrar(async () => { for (const a of acc.filter(accionCompleta)) await ejecutarAccion(a); }, "Registros guardados");
    };
    $("#vOk", s).onclick = entender;
    if (mic) mic.onclick = () => {
      try { if (reconocedor) reconocedor.abort(); } catch (e) {}
      const r = new SR(); reconocedor = r; r.lang = "es-CO"; r.interimResults = true; r.continuous = false;
      mic.textContent = "Escuchando… hable ahora"; mic.disabled = true;
      let final = "";
      r.onresult = (ev) => { let parcial = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i]; x.isFinal ? (final += x[0].transcript + " ") : (parcial += x[0].transcript); } txt.value = (final + parcial).trim(); };
      r.onerror = (ev) => { toast(ev.error === "not-allowed" ? "Permita el micrófono para hablarle a la app" : ev.error === "network" ? "El dictado necesita señal. Use el micrófono del teclado." : "No se escuchó bien, intente otra vez"); };
      r.onend = () => { mic.textContent = "🎙 Tocar y hablar"; mic.disabled = false; reconocedor = null; if (txt.value.trim()) entender(); };
      try { r.start(); } catch (e) { mic.disabled = false; mic.textContent = "🎙 Tocar y hablar"; }
    };
  });
}

/* ---------- avisos en el celular ---------- */
function calcularAvisos() {
  const h = hoy(), desde = add(h, -3), hasta = add(h, 30), out = [];
  const push = (id, fecha, titulo, cuerpo) => { if (fecha >= desde && fecha <= hasta) out.push({ id, fecha, titulo, cuerpo }); };
  for (const an of S.animales) {
    if (an.estado === "vendida") continue;
    const nom = an.arete + (an.nombre ? " " + an.nombre : "");
    const r = retiro(an.arete); if (r) push(`ret-${an.arete}-${r.retiroHasta}`, add(r.retiroHasta, 1), `${nom}: ya puede entregar su leche`, `Terminó el retiro de ${r.producto || "su tratamiento"}.`);
    if (["toro", "ternera"].includes(an.estado)) continue;
    const c = ciclo(an);
    if (c.fpp) {
      push(`pp3-${an.arete}-${c.fpp}`, add(c.fpp, -3), `${nom}: parto en 3 días`, `Fecha probable: ${fmt(c.fpp)}. Tenga listo el potrero de maternidad.`);
      push(`pp-${an.arete}-${c.fpp}`, c.fpp, `${nom}: hoy es la fecha probable de parto`, "Vigílela y registre el parto en la app.");
      if (an.estado === "lactancia") push(`sec-${an.arete}-${c.fpp}`, add(c.fpp, -SECADO), `${nom}: toca secarla`, `Faltan ${SECADO} días para el parto.`);
    } else if (c.ultServ && (!c.ultParto || c.ultServ.fecha > c.ultParto)) {
      push(`celo-${an.arete}-${c.ultServ.fecha}`, add(c.ultServ.fecha, 21), `${nom}: vigile si repite celo`, "Hoy se cumplen 21 días del servicio.");
      push(`dx-${an.arete}-${c.ultServ.fecha}`, add(c.ultServ.fecha, 40), `${nom}: diagnóstico de preñez`, "Ya puede programar palpación o ecografía.");
    }
  }
  estadoPotreros().forEach((p) => { if (p.estado === "descanso" && p.listoEn != null) push(`pot-${p.id}-${p.listoFecha}`, p.listoFecha, `Potrero ${p.nombre} listo`, `Cumplió ${p.descanso} días de descanso.`); });
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}
async function guardarAvisos() {
  if (memOnly) return;
  const lista = calcularAvisos(), viejo = S.config.find((c) => c.id === "avisos");
  if (viejo && JSON.stringify(viejo.lista) === JSON.stringify(lista)) return;
  await save("config", { id: "avisos", lista, calculado: new Date().toISOString() });
}
async function estadoAvisos() {
  const soporta = "Notification" in window && "serviceWorker" in navigator;
  let periodico = false, registrado = false;
  try { const reg = await navigator.serviceWorker.ready; periodico = "periodicSync" in reg; if (periodico) registrado = (await reg.periodicSync.getTags()).includes("hc-avisos"); } catch (e) {}
  return { soporta, permiso: soporta ? Notification.permission : "denied", periodico, registrado };
}
async function activarAvisos() {
  if (!("Notification" in window)) return toast("Este celular no permite avisos de esta app");
  const p = await Notification.requestPermission();
  if (p !== "granted") { toast("Sin permiso no se pueden mostrar avisos"); return render(); }
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      const st = await navigator.permissions.query({ name: "periodic-background-sync" }).catch(() => ({ state: "granted" }));
      if (st.state === "granted") await reg.periodicSync.register("hc-avisos", { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch (e) {}
  await guardarAvisos(); toast("Avisos activados"); render();
}
async function probarAviso() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const prox = calcularAvisos().find((a) => a.fecha >= hoy());
    await reg.showNotification(prox ? prox.titulo : "Hato Claro", { body: prox ? `${fmt(prox.fecha)} · ${prox.cuerpo}` : "Así le llegarán los avisos de partos, secados y retiros.", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "prueba" });
  } catch (e) { toast("No se pudo mostrar el aviso de prueba"); }
}

/* ---------- potreros: mapa, rotación y descanso ---------- */
const PASTOS = ["Kikuyo", "Kikuyo con raigrás", "Raigrás", "Pasto azul (orchoro)", "Avena forrajera", "Trébol y gramíneas", "Otro"];
const DESCANSO_DEF = 40, OCUPA_DEF = 3;
let leafletProm = null;
function cargarLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletProm) return leafletProm;
  leafletProm = new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css"; document.head.appendChild(css);
    const sc = document.createElement("script"); sc.src = "vendor/leaflet/leaflet.js";
    sc.onload = () => res(window.L); sc.onerror = () => { leafletProm = null; rej(new Error("sin mapa")); };
    document.head.appendChild(sc);
  });
  return leafletProm;
}
function capaSatelite(L) {
  return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" });
}
function areaHa(coords) {
  if (!coords || coords.length < 3) return null;
  const R = 6378137, rad = Math.PI / 180; let a = 0;
  for (let i = 0; i < coords.length; i++) {
    const [la1, lo1] = coords[i], [la2, lo2] = coords[(i + 1) % coords.length];
    a += (lo2 - lo1) * rad * (2 + Math.sin(la1 * rad) + Math.sin(la2 * rad));
  }
  return Math.abs((a * R * R) / 2) / 10000;
}
function distM(a, b) { const R = 6371000, rad = Math.PI / 180, dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const ocupAbiertas = () => S.ocupaciones.filter((o) => !o.salida);
function estadoPotreros() {
  const h = hoy();
  return S.potreros.map((p) => {
    const descanso = p.descanso || DESCANSO_DEF, ocupaMax = p.ocupaMax || OCUPA_DEF;
    const abiertas = S.ocupaciones.filter((o) => o.potreroId === p.id && !o.salida);
    const cerradas = S.ocupaciones.filter((o) => o.potreroId === p.id && o.salida).sort((a, b) => (a.salida < b.salida ? 1 : -1));
    const gastos90 = S.gastos.filter((g) => g.potreroId === p.id && g.fecha >= add(h, -90)).reduce((s, g) => s + g.valor, 0);
    const base = { ...p, descanso, ocupaMax, gastos90 };
    if (abiertas.length) {
      const entrada = abiertas.map((o) => o.entrada).sort()[0];
      const animales = [...new Set(abiertas.flatMap((o) => o.animales || []))];
      return { ...base, estado: "ocupado", dias: diff(h, entrada), entrada, animales, grupos: abiertas.map((o) => o.grupo).filter(Boolean), carga: p.area ? animales.length / p.area : null };
    }
    if (cerradas.length) {
      const salida = cerradas[0].salida, dias = diff(h, salida);
      return { ...base, estado: dias >= descanso ? "listo" : "descanso", dias, salida, listoFecha: add(salida, descanso), listoEn: Math.max(0, descanso - dias) };
    }
    return { ...base, estado: "sinuso" };
  });
}
const ESTADO_POT = { ocupado: ["Con ganado", "lact"], listo: ["Listo para entrar", "pren"], descanso: ["Descansando", "seca"], sinuso: ["Sin registro", ""] };
const COLOR_POT = { ocupado: "#2f6fa8", listo: "#2c7a3f", descanso: "#c98a1a", sinuso: "#8a8f86" };
function alertasPotreros() {
  const out = [], est = estadoPotreros();
  est.filter((p) => p.estado === "ocupado" && p.dias > p.ocupaMax).forEach((p) => out.push({ k: "", o: 11, h: `<span class="quien">Potrero ${esc(p.nombre)}</span><span>El ganado lleva ${p.dias} días ahí (lo recomendado para este potrero es ${p.ocupaMax}). ${est.some((x) => x.estado === "listo") ? `Ya está listo: ${est.filter((x) => x.estado === "listo").map((x) => esc(x.nombre)).join(", ")}.` : ""}</span>` }));
  if (!est.some((p) => p.estado === "ocupado" && p.dias > p.ocupaMax)) est.filter((p) => p.estado === "listo" && p.dias - p.descanso <= 7).forEach((p) => out.push({ k: "info", o: 12, h: `<span class="quien">Potrero ${esc(p.nombre)} listo</span><span>Lleva ${p.dias} días de descanso. Es buen momento para entrar con el ganado.</span>` }));
  return out;
}
function centroFinca() {
  const f = cfg(); if (f.lat && f.lng) return [f.lat, f.lng];
  const pts = S.potreros.flatMap((p) => p.coords || []); if (pts.length) return [avg(pts.map((x) => x[0])), avg(pts.map((x) => x[1]))];
  return [4.4277, -74.1513];
}

function vPotreros() {
  const el = $("#v-potreros"), est = estadoPotreros();
  const orden = { ocupado: 0, listo: 1, descanso: 2, sinuso: 3 };
  est.sort((a, b) => orden[a.estado] - orden[b.estado] || (a.listoEn ?? 0) - (b.listoEn ?? 0) || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  const total = est.reduce((s, p) => s + (p.area || 0), 0), conMapa = est.some((p) => p.coords && p.coords.length > 2);
  el.innerHTML = `
    <div class="row spread"><h2>Potreros${est.length ? " · " + est.length : ""}</h2><div class="row"><button class="btn ghost sm" id="poMover" type="button" ${est.length ? "" : "disabled"}>Mover ganado</button><button class="btn sm" id="poNuevo" type="button">+ Potrero</button></div></div>
    ${est.length ? `<div class="kpis">
      <div class="kpi"><span class="eyebrow">Área</span><b>${total ? nf(total, 1) + " ha" : "–"}</b><span class="small muted">${est.filter((p) => !p.area).length ? est.filter((p) => !p.area).length + " sin área" : "&nbsp;"}</span></div>
      <div class="kpi"><span class="eyebrow">Listos para entrar</span><b>${est.filter((p) => p.estado === "listo").length}</b><span class="small muted">${est.filter((p) => p.estado === "descanso").length} descansando</span></div>
    </div>` : ""}
    ${conMapa ? `<div class="panel" style="padding:0;overflow:hidden"><div id="poMapa" style="height:280px;background:var(--sunk)"></div></div>` : ""}
    <div class="lista">${est.length ? est.map((p) => `<button class="card" type="button" data-p="${esc(p.id)}">
      <div class="row spread"><h3>${esc(p.nombre)}</h3><span class="chip ${ESTADO_POT[p.estado][1]}">${ESTADO_POT[p.estado][0]}</span></div>
      <div class="facts small muted">
        <div>Área<b>${p.area ? nf(p.area, 2) + " ha" : "–"}</b></div>
        ${p.estado === "ocupado" ? `<div>Días con ganado<b>${p.dias}</b></div><div>Animales<b>${p.animales.length}${p.carga ? ` · ${nf(p.carga, 1)}/ha` : ""}</b></div>`
        : p.estado === "descanso" ? `<div>Descanso<b>${p.dias} de ${p.descanso} días</b></div><div>Listo<b>${fmt(p.listoFecha)}</b></div>`
        : p.estado === "listo" ? `<div>Descanso<b>${p.dias} días</b></div><div>Pasto<b>${esc(p.pasto || "–")}</b></div>`
        : `<div>Pasto<b>${esc(p.pasto || "–")}</b></div><div>Descanso meta<b>${p.descanso} días</b></div>`}
      </div>
      ${p.estado === "descanso" ? `<div class="qbar"><i style="width:${Math.min(100, (p.dias / p.descanso) * 100)}%;background:var(--amber)"></i></div>` : ""}
    </button>`).join("") : `<div class="empty">Registre sus potreros para llevar la rotación: dónde está el ganado, cuántos días lleva descansando cada uno y cuándo está listo.<button class="btn" type="button" id="poNuevo2">Agregar el primer potrero</button></div>`}</div>
    ${est.length ? `<p class="small muted">Días de descanso meta: en kikuyo de la Sabana se usan entre 35 y 45 días según la época de lluvias; ajústelos en cada potrero.</p>` : ""}`;
  $("#poNuevo").onclick = () => formPotrero();
  const n2 = $("#poNuevo2"); if (n2) n2.onclick = () => formPotrero();
  $("#poMover").onclick = () => moverGanado();
  $$("[data-p]", el).forEach((b) => (b.onclick = () => detallePotrero(b.dataset.p)));
  if (conMapa) cargarLeaflet().then((L) => {
    const div = $("#poMapa"); if (!div || div._mapa) return;
    const map = L.map(div, { zoomControl: true, attributionControl: true }); div._mapa = map;
    capaSatelite(L).addTo(map);
    const grupo = L.featureGroup().addTo(map);
    est.filter((p) => p.coords && p.coords.length > 2).forEach((p) => {
      L.polygon(p.coords, { color: "#fff", weight: 2, fillColor: COLOR_POT[p.estado], fillOpacity: 0.45 }).addTo(grupo)
        .bindTooltip(`${p.nombre} · ${ESTADO_POT[p.estado][0]}`, { permanent: true, direction: "center", className: "poEtq" }).on("click", () => detallePotrero(p.id));
    });
    map.fitBounds(grupo.getBounds(), { padding: [20, 20], maxZoom: 18 });
  }).catch(() => { const d = $("#poMapa"); if (d) d.innerHTML = `<p class="small muted" style="padding:16px">El mapa necesita señal para cargar.</p>`; });
}

function detallePotrero(id) {
  const p = estadoPotreros().find((x) => x.id === id); if (!p) return;
  const hist = S.ocupaciones.filter((o) => o.potreroId === id).sort((a, b) => (a.entrada < b.entrada ? 1 : -1)).slice(0, 12);
  const gastos = S.gastos.filter((g) => g.potreroId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 8);
  sheet(cab(esc(p.nombre)) + `
    <div><span class="chip ${ESTADO_POT[p.estado][1]}">${ESTADO_POT[p.estado][0]}</span></div>
    <div class="facts small muted"><div>Área<b>${p.area ? nf(p.area, 2) + " ha" : "–"}</b></div><div>Pasto<b>${esc(p.pasto || "–")}</b></div><div>Descanso meta<b>${p.descanso} días</b></div>
      ${p.estado === "ocupado" ? `<div>Con ganado desde<b>${fmt(p.entrada)}</b></div><div>Animales<b>${p.animales.length}</b></div><div>Carga<b>${p.carga ? nf(p.carga, 1) + "/ha" : "–"}</b></div>` : ""}
      ${p.estado === "descanso" || p.estado === "listo" ? `<div>Salió el ganado<b>${fmt(p.salida)}</b></div><div>Días de descanso<b>${p.dias}</b></div><div>Listo<b>${p.estado === "listo" ? "ya" : fmt(p.listoFecha)}</b></div>` : ""}
    </div>
    ${p.estado === "ocupado" && p.grupos.length ? `<p class="small">Grupo: ${esc(p.grupos.join(", "))}<br><span class="muted">${p.animales.map(esc).join(", ")}</span></p>` : ""}
    <div class="acciones">
      <button class="accion" type="button" data-x="mover"><b>Mover ganado aquí</b></button>
      ${p.estado === "ocupado" ? `<button class="accion" type="button" data-x="sacar"><b>Sacar el ganado</b></button>` : ""}
      <button class="accion" type="button" data-x="abono"><b>Registrar abono o arreglo</b></button>
      <button class="accion" type="button" data-x="mapa"><b>${p.coords && p.coords.length > 2 ? "Redibujar en el mapa" : "Dibujar en el mapa"}</b></button>
    </div>
    ${hist.length ? `<div><span class="eyebrow">Rotación</span><div class="tablewrap"><table><tr><th>Entró</th><th>Salió</th><th class="r">Días</th><th>Grupo</th></tr>${hist.map((o) => `<tr><td>${fmt(o.entrada)}</td><td>${o.salida ? fmt(o.salida) : "—"}</td><td class="r">${diff(o.salida || hoy(), o.entrada)}</td><td>${esc(o.grupo || "")} (${(o.animales || []).length})</td></tr>`).join("")}</table></div></div>` : ""}
    ${gastos.length ? `<div><span class="eyebrow">Gastos del potrero</span><div class="tablewrap"><table>${gastos.map((g) => `<tr><td>${fmt(g.fecha)}</td><td>${esc(g.descripcion || g.categoria)}</td><td class="r">${pesos(g.valor)}</td></tr>`).join("")}</table></div></div>` : ""}
    <div class="row"><button class="btn ghost sm" type="button" data-x="editar">Editar</button><button class="btn ghost sm" type="button" data-x="borrar">Eliminar</button></div>`, (s) => {
    $$("[data-x]", s).forEach((b) => (b.onclick = function () {
      const x = b.dataset.x, pot = S.potreros.find((y) => y.id === id);
      if (x === "mover") moverGanado(id);
      else if (x === "sacar") guardarYcerrar(async () => { for (const o of S.ocupaciones.filter((o) => o.potreroId === id && !o.salida)) await save("ocupaciones", { ...o, salida: hoy() }); }, "Ganado fuera del potrero");
      else if (x === "abono") formGasto(null, { categoria: "Fertilizantes y potreros", potreroId: id, descripcion: "Abono " + pot.nombre });
      else if (x === "mapa") dibujarPotrero(pot);
      else if (x === "editar") formPotrero(pot);
      else if (x === "borrar") confirmar(this, "Toque otra vez para eliminar", () => guardarYcerrar(async () => { for (const o of S.ocupaciones.filter((o) => o.potreroId === id)) await del("ocupaciones", o.id); await del("potreros", id); }, "Potrero eliminado"));
    }));
  });
}

function formPotrero(p, coordsNuevas) {
  const x = { descanso: DESCANSO_DEF, ocupaMax: OCUPA_DEF, pasto: "Kikuyo", ...(p || {}) };
  if (coordsNuevas) { x.coords = coordsNuevas; x.area = Math.round(areaHa(coordsNuevas) * 100) / 100; }
  sheet(cab(p && p.id ? "Editar potrero" : "Nuevo potrero") + `
    <form id="fPo" class="grid2">
      <label class="f full">Nombre<input id="poN" value="${esc(x.nombre || "")}" placeholder="Ej. El bajo, Potrero 3" required autocomplete="off"></label>
      <label class="f">Pasto<select id="poP">${PASTOS.map((t) => `<option${t === x.pasto ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="f">Área (hectáreas)<input id="poA" inputmode="decimal" value="${x.area != null ? nf(x.area, 2) : ""}" placeholder="Ej. 1,5"></label>
      <label class="f">Días de descanso meta<input id="poD" inputmode="numeric" value="${x.descanso}"></label>
      <label class="f">Días máximos con ganado<input id="poO" inputmode="numeric" value="${x.ocupaMax}"></label>
      ${x.coords && x.coords.length > 2 ? `<p class="small muted full">Dibujado en el mapa: ${x.coords.length} puntos · ${nf(areaHa(x.coords), 2)} ha.</p>` : `<p class="small muted full">Si no sabe el área, guárdelo y luego dibújelo en el mapa: la app la calcula.</p>`}
      <button class="btn full" type="submit">Guardar potrero</button>
      <button class="btn ghost full" type="button" id="poMapaB">${x.coords && x.coords.length > 2 ? "Redibujar en el mapa" : "Dibujar en el mapa"}</button>
    </form>`, (s) => {
    const datos = () => ({ ...x, id: x.id || uid(), nombre: $("#poN", s).value.trim(), pasto: $("#poP", s).value, area: pn($("#poA", s).value), descanso: pint($("#poD", s).value) || DESCANSO_DEF, ocupaMax: pint($("#poO", s).value) || OCUPA_DEF });
    $("#fPo", s).onsubmit = (ev) => { ev.preventDefault(); const d = datos(); if (!d.nombre) return toast("Póngale un nombre al potrero"); guardarYcerrar(() => save("potreros", d), "Potrero guardado"); };
    $("#poMapaB", s).onclick = () => { const d = datos(); if (!d.nombre) d.nombre = "Potrero nuevo"; dibujarPotrero(d); };
  });
}

let vigilaGPS = null;
function dibujarPotrero(p) {
  const pts = [];
  sheet(cab("Dibujar " + esc(p.nombre)) + `
    <div class="opciones"><button type="button" class="chipbtn" data-m="tocar" aria-pressed="true">Tocar el mapa</button><button type="button" class="chipbtn" data-m="caminar" aria-pressed="false">Caminar el borde con el GPS</button></div>
    <p class="small muted" id="dAyuda">Toque cada esquina del potrero en el mapa, en orden.</p>
    <div id="dMapa" style="height:55vh;border-radius:12px;overflow:hidden;background:var(--sunk)"></div>
    <div class="row spread"><span class="small"><b id="dPts">0</b> puntos · <b id="dArea">–</b></span><span class="row"><button class="btn ghost sm" type="button" id="dUndo">Deshacer</button><button class="btn sm" type="button" id="dOk">Terminar</button></span></div>`, (s) => {
    let modo = "tocar", map, poly, marcas;
    const pintar = () => { $("#dPts", s).textContent = pts.length; const a = areaHa(pts); $("#dArea", s).textContent = a ? nf(a, 2) + " ha" : "–"; if (poly) poly.setLatLngs(pts); if (marcas) { marcas.clearLayers(); pts.forEach((q) => window.L.circleMarker(q, { radius: 5, color: "#fff", weight: 2, fillColor: "#1f6b45", fillOpacity: 1 }).addTo(marcas)); } };
    const pararGPS = () => { if (vigilaGPS != null) { navigator.geolocation.clearWatch(vigilaGPS); vigilaGPS = null; } };
    cargarLeaflet().then((L) => {
      const div = $("#dMapa", s); if (!div) return;
      map = L.map(div); capaSatelite(L).addTo(map);
      const ex = p.coords && p.coords.length > 2 ? p.coords : null;
      if (ex) map.fitBounds(L.latLngBounds(ex), { padding: [30, 30] }); else map.setView(centroFinca(), 16);
      S.potreros.filter((o) => o.id !== p.id && o.coords && o.coords.length > 2).forEach((o) => L.polygon(o.coords, { color: "#fff", weight: 1, fillOpacity: 0.15 }).addTo(map).bindTooltip(o.nombre));
      poly = L.polygon([], { color: "#fff", weight: 2, fillColor: "#1f6b45", fillOpacity: 0.35 }).addTo(map); marcas = L.layerGroup().addTo(map);
      map.on("click", (e) => { if (modo === "tocar") { pts.push([e.latlng.lat, e.latlng.lng]); pintar(); } });
      if (!ex && navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 17), () => {}, { enableHighAccuracy: true, timeout: 8000 });
    }).catch(() => { $("#dMapa", s).innerHTML = `<p class="small muted" style="padding:16px">El mapa necesita señal. Puede escribir el área a mano en el potrero.</p>`; });
    $$("[data-m]", s).forEach((b) => (b.onclick = () => {
      modo = b.dataset.m; $$("[data-m]", s).forEach((y) => y.setAttribute("aria-pressed", y === b)); pararGPS();
      if (modo === "caminar") {
        if (!navigator.geolocation) return toast("Este celular no deja usar el GPS desde la app");
        $("#dAyuda", s).textContent = "Camine por el borde del potrero con el celular en la mano. Se marca un punto cada pocos metros. Toque Terminar al volver al inicio.";
        vigilaGPS = navigator.geolocation.watchPosition((pos) => {
          const q = [pos.coords.latitude, pos.coords.longitude]; if (pos.coords.accuracy > 25) return;
          if (!pts.length || distM(pts[pts.length - 1], q) >= 4) { pts.push(q); pintar(); if (map) map.panTo(q); }
        }, () => toast("Active la ubicación del celular para caminar el borde"), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      } else $("#dAyuda", s).textContent = "Toque cada esquina del potrero en el mapa, en orden.";
    }));
    $("#dUndo", s).onclick = () => { pts.pop(); pintar(); };
    $("#dOk", s).onclick = () => { pararGPS(); if (pts.length < 3) return toast("Marque al menos 3 puntos"); formPotrero(p, pts.map((q) => [Math.round(q[0] * 1e7) / 1e7, Math.round(q[1] * 1e7) / 1e7])); };
    const obs = new MutationObserver(() => { if (!document.body.contains(s)) { pararGPS(); obs.disconnect(); } }); obs.observe($("#sheetHost"), { childList: true });
  });
}

function moverGanado(destino) {
  const vivos = activos(); if (!vivos.length) return faltanAnimales();
  if (!S.potreros.length) return formPotrero();
  const est = estadoPotreros();
  const GRUPOS = { lactancia: "En ordeño", seca: "Secas", novilla: "Novillas", ternera: "Terneras/os" };
  const selA = selectorAnimales(vivos, { multi: true, atajos: true });
  sheet(cab("Mover ganado") + `
    <form id="fMv" class="stack">
      <label class="f">¿A cuál potrero?<select id="mvP">${est.map((p) => `<option value="${esc(p.id)}"${p.id === destino ? " selected" : ""}>${esc(p.nombre)} · ${p.estado === "listo" ? "listo" : p.estado === "descanso" ? `descansando ${p.dias}/${p.descanso} días` : p.estado === "ocupado" ? "con ganado" : "sin registro"}</option>`).join("")}</select></label>
      <div><span class="small muted" style="font-weight:700">¿Qué grupo?</span><div class="opciones" style="margin-top:6px">${Object.entries(GRUPOS).filter(([k]) => vivos.some((a) => a.estado === k)).map(([k, v]) => `<button type="button" class="chipbtn" data-g="${k}" aria-pressed="false">${v} (${vivos.filter((a) => a.estado === k).length})</button>`).join("")}<button type="button" class="chipbtn" data-g="elegir" aria-pressed="false">Elegir animales</button></div></div>
      <div id="mvSel" hidden>${selA.html}</div>
      <label class="f">Fecha<input type="date" id="mvF" value="${hoy()}" max="${hoy()}"></label>
      <p class="small muted" id="mvInfo"></p>
      <button class="btn" type="submit">Mover</button>
    </form>`, (s) => {
    selA.init(s); let grupo = null;
    const info = () => { const p = est.find((x) => x.id === $("#mvP", s).value); $("#mvInfo", s).textContent = p && p.estado === "descanso" ? `Ojo: ${p.nombre} lleva ${p.dias} de ${p.descanso} días de descanso. Entrar antes debilita el pasto.` : ""; };
    $("#mvP", s).onchange = info; info();
    $$("[data-g]", s).forEach((b) => (b.onclick = () => { grupo = b.dataset.g; $$("[data-g]", s).forEach((y) => y.setAttribute("aria-pressed", y === b)); $("#mvSel", s).hidden = grupo !== "elegir"; }));
    $("#fMv", s).onsubmit = (ev) => { ev.preventDefault();
      if (!grupo) return toast("Elija qué grupo va a mover");
      const aretes = grupo === "elegir" ? selA.get() : vivos.filter((a) => a.estado === grupo).map((a) => a.arete);
      if (!aretes.length) return toast("No hay animales en ese grupo");
      const destinoId = $("#mvP", s).value, fecha = $("#mvF", s).value, nombreG = grupo === "elegir" ? "Varios" : GRUPOS[grupo];
      guardarYcerrar(async () => {
        for (const o of ocupAbiertas().filter((o) => (o.animales || []).some((a) => aretes.includes(a)))) {
          const resto = o.animales.filter((a) => !aretes.includes(a));
          await save("ocupaciones", { ...o, salida: fecha });
          if (resto.length) await save("ocupaciones", { id: uid(), potreroId: o.potreroId, grupo: o.grupo, animales: resto, entrada: fecha, salida: null });
        }
        await save("ocupaciones", { id: uid(), potreroId: destinoId, grupo: nombreG, animales: aretes, entrada: fecha, salida: null });
      }, `${aretes.length} animales movidos a ${S.potreros.find((p) => p.id === destinoId).nombre}`);
    };
  });
}

/* ---------- salud: revisión de síntomas y enfermedades de la zona ---------- */
const HS = () => window.HC_SALUD;
function vSalud(el) {
  const H = HS(); if (!H) { el.innerHTML = `<div class="empty">No se pudo cargar la información de salud.</div>`; return; }
  const revisiones = S.eventos.filter((e) => e.tipo === "salud").sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 8);
  el.innerHTML = `
    <div class="panel stack">
      <h3>¿Tiene un animal enfermo?</h3>
      <p class="small muted">Marque lo que ve y la app le muestra las causas más probables, qué hacer ya y qué tan rápido llamar al veterinario.</p>
      <button class="btn" type="button" id="saRev">Revisar síntomas</button>
    </div>
    ${revisiones.length ? `<div class="panel stack"><h3>Revisiones recientes</h3>${revisiones.map((e) => `<div class="small"><b>${fmt(e.fecha)}</b> · <span class="tag">${esc(e.arete)}</span> ${esc((e.posibles || []).slice(0, 2).join(", ") || "sin coincidencias")}</div>`).join("")}</div>` : ""}
    <div class="stack"><h3>Enfermedades comunes en la zona</h3>
      <div class="lista">${H.ENF.map((e) => `<button class="card" type="button" data-en="${e.id}"><div class="row spread"><b>${esc(e.n)}</b><span class="chip ${e.urg === "urgente" ? "retiro" : e.urg === "pronto" ? "seca" : ""}">${e.urg === "urgente" ? "Urgente" : e.urg === "pronto" ? "Pronto" : "Vigilar"}</span></div><span class="small muted">${esc(e.tipo)}${e.zoo ? " · pasa a personas" : ""}</span></button>`).join("")}</div>
    </div>
    <p class="small muted">${esc(H.fuente)}</p>`;
  $("#saRev").onclick = () => formSintomas();
  $$("[data-en]", el).forEach((b) => (b.onclick = () => fichaEnfermedad(b.dataset.en)));
}
function fichaEnfermedad(id, extra = "") {
  const H = HS(), e = H.ENF.find((x) => x.id === id); if (!e) return;
  const u = H.URGENCIA[e.urg];
  sheet(cab(esc(e.n)) + `
    ${extra}
    <div class="alerta ${u[1]}"><span class="quien">${u[0]}</span><span>${esc(e.tipo)}${e.ica ? " · Enfermedad que se reporta al ICA" : ""}${e.zoo ? " · Puede pasar a las personas" : ""}</span></div>
    <p>${esc(e.r)}</p>
    <p class="small muted">${esc(e.zona)}</p>
    <div><span class="eyebrow">Señales</span><p class="small">${Object.keys(e.s).map((k) => esc((H.SINTOMAS.find((s) => s.id === k) || {}).t || k)).join(" · ")}</p></div>
    <div><span class="eyebrow">Qué hacer ahora</span><ul class="small" style="margin:6px 0 0;padding-left:20px">${e.hacer.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    <div><span class="eyebrow">Cómo prevenirla</span><ul class="small" style="margin:6px 0 0;padding-left:20px">${e.prev.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    <p class="small muted">Orientación general: el diagnóstico y el tratamiento los define el médico veterinario. Respete siempre los días de retiro de la leche.</p>`);
}
function formSintomas(arete) {
  const H = HS(); if (!H) return toast("No se pudo cargar la información de salud");
  const vivos = activos();
  const selA = vivos.length ? selectorAnimales(vivos, { sel: arete ? [arete] : [] }) : null;
  const grupos = [...new Set(H.SINTOMAS.map((s) => s.g))];
  sheet(cab("Revisar síntomas") + `
    <div class="alerta info"><span class="quien">Solo es una orientación</span><span>No reemplaza al veterinario. Ante un animal caído, con convulsiones o con ampollas, llame de una vez.</span></div>
    ${selA ? `<div><span class="small muted" style="font-weight:700">¿Cuál animal? (opcional, ayuda a acertar)</span>${selA.html}</div>` : ""}
    ${grupos.map((g) => `<div><span class="eyebrow">${esc(g)}</span><div class="opciones" style="margin-top:6px">${H.SINTOMAS.filter((s) => s.g === g).map((s) => `<button type="button" class="chipbtn" data-si="${s.id}" aria-pressed="false">${esc(s.t)}</button>`).join("")}</div></div>`).join("")}
    <div><span class="eyebrow">Lo que pasa en la finca</span><div class="opciones" style="margin-top:6px">${H.CONTEXTO.map((c) => `<button type="button" class="chipbtn" data-cx="${c.id}" aria-pressed="false">${esc(c.t)}</button>`).join("")}</div></div>
    <button class="btn" type="button" id="siVer">Ver posibles causas</button>`, (s) => {
    if (selA) selA.init(s);
    const marcados = new Set(), ctx = new Set();
    $$("[data-si]", s).forEach((b) => (b.onclick = () => { marcados.has(b.dataset.si) ? marcados.delete(b.dataset.si) : marcados.add(b.dataset.si); b.setAttribute("aria-pressed", marcados.has(b.dataset.si)); }));
    $$("[data-cx]", s).forEach((b) => (b.onclick = () => { ctx.has(b.dataset.cx) ? ctx.delete(b.dataset.cx) : ctx.add(b.dataset.cx); b.setAttribute("aria-pressed", ctx.has(b.dataset.cx)); }));
    $("#siVer", s).onclick = () => {
      if (!marcados.size) return toast("Marque al menos un síntoma");
      const ar = selA ? selA.get()[0] : null, an = ar ? S.animales.find((x) => x.arete === ar) : null;
      const c = an ? ciclo(an) : null;
      const ternero = an ? (an.estado === "ternera" || (an.nacimiento && diff(hoy(), an.nacimiento) < 180)) : null;
      const diasPosparto = c && c.ultParto ? diff(hoy(), c.ultParto) : null;
      resultadoSintomas({ arete: ar, sintomas: [...marcados], contexto: [...ctx], diasPosparto, ternero });
    };
  });
}
function resultadoSintomas(q) {
  const H = HS(), r = H.diagnosticar(q);
  const nombreS = (id) => (H.SINTOMAS.find((s) => s.id === id) || {}).t || id;
  sheet(cab("Posibles causas") + `
    ${q.arete ? `<p class="small muted">Animal <span class="tag">${esc(q.arete)}</span>${q.diasPosparto != null ? ` · ${q.diasPosparto} días de parida` : ""}${q.ternero ? " · ternero" : ""}</p>` : ""}
    ${r.alarmas.map((a) => `<div class="alerta bad"><span class="quien">Atención</span><span>${esc(a)}</span></div>`).join("")}
    ${r.posibles.length ? r.posibles.map((p, i) => { const u = H.URGENCIA[p.e.urg]; return `<button class="card" type="button" data-en="${p.e.id}">
        <div class="row spread"><b>${i + 1}. ${esc(p.e.n)}</b><span class="chip ${p.pct >= 70 ? "pren" : p.pct >= 40 ? "seca" : ""}">${p.pct >= 70 ? "Coincide mucho" : p.pct >= 40 ? "Coincide en parte" : "Posible"}</span></div>
        <span class="small">${esc(p.e.r)}</span>
        <span class="small muted">Coincide en: ${p.coincide.map((x) => esc(nombreS(x).toLowerCase())).join(", ")}</span>
        <span class="small" style="color:var(${p.e.urg === "urgente" ? "--bad" : "--fg"});font-weight:700">${u[0]}${p.e.ica ? " · avisar al ICA" : ""}</span>
      </button>`; }).join("")
      : `<div class="empty">Con esos síntomas no encontramos una causa clara en la base. Consulte al veterinario y describa lo que ve.</div>`}
    <p class="small muted">Toque cada una para ver qué hacer ahora y cómo prevenirla. ${esc(H.fuente)}</p>
    <div class="row"><button class="btn" type="button" id="reG">${q.arete ? "Guardar en el historial" : "Listo"}</button><button class="btn ghost" type="button" id="reV">Cambiar síntomas</button></div>`, (s) => {
    $$("[data-en]", s).forEach((b) => (b.onclick = () => fichaEnfermedad(b.dataset.en, `<button class="btn ghost sm" type="button" id="feVolver">← Volver a los resultados</button>`) || (setTimeout(() => { const v = $("#feVolver"); if (v) v.onclick = () => resultadoSintomas(q); }, 0))));
    $("#reV", s).onclick = () => formSintomas(q.arete);
    $("#reG", s).onclick = () => { if (!q.arete) return cerrar();
      guardarYcerrar(() => save("eventos", { id: uid(), arete: q.arete, tipo: "salud", fecha: hoy(), sintomas: q.sintomas.map(nombreS), posibles: r.posibles.map((p) => p.e.n), nota: "Revisión de síntomas: " + q.sintomas.map(nombreS).join(", ") }), "Guardado en el historial"); };
  });
}

/* ---------- nube: cuenta, varias personas y sincronización (Supabase) ---------- */
let NUBE_CONF = null, cliente = null, sesion = null, sincronizando = false, timerSync = null;
const ROLES = { dueno: "Dueño", ordenador: "Ordeñador", veterinario: "Veterinario" };
const nubeCfg = () => ({ fincaId: null, fincaNombre: "", rol: null, ultimoPull: null, ultimaSync: null, error: null, ...(S.config.find((c) => c.id === "nube") || {}), id: "nube" });
const nubeActiva = () => !!(NUBE_CONF && sesion && nubeCfg().fincaId);
const puedeVerPlata = () => !nubeActiva() || nubeCfg().rol === "dueno" || !nubeCfg().rol;
async function guardarNube(cambios) { await save("config", { ...nubeCfg(), ...cambios }, { remoto: true }); }
async function cargarConfNube() {
  if (window.__HC_REMOTO) { NUBE_CONF = { prueba: true }; return; }
  try { const r = await fetch("nube.json", { cache: "no-cache" }); if (r.ok) { const d = await r.json(); if (d && d.url && d.anonKey) NUBE_CONF = d; } } catch (e) {}
}
function cargarSupabase() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "vendor/supabase.js"; sc.onload = () => res(window.supabase); sc.onerror = () => rej(new Error("sin conexión")); document.head.appendChild(sc); });
}
/* Adaptador: todo lo que la app le pide al servidor pasa por aquí */
async function remoto() {
  if (window.__HC_REMOTO) return window.__HC_REMOTO;
  if (!NUBE_CONF) throw new Error("La nube no está configurada");
  if (!cliente) { const sb = await cargarSupabase(); cliente = sb.createClient(NUBE_CONF.url, NUBE_CONF.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "hato-claro-sesion" } }); }
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
    async quitar(fincaId, userId) { ok(await c.rpc("quitar_miembro", { f: fincaId, u: userId })); },
    async subir(filas) { ok(await c.from("registros").upsert(filas, { onConflict: "finca_id,coleccion,id" })); },
    async bajar(fincaId, desde) { let q = c.from("registros").select("coleccion,id,datos,borrado,actualizado").eq("finca_id", fincaId).order("actualizado", { ascending: true }).limit(1000); if (desde) q = q.gt("actualizado", desde); return ok(await q) || []; },
  };
}
async function iniciarNube() {
  await cargarConfNube(); if (!NUBE_CONF) return;
  try { const r = await remoto(); sesion = await r.sesion(); } catch (e) { sesion = null; }
  if (nubeActiva()) { sincronizar(); setInterval(() => sincronizar(), 3 * 60 * 1000); window.addEventListener("online", () => sincronizar()); }
}
function programarSync() { clearTimeout(timerSync); timerSync = setTimeout(() => sincronizar(), 4000); }
async function leerCola() { return memOnly ? [] : (await tx("cola", "readonly", (st) => st.getAll())) || []; }
async function sincronizar({ silencioso = true } = {}) {
  if (!nubeActiva() || sincronizando) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  sincronizando = true; let cambios = 0;
  try {
    const r = await remoto(), n = nubeCfg(), finca = n.fincaId;
    // 1. subir lo pendiente
    const cola = await leerCola();
    for (let i = 0; i < cola.length; i += 200) {
      const lote = cola.slice(i, i + 200);
      const filas = lote.map((q) => { const doc = S[q.col] && S[q.col].find((x) => x.id === q.docId); return { finca_id: finca, coleccion: q.col, id: q.docId, datos: doc && !q.borrado ? doc : {}, borrado: q.borrado || !doc }; });
      await r.subir(filas);
      await tx("cola", "readwrite", (st) => lote.forEach((q) => st.delete(q.id)));
    }
    // 2. bajar lo nuevo (con 2 minutos de traslape para no perder cambios simultáneos)
    const pendientes = new Set((await leerCola()).map((q) => q.id));
    let desde = n.ultimoPull ? new Date(new Date(n.ultimoPull).getTime() - 120000).toISOString() : null, ultimo = n.ultimoPull;
    for (let vuelta = 0; vuelta < 50; vuelta++) {
      const filas = await r.bajar(finca, desde);
      for (const f of filas) {
        if (!COLS.includes(f.coleccion) || !sincroniza(f.coleccion, f.id) || pendientes.has(f.coleccion + "|" + f.id)) continue;
        const local = S[f.coleccion].find((x) => x.id === f.id);
        if (f.borrado) { if (local) { await del(f.coleccion, f.id, { remoto: true }); cambios++; } }
        else if (!local || JSON.stringify(local) !== JSON.stringify({ ...f.datos, id: f.id })) { await save(f.coleccion, { ...f.datos, id: f.id }, { remoto: true }); cambios++; }
      }
      if (filas.length) { ultimo = filas[filas.length - 1].actualizado; desde = ultimo; }
      if (filas.length < 1000) break;
    }
    await guardarNube({ ultimoPull: ultimo, ultimaSync: new Date().toISOString(), error: null });
  } catch (e) {
    await guardarNube({ error: String(e.message || e) });
    if (!silencioso) toast("No se pudo sincronizar: " + (e.message || e));
  } finally { sincronizando = false; }
  if (cambios || vista === "mas") render();
  return cambios;
}
async function encolarTodo() {
  if (memOnly) return;
  await tx("cola", "readwrite", (st) => COLS.forEach((c) => S[c].forEach((d) => sincroniza(c, d.id) && st.put({ id: c + "|" + d.id, col: c, docId: d.id, borrado: false }))));
}
async function conectarFinca(f, modo) {
  // modo: "subir" (esta finca local va a la nube), "bajar" (reemplazar lo local con lo de la nube)
  if (modo === "bajar") await vaciarTodo(CONFIG_LOCAL);
  await guardarNube({ fincaId: f.id, fincaNombre: f.nombre, rol: f.rol, ultimoPull: null, error: null });
  if (modo === "subir") await encolarTodo();
  await sincronizar({ silencioso: false });
}

function panelNube() {
  if (!NUBE_CONF) return `<div class="panel stack"><h2>Varios celulares y personas</h2>
      <p class="muted">Para que el ordeñador registre en la finca y usted vea todo desde otro celular, hace falta activar el servidor de Hato Claro. Todavía no está configurado.</p></div>`;
  const n = nubeCfg();
  if (!sesion) return `<div class="panel stack"><h2>Varios celulares y personas</h2>
      <p class="muted">Entre con su correo para guardar la finca en la nube, verla en varios celulares e invitar al ordeñador o al veterinario.</p>
      <button class="btn" type="button" id="nuEntrar">Entrar con mi correo</button></div>`;
  if (!n.fincaId) return `<div class="panel stack"><h2>Varios celulares y personas</h2>
      <p class="muted">Entró como <b>${esc(sesion.email)}</b>. Falta conectar esta app con una finca.</p>
      <button class="btn" type="button" id="nuFinca">Conectar finca</button>
      <button class="btn ghost" type="button" id="nuSalir">Salir de la cuenta</button></div>`;
  return `<div class="panel stack"><h2>Finca en la nube</h2>
      <div class="facts small muted"><div>Finca<b>${esc(n.fincaNombre)}</b></div><div>Su rol<b>${esc(ROLES[n.rol] || n.rol || "–")}</b></div><div>Última vez<b>${n.ultimaSync ? new Date(n.ultimaSync).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" }) : "–"}</b></div></div>
      ${n.error ? `<p class="small" style="color:var(--bad)">Último intento con error: ${esc(n.error)}</p>` : `<p class="small muted">Los cambios se envían solos cuando hay señal.</p>`}
      <button class="btn" type="button" id="nuSync">Sincronizar ahora</button>
      ${n.rol === "dueno" ? `<button class="btn ghost" type="button" id="nuInvitar">Invitar a alguien</button>` : ""}
      <button class="btn ghost" type="button" id="nuMiembros">Ver quiénes están</button>
      <button class="btn ghost" type="button" id="nuSalir">Salir de la cuenta</button>
      <p class="small muted">${esc(sesion.email)}</p></div>`;
}
function enlazarNube(el) {
  const b = (id, fn) => { const x = $(id, el); if (x) x.onclick = fn; };
  b("#nuEntrar", formEntrar); b("#nuFinca", elegirFinca); b("#nuSync", async () => { const c = await sincronizar({ silencioso: false }); toast(c ? `${c} cambios recibidos` : "Todo al día"); });
  b("#nuInvitar", formInvitar); b("#nuMiembros", verMiembros);
  b("#nuSalir", async function () { confirmar(this, "Toque otra vez para salir", async () => { try { await (await remoto()).salir(); } catch (e) {} sesion = null; await guardarNube({ fincaId: null, fincaNombre: "", rol: null, ultimoPull: null }); if (!memOnly) await tx("cola", "readwrite", (st) => st.clear()); toast("Salió de la cuenta. Los datos siguen en este celular."); render(); }); });
}
function formEntrar() {
  sheet(cab("Entrar con su correo") + `
    <p class="small muted">Le enviamos un código de 6 números a su correo. No necesita contraseña.</p>
    <form id="fEn" class="stack"><label class="f">Correo<input id="enM" type="email" autocomplete="email" required placeholder="nombre@correo.com"></label><button class="btn" type="submit">Enviarme el código</button></form>
    <form id="fCo" class="stack" hidden><label class="f">Código que le llegó<input id="enC" class="big" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000"></label><button class="btn" type="submit">Entrar</button><p class="small muted">Si no le llega en un par de minutos, revise la carpeta de spam.</p></form>`, (s) => {
    let email = "";
    $("#fEn", s).onsubmit = async (ev) => { ev.preventDefault(); email = $("#enM", s).value.trim().toLowerCase();
      try { await (await remoto()).enviarCodigo(email); $("#fEn", s).hidden = true; $("#fCo", s).hidden = false; $("#enC", s).focus(); } catch (e) { toast("No se pudo enviar el código: " + e.message); } };
    $("#fCo", s).onsubmit = async (ev) => { ev.preventDefault();
      try { sesion = await (await remoto()).verificarCodigo(email, $("#enC", s).value.trim()); toast("Entró como " + sesion.email); elegirFinca(); } catch (e) { toast("Código incorrecto o vencido"); } };
  });
}
async function elegirFinca() {
  let fincas = []; try { fincas = await (await remoto()).misFincas(); } catch (e) { return toast("No se pudo consultar: " + e.message); }
  const hayLocal = S.animales.length || S.entregas.length;
  sheet(cab("Conectar finca") + `
    ${fincas.length ? `<div class="stack"><span class="eyebrow">Sus fincas en la nube</span>${fincas.map((f, i) => `<button class="card" type="button" data-fi="${i}"><b>${esc(f.nombre)}</b><span class="small muted">${esc(ROLES[f.rol] || f.rol)}</span></button>`).join("")}</div>` : ""}
    <div class="panel stack"><span class="eyebrow">Subir la finca de este celular</span>
      <p class="small muted">${hayLocal ? `Se sube "${esc(cfg().nombre || "Mi finca")}" con todo lo registrado aquí, y usted queda como dueño.` : "Crea la finca en la nube; usted queda como dueño."}</p>
      <button class="btn" type="button" id="cfSubir">Subir esta finca</button></div>
    <div class="panel stack"><span class="eyebrow">Me invitaron</span>
      <label class="f">Código de invitación<input id="cfCod" autocomplete="off" placeholder="Ej. 7F3A9C" style="text-transform:uppercase"></label>
      <button class="btn ghost" type="button" id="cfUnir">Unirme</button></div>`, (s) => {
    const conAviso = (f) => {
      if (!hayLocal) return guardarYcerrar(() => conectarFinca(f, "bajar"), "Finca conectada");
      sheet(cab("¿Qué hacemos con lo de este celular?") + `<p>Este celular tiene datos que no están en "${esc(f.nombre)}".</p>
        <button class="btn danger" type="button" id="cvB">Reemplazarlos por los de la nube</button>
        <button class="btn ghost" type="button" id="cvU">Juntar: subir lo de aquí a esa finca</button>`, (s2) => {
        $("#cvB", s2).onclick = () => guardarYcerrar(() => conectarFinca(f, "bajar"), "Finca conectada");
        $("#cvU", s2).onclick = () => guardarYcerrar(() => conectarFinca(f, "subir"), "Finca conectada y datos subidos");
      });
    };
    $$("[data-fi]", s).forEach((b) => (b.onclick = () => conAviso(fincas[b.dataset.fi])));
    $("#cfSubir", s).onclick = async () => { try { const id = await (await remoto()).crearFinca(cfg().nombre || "Mi finca"); guardarYcerrar(() => conectarFinca({ id, nombre: cfg().nombre || "Mi finca", rol: "dueno" }, "subir"), "Finca subida a la nube"); } catch (e) { toast("No se pudo crear: " + e.message); } };
    $("#cfUnir", s).onclick = async () => { const c = $("#cfCod", s).value.trim(); if (!c) return toast("Escriba el código");
      try { const r = await remoto(); const id = await r.unirse(c); const f = (await r.misFincas()).find((x) => x.id === id) || { id, nombre: "Finca", rol: "ordenador" }; conAviso(f); } catch (e) { toast(e.message); } };
  });
}
function formInvitar() {
  const n = nubeCfg();
  sheet(cab("Invitar a la finca") + `
    <p class="small muted">Elija qué podrá hacer la persona. El ordeñador y el veterinario registran el hato, la leche y la salud, pero no ven la plata (liquidaciones, costos ni precios).</p>
    <div class="opciones">${Object.entries(ROLES).map(([k, v]) => `<button type="button" class="chipbtn" data-r="${k}" aria-pressed="${k === "ordenador"}">${v}</button>`).join("")}</div>
    <button class="btn" type="button" id="inG">Crear código</button>
    <div id="inOut"></div>`, (s) => {
    let rol = "ordenador";
    $$("[data-r]", s).forEach((b) => (b.onclick = () => { rol = b.dataset.r; $$("[data-r]", s).forEach((y) => y.setAttribute("aria-pressed", y === b)); }));
    $("#inG", s).onclick = async () => {
      try {
        const cod = await (await remoto()).invitar(n.fincaId, rol);
        const msg = `Te invito a la finca ${n.fincaNombre} en Hato Claro como ${ROLES[rol].toLowerCase()}. Abre ${location.origin + location.pathname} , entra con tu correo en Más → Varios celulares y usa el código ${cod}`;
        $("#inOut", s).innerHTML = `<div class="panel stack" style="text-align:center"><span class="eyebrow">Código (vale 7 días, un solo uso)</span><b class="num" style="font-size:2.2rem;letter-spacing:.2em">${esc(cod)}</b>
          <button class="btn" type="button" id="inC">${navigator.share ? "Enviar por WhatsApp u otra app" : "Copiar mensaje"}</button><p class="small muted" style="user-select:all">${esc(msg)}</p></div>`;
        $("#inC", s).onclick = async () => { try { if (navigator.share) await navigator.share({ text: msg }); else { await navigator.clipboard.writeText(msg); toast("Mensaje copiado"); } } catch (e) {} };
      } catch (e) { toast(e.message); }
    };
  });
}
async function verMiembros() {
  const n = nubeCfg(); let lista = [];
  try { lista = await (await remoto()).miembros(n.fincaId); } catch (e) { return toast(e.message); }
  sheet(cab("Personas en " + esc(n.fincaNombre)) + `<div class="stack">${lista.map((m) => `<div class="row spread"><span>${esc(m.email)}<br><span class="small muted">${esc(ROLES[m.rol] || m.rol)}</span></span>${n.rol === "dueno" && m.email !== sesion.email ? `<button class="btn ghost sm" type="button" data-u="${esc(m.user_id)}">Quitar</button>` : ""}</div>`).join("")}</div>`, (s) => {
    $$("[data-u]", s).forEach((b) => (b.onclick = function () { confirmar(this, "¿Seguro?", async () => { try { await (await remoto()).quitar(n.fincaId, b.dataset.u); toast("Persona quitada"); verMiembros(); } catch (e) { toast(e.message); } }); }));
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
  hoja("Hato", [...S.animales].sort(porArete).map((a) => { const c = ciclo(a); return { "Número": a.arete, "Nombre": a.nombre, "Raza": a.raza, "Sexo": a.sexo === "M" ? "Macho" : "Hembra", "Nacimiento": a.nacimiento, "Estado": ESTADOS[a.estado], "Madre": a.madre, "Producción": a.nivel || "", "Partos": c.nPartos, "Último parto": c.ultParto || "", "Preñada": c.prenada ? "Sí" : "No", "Parto probable": c.fpp || "", "Peso (kg)": pesoAnimal(a).kg, "Peso aproximado": pesoAnimal(a).aprox ? "Sí" : "No", "Valor estimado ($)": (valorAnimal(a) || {}).valor ?? "", "Candidata a descarte": evalDescarte(a) ? "Sí" : "" }; }));
  hoja("Leche", entregasOrden().map((e) => ({ "Fecha": e.fecha, "Mañana (L)": e.am, "Tarde (L)": e.pm, "Total (L)": e.litros, "Nota": e.nota || "" })));
  hoja("Registros", [...S.eventos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((e) => ({ "Fecha": e.fecha, "Animal": e.arete, "Tipo": e.tipo === "obs" ? "Observación: " + e.obs : TIPOS[e.tipo] || e.tipo, "Producto": e.producto || "", "Retiro hasta": e.retiroHasta || "", "Cría": e.cria || "", "Nota": e.nota || "" })));
  hoja("Calidad", [...S.calidad].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((q) => ({ "Fecha": q.fecha, "Semana": q.semana ?? "", "Sólidos %": q.solidos, "Grasa %": q.grasa, "Proteína %": q.proteina, "Células somáticas": q.ccs, "UFC": q.ufc, "MUN mg/dl": q.mun ?? "" })));
  hoja("Liquidaciones", [...S.liquidaciones].sort((a, b) => (a.hasta < b.hasta ? -1 : 1)).map((l) => ({ "Semana": l.semana, "Desde": l.desde, "Hasta": l.hasta, "Litros": l.litros, "Precio por litro": l.precioLitro, "Flete por litro": l.fleteLitro, "Pagado por litro": l.precioPagado, "Ingreso por leche": l.ingresoLeche, "Deducciones": l.totalDeducciones, "Neto a pagar": l.neto, "Concentrado y sales comprado ($)": ((l.compras || []).find((c) => /CONCENTRADO/i.test(c.grupo)) || {}).valor ?? "" })));
  hoja("Gastos", [...S.gastos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((g) => ({ "Fecha": g.fecha, "Categoría": g.categoria, "Descripción": g.descripcion || "", "Valor ($)": g.valor, "Potrero": (S.potreros.find((p) => p.id === g.potreroId) || {}).nombre || "" })));
  hoja("Resumen por mes", (() => { const out = []; for (let i = 11; i >= 0; i--) { const r = resumenMes(mesMas(hoy().slice(0, 7), -i)); if (r.litros || r.gastos) out.push({ "Mes": r.m, "Litros": r.litros, "Ingreso leche ($)": Math.round(r.ingreso), "Venta animales ($)": r.ventas, "Gastos ($)": r.gastos, "Costo por litro ($)": r.costoL != null ? Math.round(r.costoL) : "", "Ganancia ($)": Math.round(r.utilidad) }); } return out; })());
  hoja("Potreros", estadoPotreros().map((p) => ({ "Potrero": p.nombre, "Área (ha)": p.area ?? "", "Pasto": p.pasto || "", "Estado": ESTADO_POT[p.estado][0], "Días": p.dias ?? "", "Descanso meta": p.descanso })));
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
    ["201", "Princesa", "Holstein", "2024-12-03", "novilla", "104", ""], ["301", "Nube", "Holstein × Normando", d(-44), "ternera", "102", ""],
    ["107", "Manchas", "Holstein", "2015-05-10", "lactancia", "", "baja"], ["302", "Toribio", "Holstein", d(-260), "ternera", "107", "", "M"]];
  const pesosEj = { "101": 610, "104": 575, "107": 590, "302": 205 };
  for (const [arete, nombre, raza, nac, estado, madre, nivel, sexo] of animales) await save("animales", { id: arete, arete, nombre, raza, sexo: sexo || "H", nacimiento: nac, estado, madre, origen: "nacida", nivel, ...(pesosEj[arete] ? { peso: pesosEj[arete], pesoFecha: d(-10), pesoMetodo: "cinta" } : {}), ...E });
  const ev = [["101", "parto", -110], ["101", "servicio", -59, "Pajilla Holstein"], ["101", "prenez", -23, "Ecografía"], ["102", "parto", -44, "Parto normal", "301"],
    ["103", "parto", -189], ["103", "servicio", -146, "Toro Jersey"], ["103", "prenez", -110], ["104", "parto", -332], ["104", "servicio", -269, "Pajilla Holstein"], ["104", "prenez", -230, "Palpación"],
    ["105", "parto", -85], ["105", "servicio", -21, "Pajilla Gyr"], ["106", "parto", -402], ["106", "servicio", -245], ["106", "prenez", -207], ["106", "secado", -28], ["102", "vacuna", -8, "", "", "Aftosa"],
    ["107", "parto", -260, "", "302"], ["107", "servicio", -195, "Pajilla Holstein"], ["107", "servicio", -170, "Pajilla Holstein"], ["107", "servicio", -146, "Toro de la finca"], ["107", "vacia", -100, "Palpación"]];
  let i = 0;
  for (const [arete, tipo, off, nota, cria, producto] of ev) { const o = { id: "ej" + i++, arete, tipo, fecha: d(off), nota: nota || "", ...E }; if (cria) o.cria = cria; if (producto) o.producto = producto; await save("eventos", o); }
  await save("eventos", { id: "ej-t1", arete: "103", tipo: "tratamiento", fecha: d(-1), producto: "Antibiótico intramamario", retiroDias: 4, retiroHasta: d(3), nota: "Mastitis cuarto delantero", ...E });
  await save("eventos", { id: "ej-t2", arete: "107", tipo: "tratamiento", fecha: d(-210), producto: "Antibiótico intramamario", retiroDias: 4, retiroHasta: d(-206), nota: "Mastitis", ...E });
  await save("eventos", { id: "ej-t3", arete: "107", tipo: "tratamiento", fecha: d(-75), producto: "Antibiótico intramamario", retiroDias: 4, retiroHasta: d(-71), nota: "Mastitis", ...E });
  await save("eventos", { id: "ej-o1", arete: "105", tipo: "obs", obs: "Bajó la leche", fecha: d(0), nota: "", ...E });
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let k = 1; k <= 28; k++) { const base = 96 + (rnd() - 0.5) * 8 - (k <= 2 ? 6 : 0); const am = Math.round(base * 0.56), pm = Math.round(base - am); await save("entregas", { id: d(-k), fecha: d(-k), am, pm, litros: am + pm, nota: "", ...E }); }
  const cal = [[-28, 3.6, 3.15, 12.3, 280000, 60000], [-14, 3.5, 3.1, 12.1, 350000, 90000], [-2, 3.55, 3.12, 12.2, 430000, 70000]];
  for (const [off, grasa, proteina, solidos, ccs, ufc] of cal) await save("calidad", { id: "ejq" + off, fecha: d(off), grasa, proteina, solidos, ccs, ufc, ...E });
  if (!cfg().precioLitro) await save("config", { ...cfg(), precioLitro: 1850 });
  // potreros de ejemplo alrededor de la finca
  const [la, lo] = centroFinca(), dd = 0.0011;
  const caja = (dx, dy) => [[la + dy, lo + dx], [la + dy, lo + dx + dd], [la + dy + dd * 0.8, lo + dx + dd], [la + dy + dd * 0.8, lo + dx]];
  const pots = [["ejp1", "El Alto", caja(0, 0)], ["ejp2", "La Quebrada", caja(dd * 1.05, 0)], ["ejp3", "El Bajo", caja(0, -dd * 0.85)], ["ejp4", "Los Pinos", caja(dd * 1.05, -dd * 0.85)]];
  for (const [id, nombre, coords] of pots) await save("potreros", { id, nombre, coords, area: Math.round(areaHa(coords) * 100) / 100, pasto: "Kikuyo", descanso: 40, ocupaMax: 3, ...E });
  const ord = ["101", "102", "103", "104", "105", "107"];
  await save("ocupaciones", { id: "ejo1", potreroId: "ejp3", grupo: "En ordeño", animales: ord, entrada: d(-44), salida: d(-42), ...E });
  await save("ocupaciones", { id: "ejo2", potreroId: "ejp4", grupo: "En ordeño", animales: ord, entrada: d(-42), salida: d(-25), ...E });
  await save("ocupaciones", { id: "ejo3", potreroId: "ejp2", grupo: "En ordeño", animales: ord, entrada: d(-25), salida: d(-4), ...E });
  await save("ocupaciones", { id: "ejo4", potreroId: "ejp1", grupo: "En ordeño", animales: ord, entrada: d(-4), salida: null, ...E });
  await save("ocupaciones", { id: "ejo5", potreroId: "ejp3", grupo: "Secas", animales: ["106", "201"], entrada: d(-12), salida: null, ...E });
  const mes = hoy().slice(0, 8);
  const gas = [["Concentrado y sales", "20 bultos de concentrado", 1446000], ["Medicamentos y veterinario", "Visita del veterinario", 120000], ["Fertilizantes y potreros", "Urea para El Alto", 310000, "ejp1"], ["Inseminación y genética", "2 pajillas Holstein", 140000], ["Combustible, energía y agua", "Energía planta de ordeño", 185000]];
  let k = 0; for (const [categoria, descripcion, valor, potreroId] of gas) await save("gastos", { id: "ejg" + k, fecha: mes + pad(Math.min(Number(hoy().slice(8)), 2 + k * 4)), categoria, descripcion, valor, potreroId: potreroId || null, ...E }), k++;
  const cc = cfgCostos(); if (!(cc.fijos || []).length) await save("config", { ...cc, fijos: [{ id: "ejf1", descripcion: "Sueldo del ordeñador", valor: 1750000, categoria: "Mano de obra" }], familiarMes: 1423500, incluirFamiliar: true });
  const h7 = d(-3), h0 = add(h7, -6);
  const semISO = (f) => { const x = D(f), t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())), dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia); return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); };
  await save("liquidaciones", { id: "ejl1", comprador: "Colanta", semana: semISO(h7), anio: Number(h7.slice(0, 4)), desde: h0, hasta: h7, fechaLiquidacion: d(0), litros: 672, precioBase: 2130.16, ingresoBase: 1431468, stRef: 12.99,
    bonificaciones: [{ concepto: "BONIFICACIÓN POR RECUENTO BACTERIOL", porLitro: 89, total: 59808 }, { concepto: "BONIFICACIÓN POR FRÍO PROMEDIO SEM.", porLitro: 10, total: 6720 }, { concepto: "BONIFICACION FENOMENO DEL NIÑO", porLitro: 50, total: 33600 }],
    precioLitro: 2279.16, ingresoBruto: 1531596, fleteLitro: 105, flete: 70560, precioPagado: 2174.16, ingresoLeche: 1461036, deducciones: [{ concepto: "CUOTA DE FOMENTO GANADERO Y LECHERO", valor: 10957 }], totalDeducciones: 10957, neto: 1450079,
    compras: [{ grupo: "CONCENTRADOS Y SALES", kg: 400, valor: 709400 }], ...E });
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
  let recargando = false; const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (recargando || !habiaControlador) return; recargando = true; location.reload(); });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); instalarEvt = e; if (vista === "mas") render(); });

$$(".tabbar button").forEach((b) => (b.onclick = () => setVista(b.dataset.v)));
$("#fab").onclick = menuRegistrar;
$("#btnVoz").onclick = abrirVoz;
$("#btnMas").onclick = () => setVista(vista === "mas" ? "inicio" : "mas");
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });

(async () => {
  await cargar();
  setVista("inicio");
  cargarMercado();
  iniciarNube().then(() => { if (vista === "mas") render(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.abrir) setVista(e.data.abrir); });
  registrarSW();
})();
})();
