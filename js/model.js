// Modelo contable: esquema de la hoja, plan de cuentas y cálculos (mayor, PyG, balance, automatizaciones).

export const TABLES = {
  Cuentas: ['codigo', 'nombre', 'tipo', 'grupo', 'orden', 'activa'],
  Diario: ['id', 'asiento', 'fecha', 'concepto', 'debe', 'haber', 'importe', 'clase', 'origen', 'notas', 'creado', 'borrado', 'confirmado'],
  Recurrentes: ['id', 'nombre', 'dia', 'debe', 'haber', 'importe', 'clase', 'desde', 'hasta', 'activo'],
  Activos: ['id', 'nombre', 'cuenta', 'fecha_alta', 'valor', 'vida_meses', 'residual', 'activo'],
  Prestamos: ['id', 'nombre', 'capital', 'interes_anual', 'plazo_meses', 'primera_cuota', 'cuenta_banco', 'cuenta_pasivo', 'cuenta_interes', 'activo', 'participacion'],
  Presupuesto: ['id', 'mes', 'cuenta', 'importe', 'borrado'],
  Saldos: ['id', 'fecha', 'cuenta', 'saldo', 'notas'],
  Reparto: ['id', 'orden', 'hacia', 'importe', 'activo', 'borrado'],
  RepartoMes: ['id', 'mes', 'linea', 'hacia', 'importe', 'borrado'],
  Inversiones: ['id', 'nombre', 'tipo', 'cuenta', 'fecha_inicio', 'importe_inicial', 'valor_actual', 'fecha_valor', 'fecha_fin', 'importe_final', 'notas', 'borrado'],
  Config: ['clave', 'valor'],
};

// tipo: activo | pasivo | patrimonio | ingreso | gasto
// grupo: agrupación para pantallas e informes
export const CUENTAS_INICIALES = [
  ['100', 'Patrimonio inicial', 'patrimonio', 'Patrimonio neto'],
  ['119', 'Histórico sin cuenta', 'patrimonio', 'Patrimonio neto'],
  ['170', 'Hipoteca', 'pasivo', 'Deudas'],
  ['211', 'Piso', 'activo', 'Inmovilizado'],
  ['216', 'Mobiliario y hogar', 'activo', 'Inmovilizado'],
  ['217', 'Equipos informáticos', 'activo', 'Inmovilizado'],
  ['218', 'Vehículos', 'activo', 'Inmovilizado'],
  ['281', 'Amortización acumulada', 'activo', 'Inmovilizado'],
  ['540', 'Trade Republic', 'activo', 'Inversiones'],
  ['5701', 'Efectivo', 'activo', 'Tesorería'],
  ['5721', 'Mediolanum', 'activo', 'Tesorería'],
  ['5722', 'Revolut Ana', 'activo', 'Tesorería'],
  ['5723', 'Revolut Coche', 'activo', 'Tesorería'],
  ['5724', 'Revolut Caprichos', 'activo', 'Tesorería'],
  ['5725', 'Openbank', 'activo', 'Tesorería'],
  ['5726', 'Revolut Extraordinarios', 'activo', 'Tesorería'],
  ['600', 'Súper y casa', 'gasto', 'Gastos variables'],
  ['601', 'Coche y transporte', 'gasto', 'Gastos variables'],
  ['602', 'Salud y cuidado', 'gasto', 'Gastos variables'],
  ['603', 'Ocio y social', 'gasto', 'Gastos variables'],
  ['604', 'Compras y proyectos', 'gasto', 'Gastos variables'],
  ['605', 'Viajes', 'gasto', 'Gastos variables'],
  ['620', 'Mamá', 'gasto', 'Gastos fijos'],
  ['625', 'Seguros', 'gasto', 'Gastos fijos'],
  ['629', 'Suscripciones', 'gasto', 'Gastos fijos'],
  ['6291', 'Gimnasio', 'gasto', 'Gastos fijos'],
  ['659', 'Descuadres', 'gasto', 'Otros gastos'],
  ['662', 'Intereses hipoteca', 'gasto', 'Gastos financieros'],
  ['663', 'Pérdidas en inversiones', 'gasto', 'Gastos financieros'],
  ['681', 'Amortización', 'gasto', 'Amortizaciones'],
  ['700', 'Nómina', 'ingreso', 'Ingresos'],
  ['705', 'Trabajo por cuenta propia', 'ingreso', 'Ingresos'],
  ['706', 'Comisiones', 'ingreso', 'Ingresos'],
  ['707', 'Cheques Amazon', 'ingreso', 'Ingresos'],
  ['759', 'Descuadres a favor', 'ingreso', 'Otros ingresos'],
  ['763', 'Ganancias en inversiones', 'ingreso', 'Ingresos financieros'],
  ['769', 'Otros ingresos financieros', 'ingreso', 'Ingresos financieros'],
  ['778', 'Ingresos excepcionales', 'ingreso', 'Otros ingresos'],
].map(([codigo, nombre, tipo, grupo], i) => ({ codigo, nombre, tipo, grupo, orden: i + 1, activa: 1 }));

export const RECURRENTES_INICIALES = [
  { nombre: 'Mamá', dia: 1, debe: '620', haber: '5721', importe: 250, clase: 'corriente', desde: '2027-01', hasta: '', activo: 0 },
  { nombre: 'Gimnasio', dia: 1, debe: '6291', haber: '5721', importe: 38.33, clase: 'corriente', desde: '2027-01', hasta: '', activo: 0 },
  { nombre: 'Suscripciones (Netflix, iCloud, GPT, internet)', dia: 1, debe: '629', haber: '5721', importe: 54, clase: 'corriente', desde: '2027-01', hasta: '', activo: 0 },
  { nombre: 'Fondo extraordinarios', dia: 1, debe: '5726', haber: '5721', importe: 100, clase: 'traspaso', desde: '2027-01', hasta: '', activo: 0 },
];

export const CLASES = {
  corriente: 'Corriente',
  imprevisto: 'Imprevisto',
  patrimonial: 'Patrimonial',
  ingreso: 'Ingreso',
  traspaso: 'Traspaso',
  amortizacion: 'Amortización',
  apertura: 'Apertura',
  ajuste: 'Ajuste',
  historico: 'Histórico',
};

// ---------- utilidades ----------
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 12);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s|€/g, '');
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
};
export const truthy = (v) => v === true || v === 1 || v === '1' || v === 'TRUE' || v === 'true' || v === 'sí';
export const pad = (n) => String(n).padStart(2, '0');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const ym = (iso) => String(iso).slice(0, 7);
export const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
export const addMonths = (ymStr, k) => {
  const [y, m] = ymStr.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
export const monthsBetween = (a, b) => { // inclusive list of YYYY-MM
  const out = []; let cur = a; let guard = 0;
  while (cur <= b && guard++ < 1200) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
};
const dateInMonth = (ymStr, day) => {
  const [y, m] = ymStr.split('-').map(Number);
  return `${ymStr}-${pad(Math.min(Math.max(1, Number(day) || 1), lastDay(y, m)))}`;
};
export const normDate = (v) => {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if (typeof v === 'number') { // número de serie de Sheets
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return s;
};

// ---------- libro ----------
export class Libro {
  constructor(db) { this.set(db); }

  set(db) {
    this.db = db;
    this.cuentas = (db.Cuentas || []).filter((c) => c.codigo !== '' && c.codigo !== undefined)
      .map((c) => ({ ...c, codigo: String(c.codigo) }))
      .sort((a, b) => num(a.orden) - num(b.orden) || a.codigo.localeCompare(b.codigo));
    this.byCode = Object.fromEntries(this.cuentas.map((c) => [c.codigo, c]));
    this.rows = (db.Diario || []).map((r) => ({
      ...r, debe: String(r.debe), haber: String(r.haber), importe: num(r.importe), fecha: normDate(r.fecha),
    }));
    this.activeRows = this.rows.filter((r) => !truthy(r.borrado) && r.fecha);
    this.config = Object.fromEntries((db.Config || []).map((c) => [c.clave, c.valor]));
    // Fecha desde la que se llevan saldos (asiento de apertura). Lo anterior solo cuenta para estadísticas (PyG, gráficos).
    this.inicio = normDate(this.config.inicio || '');
    this.balRows = this.inicio ? this.activeRows.filter((r) => r.fecha >= this.inicio) : this.activeRows;
    this._index();
  }

  _index() {
    // mov[codigo][YYYY-MM] = { d, h }  (todos)   movB: solo desde el inicio de saldos
    const build = (rows) => {
      const mov = {};
      for (const r of rows) {
        const m = ym(r.fecha);
        for (const [code, k] of [[r.debe, 'd'], [r.haber, 'h']]) { mov[code] ??= {}; mov[code][m] ??= { d: 0, h: 0 }; mov[code][m][k] += r.importe; }
      }
      return mov;
    };
    const mov = build(this.activeRows);
    this.movB = this.inicio ? build(this.balRows) : mov;
    this.mov = mov;
    const months = this.activeRows.map((r) => ym(r.fecha)).sort();
    this.firstMonth = months[0] || ym(todayISO());
  }

  tipo(code) { return this.byCode[code]?.tipo || guessTipo(code); }
  nombre(code) { return this.byCode[code]?.nombre || code; }
  label(code) { return `${code} · ${this.nombre(code)}`; }
  debitNormal(code) { const t = this.tipo(code); return t === 'activo' || t === 'gasto'; }

  // movimiento neto (en signo natural de la cuenta) en un mes
  monthNet(code, month) {
    const m = this.mov[code]?.[month]; if (!m) return 0;
    return round2(this.debitNormal(code) ? m.d - m.h : m.h - m.d);
  }
  // saldo acumulado a fin de mes (inclusive)
  balanceAt(code, month) {
    const all = this.movB[code]; if (!all) return 0;
    let s = 0;
    for (const [mm, v] of Object.entries(all)) if (mm <= month) s += this.debitNormal(code) ? v.d - v.h : v.h - v.d;
    return round2(s);
  }
  balanceToDate(code, date = todayISO()) {
    let s = 0;
    for (const r of this.balRows) {
      if (r.fecha > date) continue;
      if (r.debe === code) s += this.debitNormal(code) ? r.importe : -r.importe;
      if (r.haber === code) s += this.debitNormal(code) ? -r.importe : r.importe;
    }
    return round2(s);
  }

  // clase "humana" de una cuenta: dinero (bancos, efectivo, inversiones), bien, deuda, gasto, ingreso, contable
  kind(code) { return kindOf(this.byCode[code] || { codigo: code, tipo: this.tipo(code) }); }

  // PyG por columnas arbitrarias: cols = [{ label, from: 'AAAA-MM', to: 'AAAA-MM' }]
  pygCols(cols) {
    const val = {}; const imp = cols.map(() => 0);
    for (const r of this.activeRows) {
      const m = ym(r.fecha);
      const idx = cols.map((c, i) => (m >= c.from && m <= c.to ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      for (const [code, side] of [[r.debe, 'd'], [r.haber, 'h']]) {
        const t = this.tipo(code);
        if (t !== 'gasto' && t !== 'ingreso') continue;
        const sign = t === 'gasto' ? (side === 'd' ? 1 : -1) : (side === 'h' ? 1 : -1);
        const key = t === 'gasto' && r.clase === 'imprevisto' ? `imp:${code}` : code;
        val[key] ??= cols.map(() => 0);
        for (const i of idx) { val[key][i] += sign * r.importe; if (t === 'gasto' && r.clase === 'imprevisto') imp[i] += sign * r.importe; }
      }
    }
    const codeOf = (k) => k.replace(/^imp:/, '');
    const build = (tipo) => Object.keys(val).filter((k) => this.tipo(codeOf(k)) === tipo)
      .map((k) => ({ key: k, code: codeOf(k), nombre: this.nombre(codeOf(k)), grupo: displayGroup(this.byCode[codeOf(k)]) || '', bloque: this.bloque(codeOf(k), k.startsWith('imp:')), values: val[k].map(round2) }))
      .filter((r) => r.values.some((v) => Math.abs(v) > 0.004))
      .sort((a, b) => a.code.localeCompare(b.code));
    const ingresos = build('ingreso'); const gastos = build('gasto');
    const sum = (list) => cols.map((_, i) => round2(list.reduce((s, r) => s + r.values[i], 0)));
    const ti = sum(ingresos); const tg = sum(gastos);
    return { cols, ingresos, gastos, totalIngresos: ti, totalGastos: tg, resultado: ti.map((v, i) => round2(v - tg[i])), imprevistos: imp.map(round2) };
  }

  // bloque de la PyG: ingresos | fijos | variables | imprevistos | financieros
  bloque(code, imprevisto = false) {
    const t = this.tipo(code);
    if (t === 'ingreso') return 'ingresos';
    if (imprevisto) return 'imprevistos';
    if (['659', '662', '663', '681'].includes(code) || ['Gastos financieros', 'Amortizaciones', 'Otros gastos'].includes(this.byCode[code]?.grupo)) return 'financieros';
    if (this.byCode[code]?.grupo === 'Gastos fijos') return 'fijos';
    return 'variables';
  }

  // ---------- plan del mes (reparto) ----------
  get principal() { return String(this.config.cuenta_principal || (this.byCode['5721'] ? '5721' : '')); }
  get fondo() { return String(this.config.cuenta_fondo || (this.byCode['5726'] ? '5726' : '')); }
  // importe distinto de una automatización solo en un mes (null = sin excepción)
  recOverride(id, m) {
    const o = (this.db.RepartoMes || []).filter((x) => x.mes === m && x.linea === `rec:${id}` && !truthy(x.borrado)).pop();
    return o ? num(o.importe) : null;
  }
    repRow(m, linea) { return this.activeRows.find((r) => r.origen === `rep:${m}:${linea}`); }
  // Plan de un mes: cada mes tiene sus propias líneas (pestaña RepartoMes). Una línea va a una cuenta tuya (reparto) o es una fuente de ingreso (cuenta 7xx).
  planMes(m) {
    const all = (this.db.RepartoMes || []).filter((x) => x.mes === m);
    const rows = all.filter((x) => !truthy(x.borrado) && x.linea !== 'ingresos' && x.hacia !== '' && !String(x.linea).startsWith('rec:'));
    const hasPlan = all.some((x) => !truthy(x.borrado) && !String(x.linea).startsWith('rec:'));
    const lines = []; const ingresos = [];
    for (const x of rows) {
      const code = String(x.hacia); const c = this.byCode[code]; const plan = num(x.importe);
      if (this.tipo(code) === 'ingreso') { ingresos.push({ ...x, linea: String(x.linea || x.id), code, nombre: this.nombre(code), plan, real: this.monthNet(code, m), row: x }); continue; }
      const linea = String(x.linea || x.id);
      const done = this.repRow(m, linea);
      const grupo = code === this.fondo ? 'fondo' : (c?.grupo === 'Inversiones' ? 'ahorro' : 'sobre');
      let gastado = 0;
      if (grupo === 'sobre') for (const r of this.activeRows) if (ym(r.fecha) === m && r.haber === code && this.tipo(r.debe) === 'gasto' && r.clase !== 'imprevisto') gastado += r.importe;
      lines.push({ ...x, linea, code, nombre: this.nombre(code), grupo, plan, real: done ? done.importe : 0, done, gastado: round2(gastado), row: x });
    }
    // fuentes de ingreso que han entrado sin estar en el plan
    const enPlan = new Set(ingresos.map((i) => i.code));
    for (const c of this.allCodes()) {
      if (this.tipo(c) !== 'ingreso' || enPlan.has(c)) continue;
      const v = this.monthNet(c, m); if (Math.abs(v) > 0.004) ingresos.push({ code: c, nombre: this.nombre(c), plan: 0, real: v, extra: true });
    }
    const legacyIng = all.find((x) => x.linea === 'ingresos' && !truthy(x.borrado));
    const ingresosPlan = ingresos.some((i) => !i.extra) ? round2(ingresos.reduce((s, i) => s + i.plan, 0)) : num(legacyIng?.importe ?? 0);
    const ingresosReal = this.ingresoMes(m);
    const fijos = (this.db.Recurrentes || []).filter((r) => r.nombre && !String(r.nombre).endsWith('(borrada)') && (r.clase || 'corriente') === 'corriente' && this.tipo(String(r.debe)) === 'gasto'
      && String(r.desde).slice(0, 7) <= m && (!r.hasta || String(r.hasta).slice(0, 7) >= m))
      .map((r) => {
        const gen = this.activeRows.filter((x) => x.origen === `rec:${r.id}:${m}`);
        const real = gen.reduce((s, x) => s + x.importe, 0);
        const ov = this.recOverride(r.id, m);
        const base = truthy(r.activo) ? num(r.importe) : 0;
        return { id: r.id, nombre: r.nombre, code: String(r.debe), activo: truthy(r.activo), plan: gen.length ? round2(real) : (ov === null ? base : ov), override: ov, real: round2(real), gen: gen[0], rec: r };
      });
    // cuotas de préstamos (tu parte): salen del banco aunque solo los intereses sean gasto
    for (const p of this.db.Prestamos || []) {
      if (!p.nombre || !truthy(p.activo)) continue;
      const f = participacion(p); const q = cuadroPrestamo(p).find((x) => ym(x.fecha) === m); if (!q) continue;
      const real = this.activeRows.filter((x) => String(x.origen).startsWith(`pres:${p.id}:${q.n}:`)).reduce((s, x) => s + x.importe, 0);
      fijos.push({ id: `pres:${p.id}`, prestamo: p, nombre: `${p.nombre}${f < 1 ? ` (tu parte, ${Math.round(f * 100)} %)` : ''}`, code: String(p.cuenta_pasivo || '170'), activo: true, plan: round2(q.cuota * f), real: round2(real), dia: Number(q.fecha.slice(8, 10)) });
    }
    const sum = (l, k) => round2(l.reduce((s, x) => s + x[k], 0));
    const tot = { fijosPlan: sum(fijos, 'plan'), fijosReal: sum(fijos, 'real'), repartoPlan: sum(lines, 'plan'), repartoReal: sum(lines, 'real') };
    const dupes = rows.length - new Set(rows.map((x) => String(x.hacia))).size;
    // los meses que empiezan antes de la apertura ya se repartieron fuera de la app: se dan por hechos
    const previo = !!this.inicio && `${m}-01` < this.inicio;
    for (const l of lines) l.hecho = !!l.done || previo;
    const pendientes = previo ? [] : lines.filter((l) => !l.done && l.plan > 0);
    const hechos = lines.filter((l) => l.done).map((l) => l.done.fecha).sort();
    return {
      m, hasPlan, hasSnap: hasPlan, lines, ingresos, fijos, ingresosPlan, ingresosReal, dupes, ...tot,
      previo, pendientes, fechaReparto: hechos[hechos.length - 1] || '',
      estado: previo ? 'previo' : !lines.length ? 'sin' : !pendientes.length ? 'hecho' : 'pendiente',
      sobrantePlan: round2(ingresosPlan - tot.fijosPlan - tot.repartoPlan),
      sobranteReal: round2(ingresosReal - tot.fijosReal - tot.repartoReal),
    };
  }

  // de dónde copiar el plan para un mes sin plan: el último mes anterior con plan, o la plantilla antigua
  fuentePlan(m) {
    const meses = [...new Set((this.db.RepartoMes || []).filter((x) => !truthy(x.borrado) && x.mes < m && !String(x.linea).startsWith('rec:')).map((x) => x.mes))].sort();
    const prev = meses[meses.length - 1];
    if (prev) return { mes: prev, rows: this.planMes(prev) };
    const tpl = (this.db.Reparto || []).filter((x) => !truthy(x.borrado) && x.hacia !== '');
    if (tpl.length) return { mes: null, tpl: true, rows: { lines: tpl.map((t) => ({ code: String(t.hacia), plan: num(t.importe) })), ingresos: [], ingresosPlan: num(this.config.ingreso_previsto) } };
    return null;
  }

  // dónde ha acabado el ahorro de un mes: variación de cada cuenta de balance
  // ---------- aplicación del ahorro ----------
  isInv(code) { return this.byCode[String(code)]?.grupo === 'Inversiones'; }
  // Destino del resultado entre dos fechas (ISO, inclusivas). Para cada apunte, la parte que toca
  // cuentas de balance suma +importe si va al debe y −importe si va al haber. La suma de todo
  // es exactamente ingresos − gastos (las dos partes de cada asiento se compensan).
  aplicacion(from, to) {
    const G = { inversion: 0, fondo: 0, bancos: 0, bienes: 0, deudas: 0, otros: 0 };
    const det = {};
    const grupo = (c) => {
      const t = this.tipo(c);
      if (t === 'gasto' || t === 'ingreso') return null;
      if (this.isInv(c)) return 'inversion';
      if (c === this.fondo) return 'fondo';
      const k = this.kind(c);
      if (k === 'dinero') return 'bancos';
      if (k === 'deuda') return 'deudas';
      if (k === 'bien' || String(c).startsWith('28')) return 'bienes';
      return 'otros';
    };
    for (const r of this.activeRows) {
      if (r.fecha < from || r.fecha > to || r.clase === 'apertura') continue; // la apertura no es ahorro
      for (const [c, sg] of [[r.debe, 1], [r.haber, -1]]) {
        const g = grupo(String(c)); if (!g) continue;
        G[g] += sg * r.importe; det[c] = (det[c] || 0) + sg * r.importe;
      }
    }
    Object.keys(G).forEach((k) => { G[k] = round2(G[k]); });
    const detalle = Object.entries(det).map(([code, v]) => ({ code, nombre: this.nombre(code), grupo: grupo(code), v: round2(v) })).filter((x) => Math.abs(x.v) > 0.004);
    return { ...G, total: round2(Object.values(G).reduce((a, b) => a + b, 0)), detalle };
  }
  // dinero nuevo metido en cuentas de inversión (traspasos netos desde otras cuentas; sin revalorizaciones)
  invertido(from, to) {
    let s = 0;
    for (const r of this.activeRows) {
      if (r.fecha < from || r.fecha > to) continue;
      const di = this.isInv(r.debe); const hi = this.isInv(r.haber);
      // desde cualquier cuenta de balance (bancos o, en el histórico, «sin cuenta»); nunca revalorizaciones de la PyG
      const bal = (c) => !['gasto', 'ingreso'].includes(this.tipo(c));
      if (di && !hi && bal(r.haber)) s += r.importe;
      if (hi && !di && bal(r.debe)) s -= r.importe;
    }
    return round2(s);
  }

  dondeAhorro(m) {
    const prev = addMonths(m, -1); const out = [];
    for (const c of this.allCodes()) {
      const t = this.tipo(c); if (t !== 'activo' && t !== 'pasivo') continue;
      const d = round2(this.balanceAt(c, m) - this.balanceAt(c, prev));
      if (Math.abs(d) > 0.004) out.push({ code: c, nombre: this.nombre(c), kind: kindOf(this.byCode[c] || { codigo: c, tipo: t }), aporta: t === 'pasivo' ? -d : d });
    }
    return out.sort((a, b) => b.aporta - a.aporta);
  }

  accountsOf(tipo) { return this.cuentas.filter((c) => c.tipo === tipo); }
  usedCodes() { return new Set(Object.keys(this.mov)); }
  allCodes() { return [...new Set([...this.cuentas.map((c) => c.codigo), ...this.usedCodes()])]; }

  // ---------- PyG ----------
  pyg(year, { soloCorriente = false } = {}) {
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
    const rowsYear = this.activeRows.filter((r) => r.fecha.startsWith(String(year)));
    const val = {}; // code -> month -> v
    const imprev = Object.fromEntries(months.map((m) => [m, 0]));
    for (const r of rowsYear) {
      const m = ym(r.fecha);
      for (const [code, side] of [[r.debe, 'd'], [r.haber, 'h']]) {
        const t = this.tipo(code);
        if (t !== 'gasto' && t !== 'ingreso') continue;
        if (soloCorriente && (r.clase === 'imprevisto' || r.clase === 'amortizacion')) continue;
        const sign = t === 'gasto' ? (side === 'd' ? 1 : -1) : (side === 'h' ? 1 : -1);
        val[code] ??= Object.fromEntries(months.map((mm) => [mm, 0]));
        val[code][m] += sign * r.importe;
        if (t === 'gasto' && r.clase === 'imprevisto') imprev[m] += sign * r.importe;
      }
    }
    const build = (tipo) => this.allCodes().filter((c) => this.tipo(c) === tipo && val[c])
      .map((c) => ({ code: c, nombre: this.nombre(c), grupo: this.byCode[c]?.grupo || '', values: months.map((m) => round2(val[c][m])), total: round2(months.reduce((s, m) => s + val[c][m], 0)) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    const ingresos = build('ingreso');
    const gastos = build('gasto');
    const sumCols = (list) => months.map((_, i) => round2(list.reduce((s, r) => s + r.values[i], 0)));
    const ti = sumCols(ingresos); const tg = sumCols(gastos);
    const res = ti.map((v, i) => round2(v - tg[i]));
    const tot = (a) => round2(a.reduce((s, v) => s + v, 0));
    return {
      months, ingresos, gastos,
      totalIngresos: ti, totalGastos: tg, resultado: res,
      imprevistos: months.map((m) => round2(imprev[m])),
      totals: { ingresos: tot(ti), gastos: tot(tg), resultado: tot(res), imprevistos: tot(Object.values(imprev)) },
    };
  }

  // resultado (ingresos - gastos) acumulado hasta fin de mes
  resultadoAcumulado(month) {
    let s = 0;
    for (const c of this.allCodes()) {
      const t = this.tipo(c);
      if (t === 'ingreso') s += this.balanceAt(c, month);
      if (t === 'gasto') s -= this.balanceAt(c, month);
    }
    return round2(s);
  }

  // ---------- balance ----------
  balance(month) {
    const codes = this.allCodes();
    const pick = (tipo) => codes.filter((c) => this.tipo(c) === tipo)
      .map((c) => ({ code: c, nombre: this.nombre(c), grupo: this.byCode[c]?.grupo || (tipo === 'activo' ? 'Otros activos' : tipo === 'pasivo' ? 'Deudas' : 'Patrimonio neto'), saldo: this.balanceAt(c, month) }))
      .filter((x) => Math.abs(x.saldo) > 0.004 || this.byCode[x.code]?.activa !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
    const activo = pick('activo'); const pasivo = pick('pasivo'); const pn = pick('patrimonio');
    const resultado = this.resultadoAcumulado(month);
    const sum = (l) => round2(l.reduce((s, x) => s + x.saldo, 0));
    const totalActivo = sum(activo); const totalPasivo = sum(pasivo);
    const totalPN = round2(sum(pn) + resultado);
    return { month, activo, pasivo, pn, resultado, totalActivo, totalPasivo, totalPN, patrimonioNeto: round2(totalActivo - totalPasivo), descuadre: round2(totalActivo - totalPasivo - totalPN) };
  }

  // ---------- gastos para estadística ----------
  gastoMes(month, { incluirImprevistos = false } = {}) {
    const out = {}; let total = 0;
    for (const r of this.activeRows) {
      if (ym(r.fecha) !== month) continue;
      if (r.clase === 'amortizacion') continue;
      if (!incluirImprevistos && r.clase === 'imprevisto') continue;
      if (this.tipo(r.debe) === 'gasto') { out[r.debe] = (out[r.debe] || 0) + r.importe; total += r.importe; }
      if (this.tipo(r.haber) === 'gasto') { out[r.haber] = (out[r.haber] || 0) - r.importe; total -= r.importe; }
    }
    return { porCuenta: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round2(v)])), total: round2(total) };
  }
  ingresoMes(month) {
    let s = 0;
    for (const c of this.allCodes()) if (this.tipo(c) === 'ingreso') s += this.monthNet(c, month);
    return round2(s);
  }

  // ---------- presupuesto por sobres ----------
  presupuesto(month) {
    const rows = (this.db.Presupuesto || []).filter((p) => !truthy(p.borrado) && p.cuenta !== '' && num(p.importe) !== 0);
    const specific = rows.filter((p) => p.mes === month);
    const general = rows.filter((p) => p.mes === '*' && !specific.some((s) => String(s.cuenta) === String(p.cuenta)));
    return [...specific, ...general].map((p) => {
      const code = String(p.cuenta);
      let real = 0;
      for (const r of this.activeRows) {
        if (ym(r.fecha) !== month || r.clase === 'imprevisto' || r.clase === 'amortizacion') continue;
        if (this.tipo(code) === 'gasto') {
          if (r.debe === code) real += r.importe; if (r.haber === code) real -= r.importe;
        } else if (r.haber === code && this.tipo(r.debe) === 'gasto') real += r.importe;
      }
      const asignado = num(p.importe);
      return { ...p, code, nombre: this.nombre(code), asignado, real: round2(real), resto: round2(asignado - real), pct: asignado ? real / asignado : 0, general: p.mes === '*' };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }

  // ---------- automatizaciones ----------
  // movimientos automáticos (recurrentes y préstamos) que aún no has confirmado que pasaron de verdad
  porConfirmar(today = todayISO()) {
    return this.activeRows.filter((r) => /^(rec|pres):/.test(r.origen || '') && !truthy(r.confirmado) && r.fecha <= today).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  // si dos dispositivos generan a la vez el mismo automático, sobran copias: devuelve las que hay que borrar
  duplicadosAuto() {
    const seen = new Map(); const extra = [];
    for (const r of this.activeRows) {
      if (!/^(rec|pres|amort):/.test(r.origen || '')) continue;
      if (seen.has(r.origen)) extra.push(r); else seen.set(r.origen, r);
    }
    return extra;
  }
  pendientes(today = todayISO()) {
    const out = [];
    const origins = new Set(this.rows.map((r) => r.origen).filter(Boolean)); // incluye borrados: si borras uno generado, no vuelve
    const curMonth = ym(today);
    const push = (row) => { if (!origins.has(row.origen)) { out.push(row); origins.add(row.origen); } };

    for (const rc of this.db.Recurrentes || []) {
      if (!truthy(rc.activo) || !rc.desde || !num(rc.importe)) continue;
      const until = rc.hasta && rc.hasta < curMonth ? rc.hasta : curMonth;
      for (const m of monthsBetween(String(rc.desde).slice(0, 7), until)) {
        const fecha = dateInMonth(m, rc.dia);
        if (fecha > today) continue;
        const ov = this.recOverride(rc.id, m); const imp = ov === null ? num(rc.importe) : ov;
        if (!imp) continue; // saltado ese mes
        push({ asiento: uid(), fecha, concepto: rc.nombre, debe: String(rc.debe), haber: String(rc.haber), importe: round2(imp), clase: rc.clase || 'corriente', origen: `rec:${rc.id}:${m}` });
      }
    }

    for (const a of this.db.Activos || []) {
      const vida = num(a.vida_meses);
      if (!truthy(a.activo) || !vida || !a.fecha_alta) continue;
      const cuota = round2((num(a.valor) - num(a.residual)) / vida);
      const start = ym(normDate(a.fecha_alta));
      let acumulado = 0;
      for (let k = 0; k < vida; k++) {
        const m = addMonths(start, k);
        const [y, mm] = m.split('-').map(Number);
        const fecha = `${m}-${pad(lastDay(y, mm))}`;
        const importe = k === vida - 1 ? round2(num(a.valor) - num(a.residual) - acumulado) : cuota;
        acumulado = round2(acumulado + importe);
        if (fecha > today) break;
        push({ asiento: uid(), fecha, concepto: `Amortización ${a.nombre} (${k + 1}/${vida})`, debe: '681', haber: '281', importe, clase: 'amortizacion', origen: `amort:${a.id}:${m}` });
      }
    }

    for (const p of this.db.Prestamos || []) {
      if (!truthy(p.activo)) continue;
      const f = participacion(p); const parte = f < 1 ? ' (tu parte)' : '';
      for (const q of cuadroPrestamo(p)) {
        if (q.fecha > today) break;
        const asiento = uid();
        if (q.intereses > 0) push({ asiento, fecha: q.fecha, concepto: `${p.nombre} · intereses cuota ${q.n}${parte}`, debe: String(p.cuenta_interes || '662'), haber: String(p.cuenta_banco), importe: round2(q.intereses * f), clase: 'corriente', origen: `pres:${p.id}:${q.n}:i` });
        push({ asiento, fecha: q.fecha, concepto: `${p.nombre} · capital cuota ${q.n}${parte}`, debe: String(p.cuenta_pasivo || '170'), haber: String(p.cuenta_banco), importe: round2(q.capital * f), clase: 'traspaso', origen: `pres:${p.id}:${q.n}:c` });
      }
    }
    return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
}

// parte del préstamo que es tuya (hipoteca a medias = 0,5)
export function participacion(p) { const v = num(p.participacion); return v > 0 && v < 100 ? v / 100 : 1; }

export function cuadroPrestamo(p) {
  const C = num(p.capital); const n = Math.round(num(p.plazo_meses)); const r = num(p.interes_anual) / 100 / 12;
  if (!C || !n || !p.primera_cuota) return [];
  const cuota = r ? C * r / (1 - Math.pow(1 + r, -n)) : C / n;
  const start = normDate(p.primera_cuota); const day = Number(start.slice(8, 10));
  let saldo = C; const out = [];
  for (let k = 1; k <= n; k++) {
    const intereses = round2(saldo * r);
    let capital = round2(cuota - intereses);
    if (k === n) capital = round2(saldo);
    saldo = round2(saldo - capital);
    out.push({ n: k, fecha: dateInMonth(addMonths(ym(start), k - 1), day), cuota: round2(intereses + capital), intereses, capital, pendiente: saldo });
  }
  return out;
}

// ---------- vocabulario "humano" sobre el plan de cuentas ----------
const DINERO = ['Tesorería', 'Inversiones', 'Bancos', 'Bancos y efectivo'];
export function kindOf(c) {
  if (!c) return 'contable';
  const t = c.tipo || guessTipo(c.codigo);
  if (t === 'gasto') return 'gasto';
  if (t === 'ingreso') return 'ingreso';
  if (t === 'pasivo') return 'deuda';
  if (t === 'patrimonio') return 'contable';
  if (String(c.codigo).startsWith('281')) return 'contable';
  if (DINERO.includes(c.grupo) || String(c.codigo).startsWith('57') || String(c.codigo).startsWith('54')) return 'dinero';
  return 'bien';
}
export const KIND_LABEL = { dinero: 'Bancos e inversiones', bien: 'Bienes', deuda: 'Deudas', gasto: 'Categorías de gasto', ingreso: 'Tipos de ingreso', contable: 'Cuentas contables' };
export function displayGroup(c) {
  if (!c) return '';
  if (c.grupo === 'Tesorería') return 'Bancos y efectivo';
  if (c.grupo === 'Inmovilizado') return 'Bienes';
  return c.grupo || '';
}
// siguiente código libre dentro de un rango (para crear cuentas sin pensar en códigos)
export function nextCode(cuentas, kind) {
  const used = new Set(cuentas.map((c) => String(c.codigo)));
  const ranges = { dinero: [5701, 5799], bien: [210, 219], deuda: [171, 179], gasto: [606, 699], ingreso: [708, 799], contable: [101, 199] };
  const [a, b] = ranges[kind] || [900, 999];
  for (let n = a; n <= b; n++) if (!used.has(String(n))) return String(n);
  return String(Date.now()).slice(-6);
}

export function guessTipo(code) {
  const c = String(code);
  if (c.startsWith('6')) return 'gasto';
  if (c.startsWith('7')) return 'ingreso';
  if (c.startsWith('1')) return c.startsWith('17') || c.startsWith('16') ? 'pasivo' : 'patrimonio';
  if (c.startsWith('4')) return 'activo';
  if (c.startsWith('52')) return 'pasivo';
  return 'activo';
}

export const fmt = (n, dec = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n) || 0);
export const eur = (n, dec = 2) => `${fmt(n, dec)} €`;
export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesLargo = (ymStr) => { const [y, m] = ymStr.split('-').map(Number); return `${MESES_LARGOS[m - 1]} ${y}`; };
