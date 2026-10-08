/* Hato Claro — lector de la liquidación semanal de leche de Colanta (PDF).
   Recibe el texto de cada página como piezas {s, x, y} y devuelve los datos
   de la semana. No guarda nombre, cédula ni correo del proveedor. */
(function (global) {
"use strict";

const MESES = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() + n); return iso(t); };

// "1.742,0" -> 1742 · "$3.057.173,00" -> 3057173 · ",68" -> 0.68
function num(str) {
  let s = String(str).replace(/[$\s]/g, "");
  if (!/^-?[\d.]*,?\d+$/.test(s) && !/^-?\d[\d.]*$/.test(s)) return null;
  s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function fechaCol(txt) {
  const m = /(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/.exec(txt);
  if (!m || !MESES[m[2].toUpperCase()]) return null;
  return m[3] + "-" + pad(MESES[m[2].toUpperCase()]) + "-" + pad(m[1]);
}

// Agrupa las piezas en renglones (misma altura, con tolerancia).
function renglones(pages) {
  const out = [];
  pages.forEach((items, p) => {
    const rows = [];
    [...items].filter((i) => i.s && i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
      let r = rows.find((r) => Math.abs(r.y - it.y) <= 3);
      if (!r) { r = { y: it.y, page: p, items: [] }; rows.push(r); }
      r.items.push({ s: it.s.trim(), x: it.x });
    });
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x - b.x);
      r.label = r.items.filter((i) => num(i.s) == null).map((i) => i.s).join(" ");
      r.nums = r.items.map((i) => ({ v: num(i.s), x: i.x })).filter((n) => n.v != null);
      r.text = r.items.map((i) => i.s).join(" ");
    });
    out.push(...rows);
  });
  return out;
}

function parseColanta(pages) {
  const R = renglones(pages);
  const todo = R.map((r) => r.text).join("\n");
  if (!/COLANTA/i.test(todo) || !/LIQUIDACI[OÓ]N DE LECHE/i.test(todo)) return null;
  const find = (re, desde = 0) => R.findIndex((r, i) => i >= desde && re.test(r.text));
  const row = (re, desde) => { const i = find(re, desde); return i >= 0 ? R[i] : null; };

  // Semana de liquidación
  const per = /(\d{1,2}\/[A-Za-z]{3}\/\d{4})\s*a\s*(\d{1,2}\/[A-Za-z]{3}\/\d{4})/.exec(todo);
  if (!per) return null;
  const desde = fechaCol(per[1]), hasta = fechaCol(per[2]);
  const sem = /(\d{1,2})\s+de\s+(\d{4})/.exec(todo);
  const semana = sem ? Number(sem[1]) : null, anio = sem ? Number(sem[2]) : Number(desde.slice(0, 4));
  const fechaLiq = (() => { const r = row(/FECHA LIQUIDACI/i); if (!r) return null; const i = R.indexOf(r); for (let k = i; k < i + 3 && k < R.length; k++) { const f = fechaCol(R[k].text.split(" a ")[0]); if (f && f !== desde) return f; } return null; })();
  const r0 = row(/^\$?[\d.]+,\d+$/); // precio grande del encabezado
  const predio = (() => { const i = find(/NOMBRE DEL PREDIO/i); return i >= 0 && R[i + 1] ? R[i + 1].items[0].s : ""; })();

  // Recibo de leche: columnas Lunes..Domingo + TOTAL
  const recibos = [];
  let totalLitros = null;
  const iF = find(/Fecha Recibo/i);
  if (iF >= 0) {
    const cab = R[iF].items.filter((i) => /^[A-Za-z]{3}\s+\d{1,2}$/.test(i.s)).map((i) => i.x);
    const iT = find(/TOTAL/, iF - 2);
    const xTotal = iT >= 0 && iT <= iF ? (R[iT].items.find((i) => /^TOTAL$/.test(i.s)) || {}).x : null;
    const anclas = cab.map((x, k) => ({ x, k })).concat(xTotal != null ? [{ x: xTotal, k: "T" }] : []);
    const asigna = (r) => { const m = {}; if (!r) return m; r.nums.forEach((n) => { let best = null; anclas.forEach((a) => { const d = Math.abs(a.x - n.x); if (!best || d < best.d) best = { d, k: a.k }; }); if (best && best.d < 30) m[best.k] = n.v; }); return m; };
    const lit = asigna(row(/Leche recibida/i, iF));
    const tem = asigna(row(/Temperatura/i, iF));
    for (let k = 0; k < cab.length; k++) if (lit[k] != null) recibos.push({ fecha: addDays(desde, k), litros: lit[k], temp: tem[k] ?? null });
    totalLitros = lit.T ?? recibos.reduce((s, r) => s + r.litros, 0);
  }

  // Calidad: últimas semanas
  const calidad = [];
  const iQ = find(/Par[aá]metros\s*\/\s*Semana/i);
  if (iQ >= 0) {
    const semanas = R[iQ].nums.filter((n) => Number.isInteger(n.v) && n.v >= 1 && n.v <= 53);
    const fila = (re) => { const r = row(re, iQ); const m = {}; if (!r) return m; r.nums.forEach((n) => { let best = null; semanas.forEach((s, k) => { const d = Math.abs(s.x - n.x); if (!best || d < best.d) best = { d, k }; }); if (best && best.d < 22) m[best.k] = n.v; }); return m; };
    const st = fila(/S[oó]lidos Totales/i), rcs = fila(/RCS|c[eé]l\.?\s*som/i), mun = fila(/MUN|Ureico/i), ufc = fila(/UFC/i);
    const gr = fila(/^Grasa/i), pr = fila(/^Prote[ií]na/i);
    semanas.forEach((s, k) => {
      const fin = addDays(hasta, -7 * (semanas.length - 1 - k));
      const q = { semana: s.v, fecha: fin, solidos: st[k] ?? null, ccs: rcs[k] != null ? Math.round(rcs[k] * 1000) : null, ufc: ufc[k] != null ? Math.round(ufc[k] * 1000) : null, mun: mun[k] ?? null, grasa: gr[k] ?? null, proteina: pr[k] ?? null };
      if (q.solidos != null || q.ccs != null || q.ufc != null) calidad.push(q);
    });
  }

  // Detalle de la liquidación (columnas por posición)
  const col = (x) => x < 250 ? "ref" : x < 310 ? "oblig" : x < 360 ? "volunt" : x < 420 ? "valor" : x < 470 ? "ingreso" : x < 530 ? "deduccion" : "saldo";
  const liq = { bonificaciones: [], deducciones: [] };
  const iC = find(/^CONCEPTOS/i), iN = find(/NETO A PAGAR/i);
  if (iC >= 0 && iN > iC) {
    for (let i = iC + 1; i < iN; i++) {
      const r = R[i]; if (!r.label || /OBLIGAT|VOLUNT/i.test(r.label)) continue;
      const c = {}; r.nums.forEach((n) => (c[col(n.x)] = n.v));
      const L = r.label.toUpperCase();
      if (/^S[OÓ]LIDOS TOTALES/.test(L)) { liq.precioBase = c.valor ?? null; liq.ingresoBase = c.ingreso ?? null; }
      else if (/BONIFICACI/.test(L)) liq.bonificaciones.push({ concepto: r.label, porLitro: c.valor ?? null, total: c.ingreso ?? null });
      else if (/^PRECIO POR LITRO/.test(L)) { liq.precioLitro = c.valor ?? null; liq.ingresoBruto = c.ingreso ?? null; }
      else if (/^FLETES?/.test(L)) { liq.fleteLitro = c.valor ?? c.ref ?? null; liq.flete = c.deduccion ?? null; }
      else if (/MENOS FLETE/.test(L)) liq.precioPagado = c.valor ?? null;
      else if (/TOTAL INGRESO/.test(L)) liq.ingresoLeche = c.saldo ?? c.ingreso ?? null;
      else if (/REDONDEO/.test(L)) continue;
      else if (c.deduccion != null) liq.deducciones.push({ concepto: r.label, valor: c.deduccion });
    }
    const n = R[iN].nums; liq.neto = n.length ? n[n.length - 1].v : null;
    liq.totalDeducciones = liq.deducciones.reduce((s, d) => s + d.valor, 0);
  }
  if (liq.precioLitro == null && r0) liq.precioLitro = r0.nums[0] ? r0.nums[0].v : null;

  // Compras en almacén Agrocolanta
  const compras = [];
  const iA = find(/COMPRAS AGROCOLANTA/i);
  if (iA >= 0) {
    for (let i = iA + 1; i < R.length && i < iA + 15; i++) {
      const r = R[i]; if (r.page !== R[iA].page) break;
      if (r.label && r.nums.length >= 2 && !/GRUPO|SEMANA|ACUMULADO|KG|VALOR/i.test(r.label)) {
        const v = r.nums.map((n) => n.v);
        compras.push({ grupo: r.label, kg: v[0], valor: v[1], kgAnio: v[2] ?? null, valorAnio: v[3] ?? null });
      }
    }
  }

  return { comprador: "Colanta", semana, anio, desde, hasta, fechaLiquidacion: fechaLiq, predio, recibos, litros: totalLitros, calidad, liquidacion: liq, compras };
}

global.parseColanta = parseColanta;
if (typeof module !== "undefined") module.exports = { parseColanta };
})(typeof window !== "undefined" ? window : globalThis);
