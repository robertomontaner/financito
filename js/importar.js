// Importadores: extractos bancarios (CSV, Excel, Norma 43, CAMT.053, OFX) y el asistente «con Claude» (JSON).
// Este módulo no conoce la interfaz por dentro: app.js le pasa sus utilidades con initImport(ctx).
import { uid, round2, num, todayISO, eur, kindOf, displayGroup, normDate } from './model.js';

let C = null;
export const initImport = (ctx) => { C = ctx; };

// =====================================================================
// 1. Lectura de números, fechas y formatos de fichero (funciones puras)
// =====================================================================
export function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[€$£\s ]|EUR/gi, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const lc = s.lastIndexOf(','); const ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoOk = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100 ? `${y}-${pad2(m)}-${pad2(d)}` : '');
export function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoOk(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && v > 20000 && v < 80000) { // número de serie de Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
    return isoOk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoOk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?(?:\.\d+)?(?:\[.*\])?$/))) return isoOk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    let d = +m[1]; let mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // por si viene en formato de EE. UU.
    return isoOk(y, mo, d);
  }
  const MES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  if ((m = s.toLowerCase().match(/^(\d{1,2})[\s-]+([a-zñ]{3})[a-zñ.]*[\s-]+(\d{2,4})/)) && MES[m[2]]) { let y = +m[3]; if (y < 100) y += 2000; return isoOk(y, MES[m[2]], +m[1]); }
  return '';
}

// CSV con comillas; el separador se detecta solo
export function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 30);
  const count = (l, ch) => { let n = 0; let q = false; for (const c of l) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const sep = [';', ',', '\t', '|'].map((ch) => [ch, lines.reduce((s, l) => s + count(l, ch), 0)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false; const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

// Norma 43 (AEB/CSB 43): el formato estándar de extractos de los bancos españoles
export function parseN43(text) {
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.padEnd(80); const t = l.slice(0, 2);
    if (t === '22') {
      const f = l.slice(10, 16);
      cur = { fecha: isoOk(2000 + +f.slice(0, 2), +f.slice(2, 4), +f.slice(4, 6)), importe: (l[27] === '1' ? -1 : 1) * (Number(l.slice(28, 42)) / 100), concepto: [l.slice(52, 64), l.slice(64, 80)].map((x) => x.trim()).filter((x) => x && !/^0+$/.test(x)).join(' '), extra: [] };
      out.push(cur);
    } else if (t === '23' && cur) cur.extra.push(`${l.slice(4, 42).trim()} ${l.slice(42, 80).trim()}`.trim());
  }
  return out.map((r) => ({ fecha: r.fecha, importe: round2(r.importe), concepto: (r.extra.filter(Boolean).join(' ') || r.concepto || 'Movimiento').replace(/\s+/g, ' ') }));
}

// CAMT.053 (ISO 20022, XML): el estándar europeo de extractos que acompaña a SEPA
export function parseCAMT(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const by = (el, n) => (el ? [...el.getElementsByTagNameNS('*', n)] : []);
  const first = (el, ...ns) => { for (const n of ns) { const x = by(el, n)[0]; if (x && x.textContent.trim()) return x.textContent.trim(); } return ''; };
  return by(doc, 'Ntry').map((e) => {
    const sign = first(e, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
    const fecha = parseDate(first(by(e, 'BookgDt')[0], 'Dt', 'DtTm') || first(by(e, 'ValDt')[0], 'Dt', 'DtTm'));
    const parte = first(by(by(e, 'RltdPties')[0], sign < 0 ? 'Cdtr' : 'Dbtr')[0], 'Nm');
    const texto = first(e, 'Ustrd', 'AddtlTxInf', 'AddtlNtryInf');
    return { fecha, importe: round2(sign * parseNum(first(e, 'Amt'))), concepto: [...new Set([parte, texto].filter(Boolean))].join(' · ') || 'Movimiento' };
  });
}

// OFX / QFX (Money, Quicken y algunos bancos)
export function parseOFX(text) {
  return text.split(/<STMTTRN>/i).slice(1).map((b) => {
    const g = (tag) => (b.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
    return { fecha: parseDate(g('DTPOSTED').slice(0, 8)), importe: round2(parseNum(g('TRNAMT'))), concepto: [...new Set([g('NAME'), g('MEMO')].filter(Boolean))].join(' · ') || 'Movimiento' };
  });
}

export function detectFormat(name, text) {
  const n = String(name || '').toLowerCase();
  if (/<\?xml|<Document/i.test(text.slice(0, 600)) && /BkToCstmrStmt|camt\.05/i.test(text.slice(0, 4000))) return 'camt';
  if (/OFXHEADER|<OFX>/i.test(text.slice(0, 1000)) || /\.(ofx|qfx)$/.test(n)) return 'ofx';
  const ls = text.split(/\r?\n/).filter((l) => l.trim());
  if (ls.length > 1 && ls[0].startsWith('11') && ls.some((l) => /^22\d{20}/.test(l)) && ls.filter((l) => /^(11|22|23|33|88)/.test(l)).length >= ls.length * 0.9) return 'n43';
  return 'csv';
}

// --------- tablas (CSV / Excel): qué columna es cada cosa ---------
const H = {
  fecha: /fecha|date|f\.\s*oper/i,
  valor: /valor|value/i,
  concepto: /concepto|descrip|detalle|movimiento|payee|beneficiar|comercio|merchant|texto|referencia|observ|nombre/i,
  importe: /^\s*(importe|amount|cantidad|monto|import)/i,
  cargo: /cargo|debe\b|debit|salida|withdraw|paid out|gastos?$/i,
  abono: /abono|haber|credit|entrada|deposit|paid in|ingresos?$/i,
  comision: /^\s*(fee|comisi)/i,
  estado: /^\s*(state|estado|status)\s*$/i,
};
export function guessMapping(table) {
  // la cabecera es la primera fila (de las 30 primeras) que nombra al menos una fecha y un importe
  let hi = table.slice(0, 30).findIndex((r) => r.some((c) => H.fecha.test(c)) && r.some((c) => H.importe.test(c) || H.cargo.test(c) || H.abono.test(c)));
  if (hi < 0) hi = 0;
  const head = (table[hi] || []).map((c) => String(c ?? '').trim());
  const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  let fecha = head.findIndex((h) => /completed|operaci|contable|booking|transacci/i.test(h) && H.fecha.test(h));
  if (fecha < 0) fecha = find(H.fecha, H.valor); if (fecha < 0) fecha = find(H.fecha);
  const importe = find(H.importe, /saldo|balance/i);
  const map = {
    header: hi, fecha, concepto: find(H.concepto), importe,
    cargo: importe < 0 ? find(H.cargo) : -1, abono: importe < 0 ? find(H.abono) : -1,
    comision: find(H.comision), estado: find(H.estado), invertir: false,
  };
  if (map.fecha < 0 || (map.importe < 0 && map.cargo < 0 && map.abono < 0)) { // sin cabecera reconocible: se adivina por el contenido
    const data = table.slice(hi, hi + 15); const cols = Math.max(...data.map((r) => r.length));
    const score = (fn) => [...Array(cols).keys()].map((k) => data.filter((r) => fn(r[k])).length);
    const fd = score((x) => parseDate(x)); const fn = score((x) => String(x ?? '').trim() !== '' && !Number.isNaN(parseNum(x)) && !parseDate(x));
    const ft = score((x) => /[a-z]{3}/i.test(String(x ?? '')) && Number.isNaN(parseNum(x)));
    if (map.fecha < 0) map.fecha = fd.indexOf(Math.max(...fd));
    if (map.importe < 0) map.importe = fn.indexOf(Math.max(...fn));
    if (map.concepto < 0) map.concepto = ft.indexOf(Math.max(...ft));
  }
  return { map, head };
}
export function rowsFromTable(table, map) {
  const out = []; let skipped = 0;
  for (const r of table.slice(map.header + 1)) {
    const fecha = parseDate(r[map.fecha]);
    let imp = map.importe >= 0 ? parseNum(r[map.importe]) : (Number.isNaN(parseNum(r[map.abono])) ? 0 : Math.abs(parseNum(r[map.abono]))) - (Number.isNaN(parseNum(r[map.cargo])) ? 0 : Math.abs(parseNum(r[map.cargo])));
    if (!fecha || Number.isNaN(imp) || Math.abs(imp) < 0.005) { if (fecha || r.some((x) => String(x ?? '').trim())) skipped++; continue; }
    if (map.estado >= 0 && /revert|declin|fail|cancel|pend|rechaz|anulad/i.test(String(r[map.estado] ?? ''))) { skipped++; continue; }
    if (map.comision >= 0) { const f = parseNum(r[map.comision]); if (!Number.isNaN(f)) imp -= Math.abs(f); }
    if (map.invertir) imp = -imp;
    out.push({ fecha, importe: round2(imp), concepto: String(r[map.concepto] ?? '').replace(/\s+/g, ' ').trim() || 'Movimiento' });
  }
  return { rows: out, skipped };
}

// ficheros: texto con la codificación correcta, o Excel con SheetJS
let xlsxLib = null;
const loadXLSX = () => (xlsxLib ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxLib = null; rej(new Error('No se pudo cargar el lector de Excel (¿sin conexión?)')); }; document.head.appendChild(s); }));
async function readFile(file) {
  const buf = await file.arrayBuffer(); const b = new Uint8Array(buf.slice(0, 8));
  const isZip = b[0] === 0x50 && b[1] === 0x4b; const isOle = b[0] === 0xd0 && b[1] === 0xcf;
  if (isZip || isOle || /\.(xlsx|xls|ods)$/i.test(file.name)) {
    let text = null;
    if (!isZip && !isOle) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); } }
    if (text && !/<table/i.test(text)) return { kind: 'text', text }; // un «.xls» que en realidad es CSV
    const XLSX = await loadXLSX();
    const wb = XLSX.read(text ?? buf, { type: text ? 'string' : 'array', cellDates: true });
    const sheets = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
    return { kind: 'table', table: sheets.sort((x, y) => y.length - x.length)[0] || [] };
  }
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  return { kind: 'text', text };
}

// =====================================================================
// 2. Clasificación: aprende de lo que ya tienes apuntado
// =====================================================================
const STOP = new Set('compra compras pago pagos tarjeta tarj transferencia transf trf recibo recibos fecha visa card debit debito credito con en de del la el los las al por para operacion oper num ref sepa mastercard contactless apple google pay eur es sl sa slu sau payment to from www com the and cargo abono adeudo emitida recibida inmediata favor'.split(' '));
const normTxt = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const claveConcepto = (s) => normTxt(s).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 3).join(' ');
const KW = [
  [/gasolin|gasoil|repsol|cepsa|galp|renfe|metro|parking|peaje|itv|taller|cabify|uber|bolt|taxi|emt\b|bus/, '601'],
  [/vuelo|hotel|booking|airbnb|ryanair|vueling|iberia|wizz|easyjet|billete/, '605'],
  [/regalo|floris|flores/, '606'],
  [/farmac|fisio|dentist|clinica|peluquer|optica|gimnas|decathlon|protein/, '602'],
  [/libreria|udemy|curso|amazon kindle|casa del libro|fnac/, '607'],
  [/mercadona|lidl|carrefour|aldi|consum|dia\b|eroski|alcampo|hipercor|supermercado|primaprix|ikea|leroy|bricomart/, '600'],
  [/restaurante|bar\b|cafe|cafeteria|glovo|just eat|uber eats|burger|mcdonald|kfc|telepizza|pizza|cerveceria|tapas|cine|entradas/, '603'],
  [/netflix|spotify|hbo|disney|icloud|apple\.com|openai|chatgpt|claude|anthropic|digi|movistar|vodafone|orange|jazztel|google storage/, '629'],
];
const KW_ING = [[/nomina|salario|payroll/, '700'], [/devolucion hacienda|aeat/, '778']];

function buildIndex(L) {
  const full = {}; const first = {};
  const add = (map, k, code) => { if (!k) return; (map[k] ??= {}); map[k][code] = (map[k][code] || 0) + 1; };
  for (const r of L.activeRows) {
    if (['apertura', 'ajuste', 'amortizacion'].includes(r.clase)) continue;
    const td = kindOf(L.byCode[r.debe] || {}); const th = kindOf(L.byCode[r.haber] || {});
    const money = (k, c) => k === 'dinero' || k === 'deuda' || c === '119';
    let other = null;
    if (money(th, r.haber) && r.debe !== r.haber) other = r.debe; else if (money(td, r.debe)) other = r.haber;
    if (!other || other === '119') continue;
    const k = claveConcepto(r.concepto); add(full, k, other); add(first, k.split(' ')[0], other);
  }
  return { full, first };
}
const top = (m) => (m ? Object.entries(m).sort((a, b) => b[1] - a[1])[0][0] : '');

// ¿qué cuentas tienen sentido como contrapartida según el signo?
function encaja(L, code, importe, banco) {
  const c = L.byCode[code]; if (!c || code === banco) return false;
  const k = kindOf(c);
  if (k === 'dinero' || k === 'deuda') return true;
  if (importe < 0) return k === 'gasto';
  return k === 'ingreso' || k === 'gasto'; // un abono en una categoría de gasto es una devolución
}
function sugerir(L, idx, row, banco) {
  const k = claveConcepto(row.concepto); const t = normTxt(row.concepto);
  const ok = (code) => code && encaja(L, code, row.importe, banco) && C.isUsable(L.byCode[code]);
  let code = top(idx.full[k]); if (ok(code)) return [code, 'historial'];
  const f = k.split(' ')[0]; code = f.length >= 4 ? top(idx.first[f]) : ''; if (ok(code)) return [code, 'historial'];
  // ¿menciona otra cuenta tuya? (traspaso)
  const propias = L.cuentas.filter((c) => ['dinero', 'deuda'].includes(kindOf(c)) && c.codigo !== banco && C.isUsable(c));
  const men = propias.filter((c) => { const n = normTxt(c.nombre); return n.length >= 4 && t.includes(n); });
  if (men.length === 1) return [men[0].codigo, 'cuenta'];
  for (const [re, cd] of row.importe < 0 ? KW : KW_ING) if (re.test(t) && ok(cd)) return [cd, 'palabras'];
  return ['', ''];
}

// ¿ya está apuntado? mismo banco, mismo importe y signo, ±3 días
function marcarDuplicados(L, banco, rows) {
  const ext = new Set(L.activeRows.filter((r) => String(r.origen).startsWith('ext:')).map((r) => r.origen));
  const pool = L.activeRows.filter((r) => r.debe === banco || r.haber === banco).map((r) => ({ r, v: r.debe === banco ? r.importe : -r.importe, used: false }));
  const dd = (a, b) => Math.abs((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);
  for (const row of rows) {
    if (ext.has(row.origen)) { row.dup = { fecha: row.fecha, concepto: 'importado antes' }; continue; }
    const hit = pool.find((p) => !p.used && Math.abs(p.v - row.importe) < 0.005 && dd(p.r.fecha, row.fecha) <= 3);
    if (hit) { hit.used = true; row.dup = hit.r; }
  }
}
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

export function prepararFilas(L, banco, base) {
  const idx = buildIndex(L); const seen = {};
  const rows = base.filter((r) => r.fecha).map((r, i) => {
    const k = `${banco}|${r.fecha}|${r.importe}|${claveConcepto(r.concepto)}`; seen[k] = (seen[k] || 0) + 1;
    const row = { i, ...r, origen: `ext:${hash(`${k}|${seen[k]}`)}`, inc: true, cat: '', src: '', imp: false, dup: null, previo: !!L.inicio && r.fecha < L.inicio };
    [row.cat, row.src] = sugerir(L, idx, row, banco);
    return row;
  });
  marcarDuplicados(L, banco, rows);
  rows.forEach((r) => { if (r.dup || r.previo) r.inc = false; });
  return rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.i - b.i);
}

export function asientosDeFilas(L, banco, rows) {
  return rows.filter((r) => r.inc && r.cat).map((r) => {
    const k = kindOf(L.byCode[r.cat] || {}); const out = r.importe < 0; const v = Math.abs(r.importe);
    const [debe, haber] = out ? [r.cat, banco] : [banco, r.cat];
    const clase = k === 'gasto' ? (r.imp ? 'imprevisto' : 'corriente') : k === 'ingreso' ? 'ingreso' : 'traspaso';
    return { id: uid(), asiento: uid(), fecha: r.fecha, concepto: r.concepto.slice(0, 120), debe, haber, importe: round2(v), clase, origen: r.origen, notas: '', creado: todayISO(), borrado: '' };
  });
}

// =====================================================================
// 3. Asistente con Claude: prompt + revisión del JSON que devuelve
// =====================================================================
export function promptClaude(L) {
  const kinds = { dinero: 'banco o inversión', deuda: 'deuda', bien: 'bien', gasto: 'gasto', ingreso: 'ingreso' };
  const plan = L.cuentas.filter((c) => kinds[kindOf(c)] && C.isUsable(c)).map((c) => `${c.codigo}  ${c.nombre}  (${kinds[kindOf(c)]}${c.grupo ? ` · ${c.grupo}` : ''})`).join('\n');
  return `Quiero pasar mis gastos e ingresos a Financito, una app de contabilidad personal de doble partida. Te adjunto cómo los llevo ahora (capturas, Excel, Google Sheets o notas). Conviértelos al formato de importación de Financito.

Devuélveme un único bloque \`\`\`json con esta forma:
{
  "Cuentas": [ { "codigo": "608", "nombre": "Mascotas", "tipo": "gasto", "grupo": "Gastos variables", "activa": 1 } ],
  "Diario": [ { "fecha": "2026-03-14", "concepto": "Mercadona", "debe": "600", "haber": "5721", "importe": 42.5, "clase": "corriente" } ]
}

Reglas:
- Cada movimiento tiene dos cuentas: "debe" es a dónde va el dinero y "haber" de dónde sale.
  · Gasto: debe = categoría de gasto (6xx), haber = banco con el que se pagó.
  · Ingreso: debe = banco donde entra, haber = tipo de ingreso (7xx).
  · Traspaso entre mis cuentas (incluido meter dinero en inversiones): debe = la que recibe, haber = la que envía, clase "traspaso".
  · Si no se sabe con qué banco se pagó, usa "119" (Histórico sin cuenta).
- "importe" siempre positivo y con punto decimal. "fecha" en formato AAAA-MM-DD; si solo hay mes, usa el último día del mes.
- "clase": "corriente" (gasto normal), "imprevisto" (gasto grande y excepcional), "ingreso" o "traspaso".
- Usa los códigos de mi plan de cuentas (abajo). Si falta una categoría o un banco, créalo en "Cuentas" con un código libre del mismo grupo (gastos 6xx, ingresos 7xx, bancos 57xx) y tipo "gasto", "ingreso" o "activo". Omite "Cuentas" si no hace falta ninguna.
- Si son totales mensuales y no movimientos sueltos, crea un movimiento por categoría y mes.
- No inventes nada: lo que no se lea bien o sea ambiguo déjalo fuera y, después del JSON, dame una lista con lo que has dejado fuera y por qué.
- Si son muchos movimientos y no caben en una respuesta, divídelos en varias partes (cada una con su bloque JSON completo) y dime cuántas hay.${L.inicio ? `
- Mis saldos empiezan el ${L.inicio}: lo anterior solo cuenta para las estadísticas, así que antes de esa fecha usa "119" como banco si no estás seguro.` : ''}

Mi plan de cuentas:
${plan}`;
}

export function extraerJSON(text) {
  const t = String(text || '').trim();
  const fence = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const cands = fence.length ? fence : [t.slice(Math.min(...['{', '['].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c)))), Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')) + 1)];
  const out = { Cuentas: [], Diario: [], Activos: [], Inversiones: [], Recurrentes: [], Config: {} };
  let ok = 0;
  for (const c of cands) {
    let d; try { d = JSON.parse(c); } catch { continue; }
    ok++;
    if (Array.isArray(d)) { out.Diario.push(...d); continue; }
    for (const k of ['Cuentas', 'Diario', 'Activos', 'Inversiones', 'Recurrentes']) if (Array.isArray(d[k])) out[k].push(...d[k]);
    if (d.Config && typeof d.Config === 'object') Object.assign(out.Config, d.Config);
  }
  if (!ok) throw new Error('No encuentro un JSON válido en lo que has pegado. Copia la respuesta de Claude entera, con el bloque ```json.');
  return out;
}

export function planImport(L, data) {
  const nuevas = (data.Cuentas || []).map((c) => ({ activa: 1, orden: L.cuentas.length + 1, ...c, codigo: String(c.codigo) })).filter((c) => c.codigo && c.nombre && !L.byCode[c.codigo]);
  const codes = new Set([...Object.keys(L.byCode), ...nuevas.map((c) => c.codigo)]);
  const ids = new Set(L.rows.map((r) => String(r.id)));
  const firma = (r) => `${r.fecha}|${r.debe}|${r.haber}|${round2(r.importe)}`;
  const existentes = new Set(L.activeRows.map(firma));
  const errores = []; const repes = []; const diario = [];
  for (const [i, r0] of (data.Diario || []).entries()) {
    let r = { ...r0, debe: String(r0.debe ?? '').trim(), haber: String(r0.haber ?? '').trim(), fecha: normDate(parseDate(r0.fecha) || r0.fecha), importe: round2(typeof r0.importe === 'number' ? r0.importe : parseNum(r0.importe)) };
    if (r.importe < 0) r = { ...r, debe: r.haber, haber: r.debe, importe: -r.importe };
    const why = !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? 'fecha no válida' : !(r.importe > 0) ? 'importe no válido' : !codes.has(r.debe) ? `no existe la cuenta ${r.debe || '(vacía)'}` : !codes.has(r.haber) ? `no existe la cuenta ${r.haber || '(vacía)'}` : r.debe === r.haber ? 'las dos cuentas son la misma' : '';
    if (why) { errores.push({ n: i + 1, r, why }); continue; }
    if ((r.id && ids.has(String(r.id))) || existentes.has(firma(r))) { repes.push(r); continue; }
    existentes.add(firma(r));
    diario.push({ id: r.id || uid(), asiento: r.asiento || uid(), concepto: String(r.concepto || '').slice(0, 120) || 'Movimiento', clase: r.clase || 'corriente', origen: r.origen || 'importado', notas: r.notas || '', creado: todayISO(), borrado: '', fecha: r.fecha, debe: r.debe, haber: r.haber, importe: r.importe });
  }
  const byId = (t) => new Map((L.db[t] || []).map((x) => [String(x.id), x]));
  const actIds = byId('Activos'); const invIds = byId('Inversiones'); const recIds = byId('Recurrentes');
  return {
    cuentas: nuevas, diario, errores, repes,
    activos: (data.Activos || []).filter((x) => !actIds.has(String(x.id))).map((x) => ({ id: uid(), ...x })),
    inversiones: (data.Inversiones || []).filter((x) => !invIds.has(String(x.id))).map((x) => ({ id: uid(), ...x })),
    recUpd: (data.Recurrentes || []).filter((x) => x.id && recIds.has(String(x.id))).map((x) => ({ ...recIds.get(String(x.id)), ...x })),
    recNew: (data.Recurrentes || []).filter((x) => !x.id || !recIds.has(String(x.id))).map((x) => ({ id: uid(), ...x })),
    config: Object.entries(data.Config || {}),
  };
}
async function ejecutarPlan(p) {
  const { S } = C;
  if (p.cuentas.length) await S.store.add('Cuentas', p.cuentas);
  for (let i = 0; i < p.diario.length; i += 400) await S.store.add('Diario', p.diario.slice(i, i + 400));
  if (p.activos.length) await S.store.add('Activos', p.activos);
  if (p.inversiones.length) await S.store.add('Inversiones', p.inversiones);
  if (p.recUpd.length) await S.store.update('Recurrentes', p.recUpd);
  if (p.recNew.length) await S.store.add('Recurrentes', p.recNew);
  for (const [k, v] of p.config) await C.setConfig(k, v);
}

// =====================================================================
// 4. Interfaz (ruta #/importar)
// =====================================================================
const st = () => (C.S.imp ??= { tab: 'extracto', step: 'inicio', filtro: 'pend' });
export function abrirImportar(tab = 'extracto', extra = {}) { C.S.imp = { tab, step: 'inicio', filtro: 'pend', ...extra }; if (location.hash === '#/importar') C.render(); else location.hash = '#/importar'; }

export function viewImportar() {
  const s = st(); const { esc } = C;
  C.view().innerHTML = `<div class="seg imp-tabs" style="margin-bottom:12px"><button data-tab="extracto" class="${s.tab === 'extracto' ? 'on' : ''}">🏦 Extracto del banco</button><button data-tab="claude" class="${s.tab === 'claude' ? 'on' : ''}">✨ Con ayuda de Claude</button></div><div id="impx"></div>`;
  C.$$('[data-tab]').forEach((b) => { b.onclick = () => { if (b.dataset.tab !== s.tab) { C.S.imp = { tab: b.dataset.tab, step: 'inicio', filtro: 'pend' }; viewImportar(); } }; });
  (s.tab === 'claude' ? pasoClaude : pasoExtracto)(C.$('#impx'), esc);
}

// ---------- extracto ----------
function pasoExtracto(box, esc) {
  const s = st(); const L = C.S.libro;
  if (s.step === 'mapa') return pasoMapa(box, esc);
  if (s.step === 'clasificar') return pasoClasificar(box, esc);
  if (s.step === 'hecho') {
    box.innerHTML = `<div class="card center"><div style="font-size:40px">✅</div><h2 style="margin:6px 0">${s.hecho} movimiento${s.hecho === 1 ? '' : 's'} importado${s.hecho === 1 ? '' : 's'}</h2><p class="muted small">En ${esc(L.nombre(s.banco))}. Los que hayas dejado fuera no se han tocado.</p>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><a class="btn" href="#/diario" id="verimp">Ver movimientos</a><button class="btn primary" id="otro">Importar otro extracto</button></div></div>`;
    C.$('#verimp').onclick = () => { C.S.diario = { ...C.S.diario, cuenta: s.banco, mes: '', q: '' }; };
    C.$('#otro').onclick = () => abrirImportar('extracto', { banco: s.banco });
    return;
  }
  const bancos = L.cuentas.filter((c) => ['dinero', 'deuda'].includes(kindOf(c)) && C.isUsable(c));
  s.banco ??= L.principal && L.byCode[L.principal] ? L.principal : bancos[0]?.codigo;
  const c = L.byCode[s.banco];
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">Importar un extracto</h2>
      <p class="small muted" style="margin-top:0">Descarga los movimientos desde la web o la app de tu banco y súbelos aquí. Después los repasas uno a uno: Financito propone la categoría según lo que ya tienes apuntado y avisa de los que ya están.</p>
      <div class="field"><label class="lbl">¿De qué cuenta es el extracto?</label><button type="button" class="picker" id="ibanco"><span class="pk-ic">${C.emojiFor(c)}</span><span class="pk-txt"><span class="pk-name">${esc(c?.nombre || 'Elegir…')}</span><span class="pk-sub">${esc(c ? displayGroup(c) : '')}</span></span><span class="pk-caret">›</span></button></div>
      <label class="btn primary block" for="ifile">Elegir archivo del banco…</label><input type="file" id="ifile" hidden accept=".csv,.txt,.tsv,.xls,.xlsx,.ods,.n43,.aeb,.q43,.csb,.xml,.ofx,.qfx">
      <div id="ierr"></div></div>
    <details class="card" style="margin-top:12px"><summary>Qué formatos valen y cómo sacarlos</summary>
      <ul class="small" style="padding-left:18px;margin-bottom:0">
        <li><strong>Excel o CSV:</strong> lo que da casi cualquier banco con «Descargar movimientos» o «Exportar» (Openbank, Revolut, BBVA, CaixaBank, ING, Santander…). Si el archivo es raro, te dejo decir qué columna es cada cosa.</li>
        <li><strong>Norma 43</strong> (.n43, .txt, también llamado AEB 43 o CSB 43): el formato estándar de los bancos españoles, en la banca online de empresa o «exportar en formato Norma 43».</li>
        <li><strong>CAMT.053</strong> (.xml): el extracto europeo ISO 20022. SEPA en sí es para órdenes de pago; para extractos el estándar es este.</li>
        <li><strong>OFX / QFX:</strong> el formato de Money y Quicken, que dan algunos bancos y brokers.</li>
      </ul></details>`;
  C.$('#ibanco').onclick = () => C.openPicker({ title: 'Cuenta del extracto', selected: s.banco, filter: (x) => ['dinero', 'deuda'].includes(kindOf(x)), onPick: (code) => { s.banco = code; viewImportar(); } });
  C.$('#ifile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const err = C.$('#ierr'); err.innerHTML = '<p class="small muted"><span class="spin"></span> Leyendo…</p>';
    try {
      const f = await readFile(file); s.file = file.name;
      if (f.kind === 'text') {
        const fmt = detectFormat(file.name, f.text);
        if (fmt !== 'csv') {
          const base = fmt === 'n43' ? parseN43(f.text) : fmt === 'camt' ? parseCAMT(f.text) : parseOFX(f.text);
          if (!base.length) throw new Error('El archivo no tiene movimientos que pueda leer.');
          s.formato = { n43: 'Norma 43', camt: 'CAMT.053', ofx: 'OFX' }[fmt];
          s.rows = prepararFilas(L, s.banco, base); s.step = 'clasificar'; s.filtro = 'pend'; viewImportar(); return;
        }
        s.table = parseCSV(f.text);
      } else s.table = f.table;
      if (s.table.length < 2) throw new Error('El archivo está vacío o no tiene filas.');
      s.formato = /\.xls|\.ods/i.test(file.name) ? 'Excel' : 'CSV';
      ({ map: s.map } = guessMapping(s.table)); s.step = 'mapa'; viewImportar();
    } catch (ex) { err.innerHTML = `<div class="banner warn" style="margin-top:10px">${esc(ex.message || ex)}</div>`; } finally { e.target.value = ''; }
  };
}

function pasoMapa(box, esc) {
  const s = st(); const L = C.S.libro; const m = s.map;
  const head = (s.table[m.header] || []).map((h, i) => String(h ?? '').trim() || `Columna ${i + 1}`);
  const ncol = Math.max(...s.table.slice(m.header, m.header + 20).map((r) => r.length));
  const cols = [...Array(ncol).keys()].map((i) => head[i] || `Columna ${i + 1}`);
  const sel = (key, label, opt = false) => `<div class="field"><label class="lbl" for="mp_${key}">${label}</label><select id="mp_${key}" data-map="${key}">${opt ? '<option value="-1">— ninguna —</option>' : ''}${cols.map((h, i) => `<option value="${i}" ${m[key] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`;
  const sep = m.importe < 0;
  const { rows, skipped } = rowsFromTable(s.table, m);
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">¿Qué es cada columna?</h2>
    <p class="small muted" style="margin-top:0">${esc(s.file)} · ${esc(s.formato)}. Lo he adivinado yo; corrígelo si algo no cuadra con la vista previa de abajo.</p>
    <div class="field"><label class="lbl" for="mp_header">La cabecera está en la fila</label><select id="mp_header" data-map="header">${s.table.slice(0, 30).map((r, i) => `<option value="${i}" ${m.header === i ? 'selected' : ''}>${i + 1}: ${esc(r.slice(0, 4).map((x) => String(x ?? '')).join(' · ').slice(0, 60))}</option>`).join('')}</select></div>
    <div class="two">${sel('fecha', 'Fecha')}${sel('concepto', 'Concepto')}</div>
    <div class="seg mini" style="margin:4px 0 10px"><button type="button" data-sep="0" class="${sep ? '' : 'on'}">Un importe con signo</button><button type="button" data-sep="1" class="${sep ? 'on' : ''}">Cargo y abono aparte</button></div>
    ${sep ? `<div class="two">${sel('cargo', 'Cargos (lo que sale)', true)}${sel('abono', 'Abonos (lo que entra)', true)}</div>` : sel('importe', 'Importe')}
    <div class="two">${sel('comision', 'Comisión (opcional)', true)}${sel('estado', 'Estado (opcional)', true)}</div>
    <label class="check small"><input type="checkbox" id="mp_inv" ${m.invertir ? 'checked' : ''}> Los gastos vienen en positivo (darles la vuelta a los signos)</label>
    </div>
    <div class="card" style="margin-top:12px"><div class="row between"><h3 style="margin:0">Vista previa</h3><span class="small muted">${rows.length} movimiento${rows.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} fila${skipped > 1 ? 's' : ''} ignorada${skipped > 1 ? 's' : ''}` : ''}</span></div>
      <table class="ci-t keep" style="margin-top:6px"><thead><tr><th>Fecha</th><th>Concepto</th><th class="n">Importe</th></tr></thead><tbody>${rows.slice(0, 6).map((r) => `<tr><td>${esc(C.shortDate(r.fecha))}</td><td>${esc(r.concepto)}</td><td class="n ${r.importe < 0 ? 'neg' : 'pos'}">${eur(r.importe)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No sale ningún movimiento con esta configuración.</td></tr>'}</tbody></table></div>
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="mpback">Atrás</button><button class="btn primary grow" id="mpok" ${rows.length ? '' : 'disabled'}>Seguir con ${rows.length} movimientos</button></div>`;
  C.$$('[data-map]', box).forEach((x) => { x.onchange = () => { m[x.dataset.map] = Number(x.value); pasoMapa(box, esc); }; });
  C.$$('[data-sep]', box).forEach((b) => { b.onclick = () => { if (b.dataset.sep === '1') { m.cargo = m.cargo >= 0 ? m.cargo : m.importe; m.abono = m.abono >= 0 ? m.abono : -1; m.importe = -1; } else { m.importe = m.importe >= 0 ? m.importe : Math.max(m.cargo, m.abono, 0); } pasoMapa(box, esc); }; });
  C.$('#mp_inv').onchange = (e) => { m.invertir = e.target.checked; pasoMapa(box, esc); };
  C.$('#mpback').onclick = () => { s.step = 'inicio'; viewImportar(); };
  C.$('#mpok').onclick = () => { s.rows = prepararFilas(L, s.banco, rows); s.step = 'clasificar'; s.filtro = 'pend'; viewImportar(); };
}

const FILTROS = [['pend', 'Por clasificar'], ['inc', 'Se importan'], ['dup', 'Ya apuntados'], ['out', 'Fuera'], ['all', 'Todos']];
function pasoClasificar(box, esc) {
  const s = st(); const L = C.S.libro; const rows = s.rows;
  const n = { pend: rows.filter((r) => r.inc && !r.cat).length, inc: rows.filter((r) => r.inc).length, dup: rows.filter((r) => r.dup).length, out: rows.filter((r) => !r.inc).length, all: rows.length };
  const listos = rows.filter((r) => r.inc && r.cat).length;
  if (s.filtro === 'pend' && !n.pend) s.filtro = 'inc';
  const vis = rows.filter((r) => ({ pend: r.inc && !r.cat, inc: r.inc, dup: !!r.dup, out: !r.inc, all: true }[s.filtro]));
  const catBtn = (r) => {
    const c = L.byCode[r.cat];
    return c ? `<button class="ix-cat" data-cat="${r.i}" title="Cambiar"><span>${C.emojiFor(c)}</span> ${esc(c.nombre)}${r.src ? `<small>${{ historial: 'como otras veces', palabras: 'por el nombre', cuenta: 'traspaso' }[r.src] || ''}</small>` : ''}</button>`
      : `<button class="ix-cat none" data-cat="${r.i}">${r.importe < 0 ? 'Elegir categoría…' : 'Elegir de dónde viene…'}</button>`;
  };
  const chip = (r) => [r.dup ? `<span class="chip">ya apuntado${r.dup.concepto ? `: ${esc(String(r.dup.concepto).slice(0, 28))}` : ''}${r.dup.fecha && r.dup.fecha !== r.fecha ? ` (${esc(C.shortDate(r.dup.fecha))})` : ''}</span>` : '', r.previo ? '<span class="chip">antes de tu apertura</span>' : ''].join('');
  box.innerHTML = `<div class="ix-bar card"><div class="grow"><strong>${esc(L.nombre(s.banco))}</strong> <span class="small muted">· ${esc(s.file || '')} (${esc(s.formato || '')})</span>
      <div class="small">${rows.length} movimientos · <span class="${n.pend ? 'neg' : 'pos'}">${n.pend ? `${n.pend} sin clasificar` : 'todo clasificado'}</span> · ${n.dup} ya apuntados</div></div>
      <button class="btn primary" id="ixgo" ${listos ? '' : 'disabled'}>Importar ${listos}</button></div>
    <div class="gchips" style="margin:10px 0">${FILTROS.map(([k, l]) => `<button class="gchip ${s.filtro === k ? 'on' : ''}" data-f="${k}">${l} <small>${n[k]}</small></button>`).join('')}</div>
    <p class="small muted" style="margin:0 0 8px">${{ pend: 'Elige la categoría de cada uno. Al clasificar uno, los que se llaman parecido se clasifican igual.', inc: 'Esto es lo que se va a importar. Toca la categoría para cambiarla.', dup: 'Ya hay un movimiento igual en esta cuenta (mismo importe, ±3 días). Por eso están fuera; márcalos si de verdad son otros.', out: 'Estos no se importan. Márcalos para incluirlos.', all: '' }[s.filtro]}</p>
    <div class="card ix-list">${vis.map((r) => `<div class="ix-row ${r.inc ? '' : 'off'}">
        <input type="checkbox" data-inc="${r.i}" ${r.inc ? 'checked' : ''} aria-label="Importar este movimiento">
        <div class="ix-main"><div class="ix-top"><span class="ix-date">${esc(C.shortDate(r.fecha))}</span><span class="ix-con">${esc(r.concepto)}</span><span class="ix-amt ${r.importe < 0 ? 'neg' : 'pos'}">${eur(r.importe)}</span></div>
          <div class="ix-bot">${catBtn(r)}${r.cat && kindOf(L.byCode[r.cat] || {}) === 'gasto' && r.importe < 0 ? `<button class="gchip sm ${r.imp ? 'on' : ''}" data-imp="${r.i}">${r.imp ? '✓ ' : ''}Imprevisto</button>` : ''}${chip(r)}</div></div></div>`).join('') || '<div class="empty">Nada en esta lista.</div>'}</div>
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="ixback">Empezar de nuevo</button></div>`;
  const byI = (i) => rows.find((r) => r.i === Number(i));
  C.$$('[data-f]', box).forEach((b) => { b.onclick = () => { s.filtro = b.dataset.f; pasoClasificar(box, esc); }; });
  C.$$('[data-inc]', box).forEach((x) => { x.onchange = () => { byI(x.dataset.inc).inc = x.checked; pasoClasificar(box, esc); }; });
  C.$$('[data-imp]', box).forEach((b) => { b.onclick = () => { const r = byI(b.dataset.imp); r.imp = !r.imp; pasoClasificar(box, esc); }; });
  C.$$('[data-cat]', box).forEach((b) => {
    b.onclick = () => {
      const r = byI(b.dataset.cat); const out = r.importe < 0;
      C.openPicker({
        title: `${out ? '¿En qué se gastó' : '¿Qué es'} «${r.concepto.slice(0, 40)}»?`, selected: r.cat, createKind: out ? 'gasto' : 'ingreso',
        filter: (c) => c.codigo !== s.banco && (out ? (C.isGasto(c) || C.isPayer(c)) : (C.isIngreso(c) || C.isPayer(c) || C.isGasto(c))),
        onPick: (code) => {
          r.cat = code; r.src = ''; r.inc = true;
          const k = claveConcepto(r.concepto); let extra = 0;
          if (k) for (const o of rows) if (o !== r && !o.cat && !o.dup && Math.sign(o.importe) === Math.sign(r.importe) && claveConcepto(o.concepto) === k) { o.cat = code; o.src = 'historial'; extra++; }
          pasoClasificar(box, esc); if (extra) C.toast(`Y ${extra} parecido${extra > 1 ? 's' : ''} más`);
        },
      });
    };
  });
  C.$('#ixback').onclick = () => { if (confirm('¿Descartar este extracto y empezar de nuevo?')) abrirImportar('extracto', { banco: s.banco }); };
  C.$('#ixgo').onclick = async () => {
    const asientos = asientosDeFilas(L, s.banco, rows);
    const sin = rows.filter((r) => r.inc && !r.cat).length;
    if (!confirm(`Se importarán ${asientos.length} movimientos en ${L.nombre(s.banco)}.${sin ? `\n${sin} sin clasificar se quedan fuera.` : ''}\n\n¿Seguir?`)) return;
    const btn = C.$('#ixgo'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try {
      for (let i = 0; i < asientos.length; i += 400) await C.S.store.add('Diario', asientos.slice(i, i + 400));
      await C.reload(); s.hecho = asientos.length; s.step = 'hecho'; s.rows = null; s.table = null; viewImportar();
    } catch (e) { C.fail(e); pasoClasificar(box, esc); }
  };
}

// ---------- con Claude ----------
function pasoClaude(box, esc) {
  const s = st(); const L = C.S.libro;
  if (s.step === 'revisar') return revisarJSON(box, esc);
  if (s.step === 'hecho') {
    box.innerHTML = `<div class="card center"><div style="font-size:40px">✅</div><h2 style="margin:6px 0">Importado</h2><p class="muted small">${esc(s.hecho)}</p><div class="row" style="justify-content:center;gap:8px"><a class="btn" href="#/diario">Ver movimientos</a><button class="btn primary" id="otro">Importar otra parte</button></div></div>`;
    C.$('#otro').onclick = () => abrirImportar('claude', { step: 'inicio' }); return;
  }
  const prompt = promptClaude(L);
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">Pásalo todo con Claude</h2>
      <p class="small muted" style="margin-top:0">Si llevas las cuentas en un Excel, en Google Sheets, en notas o en capturas de la app del banco, Claude lo convierte al formato de Financito. Tú solo revisas el resultado antes de importarlo.</p>
      <ol class="ix-steps">
        <li><strong>Copia estas instrucciones.</strong> Llevan tu plan de cuentas, así Claude usa tus categorías.
          <textarea readonly rows="6" class="ix-prompt" id="cprompt">${esc(prompt)}</textarea>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" id="ccopy">Copiar instrucciones</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Abrir Claude ↗</a></div></li>
        <li><strong>En Claude, pega las instrucciones y adjunta tus archivos:</strong> capturas, Excel o CSV. Si está en Google Sheets, descárgalo como Excel (Archivo → Descargar) o conecta Google Drive en Claude.</li>
        <li><strong>Pega aquí la respuesta de Claude</strong> (entera, no hace falta limpiarla) o sube el .json:
          <textarea rows="5" id="cjson" placeholder="Pega aquí lo que te ha devuelto Claude…">${esc(s.text || '')}</textarea>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" id="crev">Revisar antes de importar</button><label class="btn" for="cfile">Subir .json</label><input type="file" id="cfile" accept=".json,application/json,.txt" hidden></div>
          <div id="cerr"></div></li>
      </ol></div>`;
  C.$('#ccopy').onclick = async () => { try { await navigator.clipboard.writeText(prompt); C.toast('Instrucciones copiadas'); } catch { C.$('#cprompt').select(); document.execCommand('copy'); C.toast('Instrucciones copiadas'); } };
  const revisar = (text) => {
    s.text = text;
    try { s.plan = planImport(L, extraerJSON(text)); s.step = 'revisar'; viewImportar(); } catch (e) { C.$('#cerr').innerHTML = `<div class="banner warn" style="margin-top:10px">${esc(e.message)}</div>`; }
  };
  C.$('#crev').onclick = () => revisar(C.$('#cjson').value);
  C.$('#cfile').onchange = async (e) => { const f = e.target.files[0]; if (f) revisar(await f.text()); e.target.value = ''; };
  if (s.autoText) { const t = s.autoText; s.autoText = null; revisar(t); }
}

function revisarJSON(box, esc) {
  const s = st(); const L = C.S.libro; const p = s.plan;
  const nombre = (code) => L.byCode[code]?.nombre || p.cuentas.find((c) => c.codigo === code)?.nombre || code;
  const partes = [p.diario.length && `${p.diario.length} movimiento${p.diario.length > 1 ? 's' : ''}`, p.cuentas.length && `${p.cuentas.length} cuenta${p.cuentas.length > 1 ? 's' : ''} nueva${p.cuentas.length > 1 ? 's' : ''}`, p.activos.length && `${p.activos.length} bien${p.activos.length > 1 ? 'es' : ''}`,
    (p.recUpd.length + p.recNew.length) && `${p.recUpd.length + p.recNew.length} automatizaci${p.recUpd.length + p.recNew.length > 1 ? 'ones' : 'ón'}`, p.inversiones.length && `${p.inversiones.length} inversi${p.inversiones.length > 1 ? 'ones' : 'ón'}`, p.config.length && 'ajustes'].filter(Boolean);
  const years = {}; p.diario.forEach((r) => { years[r.fecha.slice(0, 4)] = (years[r.fecha.slice(0, 4)] || 0) + 1; });
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">Revisa antes de importar</h2>
      <p style="margin:0 0 6px">${partes.length ? `Se importará: <strong>${esc(partes.join(', '))}</strong>.` : 'No hay nada nuevo que importar.'}</p>
      ${Object.keys(years).length ? `<p class="small muted" style="margin:0">Movimientos por año: ${Object.entries(years).sort().map(([y, k]) => `${y}: ${k}`).join(' · ')}</p>` : ''}
      ${p.repes.length ? `<p class="small muted" style="margin:6px 0 0">${p.repes.length} ya estaban en tu libro (misma fecha, cuentas e importe): se saltan.</p>` : ''}
      ${p.errores.length ? `<div class="banner warn" style="margin-top:10px"><strong>${p.errores.length} con problemas, no se importan:</strong><ul class="small" style="margin:4px 0 0;padding-left:18px">${p.errores.slice(0, 8).map((e) => `<li>Fila ${e.n} (${esc(e.r.concepto || '')}): ${esc(e.why)}</li>`).join('')}${p.errores.length > 8 ? `<li>… y ${p.errores.length - 8} más</li>` : ''}</ul></div>` : ''}
    </div>
    ${p.cuentas.length ? `<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Cuentas nuevas</h3><ul class="list">${p.cuentas.map((c) => `<li><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">${esc(c.codigo)} · ${esc(c.tipo)}${c.grupo ? ` · ${esc(c.grupo)}` : ''}</div></div></li>`).join('')}</ul></div>` : ''}
    ${p.diario.length ? `<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Movimientos${p.diario.length > 150 ? ' (los 150 primeros)' : ''}</h3><div class="tablewrap"><table class="ci-t keep"><thead><tr><th>Fecha</th><th>Concepto</th><th>Va a</th><th>Sale de</th><th class="n">Importe</th></tr></thead><tbody>
      ${p.diario.slice(0, 150).map((r) => `<tr><td style="white-space:nowrap">${esc(C.shortDate(r.fecha))}</td><td>${esc(r.concepto)}${r.clase === 'imprevisto' ? ' <span class="chip imprevisto">imprevisto</span>' : ''}</td><td>${esc(nombre(r.debe))}</td><td>${esc(nombre(r.haber))}</td><td class="n">${eur(r.importe)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="rback">Atrás</button><button class="btn primary grow" id="rgo" ${partes.length ? '' : 'disabled'}>Importar</button></div>`;
  C.$('#rback').onclick = () => { s.step = 'inicio'; viewImportar(); };
  C.$('#rgo').onclick = async () => {
    const btn = C.$('#rgo'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { await ejecutarPlan(p); await C.reload(); s.hecho = partes.join(', '); s.step = 'hecho'; s.text = ''; viewImportar(); } catch (e) { C.fail(e); btn.disabled = false; btn.textContent = 'Importar'; }
  };
}
