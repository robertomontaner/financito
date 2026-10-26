// Acceso a datos: Google Sheets (con login de Google) o modo demo en el navegador.
import { TABLES, CUENTAS_INICIALES, RECURRENTES_INICIALES, uid, todayISO } from './model.js';
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
const SHEET_TITLE = 'Financito · libro contable';
const APP_PROP = 'financito';

// ---------- OAuth (flujo de redirección: funciona también como app instalada en iOS) ----------
export const auth = {
  redirectUri() {
    const p = location.pathname.replace(/index\.html$/, '');
    return location.origin + p;
  },
  login(prompt = 'select_account') {
    if (!CONFIG.GOOGLE_CLIENT_ID) throw new Error('Falta configurar el ID de cliente de Google en js/config.js');
    const state = uid();
    LS.set('oauth_state', state);
    const params = new URLSearchParams({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state,
      prompt,
    });
    const hint = LS.get('login_hint'); if (hint) params.set('login_hint', hint);
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  },
  // Lee el token que Google devuelve en el #hash tras el login. Devuelve {ok} | {error} | null
  handleRedirect() {
    const h = location.hash;
    if (!h || !(h.includes('access_token=') || h.includes('error='))) return null;
    const p = new URLSearchParams(h.slice(1));
    history.replaceState(null, '', location.pathname + location.search + '#/inicio');
    if (p.get('state') !== LS.get('oauth_state')) return { error: 'state' };
    LS.del('oauth_state');
    if (p.get('error')) return { error: p.get('error') };
    LS.set('token', p.get('access_token'));
    LS.set('token_exp', String(Date.now() + (Number(p.get('expires_in') || 3600) - 60) * 1000));
    LS.set('was_logged', '1');
    return { ok: true };
  },
  token() {
    const t = LS.get('token'); const exp = Number(LS.get('token_exp') || 0);
    return t && Date.now() < exp ? t : null;
  },
  wasLogged() { return LS.get('was_logged') === '1'; },
  logout() {
    const t = LS.get('token');
    if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${t}`, { method: 'POST' }).catch(() => {});
    ['token', 'token_exp', 'was_logged', 'sheet_id', 'login_hint'].forEach(LS.del);
  },
};

export class AuthError extends Error {}

// ---------- utilidades de tabla ----------
const colLetter = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const toRow = (table, obj) => TABLES[table].map((k) => (obj[k] === undefined || obj[k] === null ? '' : obj[k]));
const fromRows = (table, values) => {
  const [header, ...rows] = values || [];
  const cols = header && header.length ? header : TABLES[table];
  return rows.map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((k, j) => { o[k] = r[j] === undefined ? '' : r[j]; });
    return o;
  }).filter((o) => Object.entries(o).some(([k, v]) => k !== '_row' && v !== ''));
};

function seedData() {
  return {
    Cuentas: CUENTAS_INICIALES,
    Recurrentes: RECURRENTES_INICIALES.map((r) => ({ id: uid(), ...r })),
    Config: [{ clave: 'creado', valor: todayISO() }, { clave: 'version', valor: '1' }],
  };
}

// ---------- Google Sheets ----------
export class SheetsStore {
  constructor() { this.kind = 'google'; this.sheetId = LS.get('sheet_id'); }

  async api(url, opts = {}) {
    const token = auth.token();
    if (!token) throw new AuthError('Sesión caducada');
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 401) { LS.del('token'); throw new AuthError('Sesión caducada'); }
    if (!res.ok) { const t = await res.text(); throw new Error(`Google ${res.status}: ${t.slice(0, 300)}`); }
    return res.status === 204 ? null : res.json();
  }

  sheetUrl() { return this.sheetId ? `https://docs.google.com/spreadsheets/d/${this.sheetId}/edit` : null; }

  async findSheet() {
    if (this.sheetId) return this.sheetId;
    const q = encodeURIComponent(`appProperties has { key='${APP_PROP}' and value='1' } and trashed=false`);
    const r = await this.api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime`);
    const f = r.files?.[0];
    if (f) { this.sheetId = f.id; LS.set('sheet_id', f.id); }
    return this.sheetId || null;
  }

  async createSheet() {
    const sheets = Object.keys(TABLES).map((title, i) => ({ properties: { title, index: i, gridProperties: { frozenRowCount: 1 } } }));
    const created = await this.api('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', body: JSON.stringify({ properties: { title: SHEET_TITLE, locale: 'es_ES', timeZone: 'Europe/Madrid' }, sheets }),
    });
    this.sheetId = created.spreadsheetId; LS.set('sheet_id', this.sheetId);
    await this.api(`https://www.googleapis.com/drive/v3/files/${this.sheetId}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [APP_PROP]: '1' } }) });
    const seed = seedData();
    const data = Object.keys(TABLES).map((t) => ({ range: `${t}!A1`, values: [TABLES[t], ...(seed[t] || []).map((o) => toRow(t, o))] }));
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    // cabeceras en negrita
    const meta = await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}?fields=sheets.properties`);
    const requests = meta.sheets.map((s) => ({ repeatCell: { range: { sheetId: s.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }));
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    return this.sheetId;
  }

  async ensureTabs(existing) {
    const missing = Object.keys(TABLES).filter((t) => !existing.includes(t));
    if (!missing.length) return;
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: missing.map((t) => ({ range: `${t}!A1`, values: [TABLES[t]] })) }),
    });
  }

  async load() {
    const meta = await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}?fields=sheets.properties.title`);
    await this.ensureTabs(meta.sheets.map((s) => s.properties.title));
    const ranges = Object.keys(TABLES).map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
    const r = await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
    const db = {};
    Object.keys(TABLES).forEach((t, i) => { db[t] = fromRows(t, r.valueRanges[i].values); });
    return db;
  }

  async add(table, objs) {
    if (!objs.length) return;
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(table)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: objs.map((o) => toRow(table, o)) }),
    });
  }

  async update(table, objs) {
    const list = Array.isArray(objs) ? objs : [objs];
    const data = list.filter((o) => o._row).map((o) => ({ range: `${table}!A${o._row}:${colLetter(TABLES[table].length - 1)}${o._row}`, values: [toRow(table, o)] }));
    if (!data.length) return;
    await this.api(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
  }
}

// ---------- modo demo (todo en este navegador) ----------
export class LocalStore {
  constructor() { this.kind = 'demo'; }
  sheetUrl() { return null; }
  _read() { try { return JSON.parse(LS.get('demo_db') || 'null'); } catch { return null; } }
  _write(db) { LS.set('demo_db', JSON.stringify(db)); this._mem = db; }
  async findSheet() { return true; }
  async createSheet() { return true; }
  async load() {
    let db = this._read() || this._mem;
    if (!db) { db = Object.fromEntries(Object.keys(TABLES).map((t) => [t, []])); Object.assign(db, structuredClone(seedData())); seedDemo(db); }
    for (const t of Object.keys(TABLES)) db[t] ??= [];
    for (const t of Object.keys(TABLES)) db[t].forEach((o, i) => { o._row = i + 2; });
    this._write(db);
    return structuredClone(db);
  }
  async add(table, objs) { const db = this._read() || this._mem; db[table].push(...objs.map((o) => ({ ...o }))); this._write(db); }
  async update(table, objs) {
    const db = this._read() || this._mem;
    for (const o of Array.isArray(objs) ? objs : [objs]) db[table][o._row - 2] = { ...o };
    this._write(db);
  }
  reset() { LS.del('demo_db'); this._mem = null; }
}

// datos de ejemplo para probar la app sin conectar Google
function seedDemo(db) {
  const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1;
  const iso = (mm, dd) => { const yy = mm < 1 ? y - 1 : y; const m2 = mm < 1 ? mm + 12 : mm; return `${yy}-${String(m2).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; };
  const rows = [];
  const add = (fecha, concepto, debe, haber, importe, clase = 'corriente') => rows.push({ id: uid(), asiento: uid(), fecha, concepto, debe, haber, importe, clase, origen: 'demo', notas: '', creado: todayISO(), borrado: '' });
  add(iso(m - 3, 1), 'Saldo inicial', '5721', '100', 2400, 'apertura');
  add(iso(m - 3, 1), 'Saldo inicial', '5722', '100', 180, 'apertura');
  add(iso(m - 3, 1), 'Saldo inicial', '540', '100', 9000, 'apertura');
  for (let k = -2; k <= 0; k++) {
    const mm = m + k;
    add(iso(mm, 1), 'Nómina', '5721', '700', 1700, 'ingreso');
    add(iso(mm, 2), 'Reparto Revolut Ana', '5722', '5721', 200, 'traspaso');
    add(iso(mm, 2), 'Ahorro Trade Republic', '540', '5721', 900, 'traspaso');
    add(iso(mm, 3), 'Mamá', '620', '5721', 250);
    add(iso(mm, 5), 'Lidl', '600', '5722', 62.4 + k * 5);
    add(iso(mm, 9), 'Gasolina', '601', '5721', 48 - k * 3);
    add(iso(mm, 12), 'Cena con amigos', '603', '5721', 34 + k * 4);
    add(iso(mm, 18), 'Mercadona', '600', '5722', 41.2);
    if (k === -1) add(iso(mm, 20), 'Ruedas coche', '601', '5721', 80, 'imprevisto');
  }
  db.Diario = rows;
  db.Presupuesto = [
    { id: uid(), mes: '*', cuenta: '600', importe: 150, borrado: '' },
    { id: uid(), mes: '*', cuenta: '603', importe: 80, borrado: '' },
    { id: uid(), mes: '*', cuenta: '5722', importe: 200, borrado: '' },
  ];
}
