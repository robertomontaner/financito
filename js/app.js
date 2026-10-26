import { CONFIG } from './config.js';
import { auth, AuthError, SheetsStore, LocalStore } from './store.js';
import {
  Libro, TABLES, CLASES, uid, round2, num, truthy, todayISO, ym, addMonths, eur, fmt, MESES, mesLargo, normDate, cuadroPrestamo, pad, kindOf, KIND_LABEL, displayGroup, nextCode,
} from './model.js';

// ---------------- estado y utilidades de UI ----------------
const S = { store: null, libro: null, loading: false, mes: ym(todayISO()), year: Number(todayISO().slice(0, 4)), informe: 'pyg', periodo: 'mes', apuntar: 'gasto', diario: { q: '', mes: '', cuenta: '', n: 80 } };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
const view = () => $('#view');

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function fail(e) {
  console.error(e);
  if (e instanceof AuthError) { renderReconnect(); return; }
  toast(`Error: ${e.message || e}`, 5000);
}
const cls = (n) => (n < -0.004 ? 'neg' : n > 0.004 ? 'pos' : '');
const amountCls = (r, L) => {
  const td = L.tipo(r.debe); const th = L.tipo(r.haber);
  if (td === 'gasto') return 'neg';
  if (th === 'ingreso') return 'pos';
  return '';
};
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

// opciones de cuentas para <select>, agrupadas
function accountOptions(filter = () => true, selected = '') {
  const L = S.libro; const groups = {};
  for (const c of L.cuentas) {
    if (!filter(c) || (c.activa === 0 || c.activa === '0') && c.codigo !== String(selected)) continue;
    (groups[displayGroup(c) || 'Otras'] ??= []).push(c);
  }
  return Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((c) => `<option value="${esc(c.codigo)}" ${String(selected) === c.codigo ? 'selected' : ''}>${esc(c.nombre)}${S.verCodigos ? ` · ${esc(c.codigo)}` : ''}</option>`).join('')}</optgroup>`).join('');
}
const isTes = (c) => c.grupo === 'Tesorería';
const isMoney = (c) => kindOf(c) === 'dinero';
const isPayer = (c) => isMoney(c) || kindOf(c) === 'deuda';
// cuentas que usa Financito internamente (amortización, intereses, descuadres, revalorizaciones): fuera de las listas normales
const SYS = new Set(['659', '662', '663', '681', '759', '763']);
const isGasto = (c) => c.tipo === 'gasto' && !SYS.has(c.codigo);
const isIngreso = (c) => c.tipo === 'ingreso' && !SYS.has(c.codigo);

// ---------------- datos ----------------
async function reload({ automations = false } = {}) {
  const db = await S.store.load();
  if (S.libro) S.libro.set(db); else S.libro = new Libro(db);
  if (automations) {
    const pend = S.libro.pendientes();
    if (pend.length) {
      const rows = pend.map((r) => ({ id: uid(), notas: '', creado: todayISO(), borrado: '', ...r }));
      await S.store.add('Diario', rows);
      S.libro.set(await S.store.load());
      S.autoMsg = `${rows.length} asiento${rows.length > 1 ? 's' : ''} automático${rows.length > 1 ? 's' : ''} generado${rows.length > 1 ? 's' : ''} (recurrentes, amortizaciones o préstamos).`;
    }
    await migrar();
  }
}

async function setConfig(clave, valor) {
  const row = (S.libro.db.Config || []).find((c) => c.clave === clave);
  if (row) await S.store.update('Config', [{ ...row, valor }]); else await S.store.add('Config', [{ clave, valor }]);
}

// Arreglos de datos entre versiones (se ejecutan una sola vez)
async function migrar() {
  const L = S.libro;
  // v2: los gastos importados de Notion pasan a su banco real (antes iban contra la cuenta puente 119)
  const byName = Object.fromEntries(L.cuentas.map((c) => [c.nombre.toLowerCase(), c.codigo]));
  const fixes = [];
  for (const r of L.rows) {
    if (r.haber !== '119') continue;
    const m = String(r.notas || '').match(/^Pagado con (.+?)(?: · (.*))?$/);
    const code = m && byName[m[1].trim().toLowerCase()];
    if (code) fixes.push({ ...r, haber: code, notas: m[2] || '' });
  }
  const c119 = L.byCode['119'];
  const rename = c119 && c119.nombre === 'Contrapartida histórico';
  if (!fixes.length && !rename && num(L.config.version || 1) >= 2) return;
  for (let i = 0; i < fixes.length; i += 200) await S.store.update('Diario', fixes.slice(i, i + 200));
  if (rename) await S.store.update('Cuentas', [{ ...c119, nombre: 'Histórico sin cuenta' }]);
  if (num(L.config.version || 1) < 2) await setConfig('version', '2');
  S.libro.set(await S.store.load());
  if (fixes.length) S.autoMsg = `He reorganizado ${fixes.length} movimientos importados para que salgan con su banco real (Revolut Ana → Súper…).`;
}
async function addRows(table, rows) { await S.store.add(table, rows); await reload(); }
async function updateRows(table, rows) { await S.store.update(table, rows); await reload(); }

function newEntry(fields) {
  return { id: uid(), asiento: fields.asiento || uid(), origen: 'manual', notas: '', creado: todayISO(), borrado: '', ...fields, importe: round2(num(fields.importe)) };
}

// ---------------- modal genérico ----------------
function openModal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const back = $('.modal-back', root);
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  document.addEventListener('keydown', escClose);
  onMount?.($('.modal', root));
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }

// fields: {key,label,type,options,hint,step,required}
function fieldHtml(f, v) {
  const id = `f_${f.key}`; const val = v ?? '';
  if (f.type === 'checkbox') return `<div class="field"><label class="check"><input type="checkbox" id="${id}" name="${f.key}" ${truthy(val) ? 'checked' : ''}> <span>${esc(f.label)}</span></label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
  let input;
  if (f.type === 'select') {
    const opts = typeof f.options === 'function' ? f.options(val) : f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(val) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    input = `<select id="${id}" name="${f.key}" ${f.required ? 'required' : ''}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts}</select>`;
  } else if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}">${esc(val)}</textarea>`;
  else if (f.type === 'number') input = `<input type="text" inputmode="decimal" id="${id}" name="${f.key}" value="${esc(val === '' ? '' : String(val).replace('.', ','))}" ${f.required ? 'required' : ''} autocomplete="off">`;
  else input = `<input type="${f.type || 'text'}" id="${id}" name="${f.key}" value="${esc(val)}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">`;
  return `<div class="field"><label class="lbl" for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}
function readForm(form, fields) {
  const o = {};
  for (const f of fields) {
    const el = form.elements[f.key]; if (!el) continue;
    o[f.key] = f.type === 'checkbox' ? (el.checked ? 1 : 0) : f.type === 'number' ? (el.value.trim() === '' ? '' : num(el.value)) : el.value.trim();
  }
  return o;
}
function formModal({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Guardar', extra = '' }) {
  openModal(`<h2>${esc(title)}</h2><form novalidate>${fields.map((f) => fieldHtml(f, values[f.key])).join('')}${extra}
    <div class="actions">${onDelete ? '<button type="button" class="btn danger" data-del>Borrar</button>' : ''}<button type="button" class="btn" data-cancel>Cancelar</button><button class="btn primary" type="submit">${esc(saveLabel)}</button></div></form>`, (m) => {
    const form = $('form', m);
    $('[data-cancel]', m).onclick = closeModal;
    if (onDelete) $('[data-del]', m).onclick = async () => { if (!confirm('¿Seguro?')) return; try { await onDelete(); closeModal(); render(); } catch (e) { fail(e); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = readForm(form, fields);
      const miss = fields.find((f) => f.required && (data[f.key] === '' || data[f.key] === undefined));
      if (miss) { toast(`Falta: ${miss.label}`); return; }
      const btn = $('button[type=submit]', form); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try { await onSave(data); closeModal(); render(); } catch (err) { btn.disabled = false; btn.textContent = saveLabel; fail(err); }
    };
  });
}

// ---------------- arranque ----------------
async function boot() {
  const red = auth.handleRedirect();
  if (red?.error && red.error !== 'state') LS.set('silent_fail', String(Date.now()));
  const mode = LS.get('mode');
  if (mode === 'demo') { S.store = new LocalStore(); return start(); }
  if (mode === 'google' || red?.ok) {
    LS.set('mode', 'google');
    if (!auth.token()) {
      const recentFail = Date.now() - Number(LS.get('silent_fail') || 0) < 60000;
      if (auth.wasLogged() && CONFIG.GOOGLE_CLIENT_ID && !recentFail) { auth.login('none'); return; }
      return renderLogin();
    }
    S.store = new SheetsStore();
    try {
      const id = await S.store.findSheet();
      if (!id) return renderCreate();
      return start();
    } catch (e) { return fail(e); }
  }
  renderLogin();
}

async function start() {
  try {
    view().innerHTML = '<div class="center muted pad"><span class="spin"></span> Cargando tu libro…</div>';
    await reload({ automations: true });
    $('#nav').hidden = false;
    window.addEventListener('hashchange', render);
    if (!location.hash || location.hash === '#') location.hash = '#/inicio'; else render();
  } catch (e) { fail(e); }
}

function renderLogin() {
  $('#nav').hidden = true;
  const noClient = !CONFIG.GOOGLE_CLIENT_ID;
  view().innerHTML = `<div class="login">
    <div class="logo-big">◧</div>
    <h1>Financito</h1>
    <p>Contabilidad personal de doble partida. Tus datos viven en una hoja de Google Sheets privada en tu Drive.</p>
    ${noClient ? `<div class="banner warn">Falta configurar el <strong>ID de cliente de Google</strong> en <code>js/config.js</code>. Mientras tanto puedes probar el modo demo.</div>` : ''}
    <div class="stack" style="margin-top:18px">
      <button class="btn primary block" id="login" ${noClient ? 'disabled' : ''}>Entrar con Google</button>
      <button class="btn block" id="demo">Probar con datos de ejemplo</button>
    </div>
    <p class="small" style="margin-top:22px">Solo pide permiso para los archivos que crea esta app (<code>drive.file</code>): no puede ver el resto de tu Drive.</p>
  </div>`;
  $('#login').onclick = () => { LS.set('mode', 'google'); LS.set('silent_fail', '0'); auth.login('select_account'); };
  $('#demo').onclick = () => { LS.set('mode', 'demo'); S.store = new LocalStore(); start(); };
}

function renderCreate() {
  $('#nav').hidden = true;
  view().innerHTML = `<div class="login">
    <div class="logo-big">◧</div>
    <h1>Crear tu libro</h1>
    <p>Voy a crear en tu Google Drive una hoja llamada <strong>«Financito · libro contable»</strong> con el plan de cuentas, el diario y el resto de pestañas.</p>
    <button class="btn primary block" id="create">Crear hoja</button>
    <button class="btn block" id="out" style="margin-top:10px">Usar otra cuenta</button>
  </div>`;
  $('#create').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Creando…';
    try { await S.store.createSheet(); start(); } catch (err) { e.target.disabled = false; e.target.textContent = 'Crear hoja'; fail(err); }
  };
  $('#out').onclick = () => { auth.logout(); renderLogin(); };
}

function renderReconnect() {
  openModal(`<h2>Sesión caducada</h2><p class="muted">Google cierra la sesión cada hora por seguridad. Vuelve a entrar para seguir; no perderás nada guardado.</p>
    <div class="actions"><button class="btn primary" id="re">Volver a entrar</button></div>`, (m) => {
    $('#re', m).onclick = () => auth.login('none');
  });
}

// ---------------- router ----------------
const ROUTES = { inicio: viewInicio, apuntar: viewApuntar, diario: viewDiario, informes: viewInformes, ajustes: viewAjustes };
function render() {
  if (!S.libro) return;
  const r = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'inicio';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r));
  $('#title').textContent = { inicio: 'Financito', apuntar: 'Apuntar', diario: 'Diario', informes: 'Informes', ajustes: 'Ajustes' }[r] || 'Financito';
  $('#topbar-actions').innerHTML = S.store.kind === 'demo' ? '<span class="chip">modo demo</span>' : '';
  (ROUTES[r] || viewInicio)();
  view().focus({ preventScroll: true });
}

// ---------------- INICIO ----------------
function viewInicio() {
  const L = S.libro; const mes = ym(todayISO()); const prev = addMonths(mes, -1);
  const g = L.gastoMes(mes); const gp = L.gastoMes(prev);
  const ingresos = L.ingresoMes(mes);
  const bal = L.balance(mes);
  const tes = L.inicio ? L.cuentas.filter((c) => (isMoney(c) || kindOf(c) === 'deuda') && Math.abs(L.balanceToDate(c.codigo)) > 0.004) : [];
  const sob = L.presupuesto(mes);
  const last = [...L.activeRows].sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado)).slice(0, 6);
  const diff = g.total - gp.total;
  const top = Object.entries(g.porCuenta).sort((a, b) => b[1] - a[1]).slice(0, 6);

  view().innerHTML = `
    ${S.autoMsg ? `<div class="banner">⚙ ${esc(S.autoMsg)}</div>` : ''}
    ${S.store.kind === 'demo' ? '<div class="banner warn">Estás en modo demo: los datos son de ejemplo y solo se guardan en este navegador.</div>' : ''}
    <h1 style="text-transform:capitalize">${esc(mesLargo(mes))}</h1>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Gasto corriente del mes</div><div class="val">${eur(g.total)}</div><div class="sub">${gp.total ? `${diff >= 0 ? '+' : ''}${eur(diff, 0)} vs ${MESES[Number(prev.slice(5)) - 1].toLowerCase()} (${eur(gp.total, 0)})` : 'sin imprevistos ni amortizaciones'}</div></div>
      <div class="kpi"><div class="lbl">Ingresos del mes</div><div class="val">${eur(ingresos, 0)}</div><div class="sub">Resultado: <span class="${cls(ingresos - g.total)}">${eur(round2(L.pyg(mes.slice(0, 4)).resultado[Number(mes.slice(5)) - 1]), 0)}</span></div></div>
      <div class="kpi"><div class="lbl">Patrimonio neto</div><div class="val">${L.inicio ? eur(bal.patrimonioNeto, 0) : '—'}</div><div class="sub">${L.inicio ? 'lo que tienes − lo que debes' : 'falta meter saldos iniciales'}</div></div>
    </div>

    ${sob.length ? `<h2>Presupuesto de ${esc(MESES[Number(mes.slice(5)) - 1].toLowerCase())}</h2><div class="card">${sobresHtml(sob.slice(0, 6))}<div style="margin-top:8px"><a href="#/informes" data-inf="sobres" class="small">Ver presupuesto completo →</a></div></div>` : ''}

    ${top.length ? `<h2>En qué se va este mes</h2><div class="card"><ul class="list">${top.map(([c, v]) => `<li><div class="grow"><div class="t">${esc(L.nombre(c))}</div><div class="bar"><span style="width:${Math.min(100, (v / (top[0][1] || 1)) * 100)}%"></span></div></div><div class="amount">${eur(v)}</div></li>`).join('')}</ul></div>` : ''}

    <h2>Tus cuentas</h2>
    ${L.inicio ? `<div class="card"><ul class="list">${tes.map((c) => { const s = L.balanceToDate(c.codigo); return `<li class="tap" data-cta="${esc(c.codigo)}"><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">${esc(displayGroup(c))}</div></div><div class="amount ${s < 0 ? 'neg' : ''}">${eur(s)}</div></li>`; }).join('') || '<li class="muted">Sin saldo en ninguna cuenta</li>'}</ul></div>`
    : '<div class="card"><p style="margin:0 0 10px">Para ver cuánto tienes en cada banco, mete los saldos que tienes hoy (o el día que empieces a usar Financito).</p><button class="btn primary block" id="goap">Introducir saldos iniciales</button></div>'}

    <h2>Últimos movimientos</h2>
    <div class="card">${last.length ? `<ul class="list">${last.map((r) => rowItem(r)).join('')}</ul>` : '<div class="empty">Aún no hay movimientos. Pulsa <strong>+</strong> para apuntar el primero.</div>'}</div>
  `;
  $$('[data-inf]').forEach((a) => a.addEventListener('click', () => { S.informe = a.dataset.inf; }));
  $$('[data-cta]').forEach((li) => { li.onclick = () => { S.diario = { ...S.diario, cuenta: li.dataset.cta, mes: '', q: '' }; location.hash = '#/diario'; }; });
  $('#goap')?.addEventListener('click', apertura);
  bindRowItems();
  S.autoMsg = '';
}

function sobresHtml(list) {
  return `<ul class="list">${list.map((p) => {
    const pct = Math.max(0, p.pct); const state = pct > 1 ? 'over' : pct > 0.85 ? 'near' : '';
    return `<li class="tap" data-sobre="${esc(p.id)}"><div class="grow"><div class="row between"><span class="t">${esc(p.nombre)}${p.general ? '' : ' <span class="chip">solo este mes</span>'}</span><span class="small ${p.resto < 0 ? 'neg' : 'muted'}">${p.resto < 0 ? `te pasas ${eur(-p.resto)}` : `quedan ${eur(p.resto)}`}</span></div>
      <div class="bar ${state}"><span style="width:${Math.min(100, pct * 100)}%"></span></div><div class="s">${eur(p.real)} de ${eur(p.asignado)}</div></div></li>`;
  }).join('')}</ul>`;
}

function rowItem(r) {
  const L = S.libro;
  const chip = ['imprevisto', 'patrimonial', 'amortizacion', 'apertura', 'ajuste', 'traspaso', 'historico'].includes(r.clase) ? `<span class="chip ${esc(r.clase)}">${esc(CLASES[r.clase] || r.clase)}</span>` : '';
  return `<li class="tap" data-id="${esc(r.id)}"><div class="grow"><div class="t">${esc(r.concepto || '(sin concepto)')}</div>
    <div class="s">${esc(L.nombre(r.haber))} → ${esc(L.nombre(r.debe))} · ${esc(r.fecha.slice(8, 10))}/${esc(r.fecha.slice(5, 7))} ${chip}</div></div>
    <div class="amount ${amountCls(r, L)}">${eur(r.importe)}</div></li>`;
}
function bindRowItems(root = view()) {
  $$('li[data-id]', root).forEach((li) => { li.onclick = () => editEntry(li.dataset.id); });
  $$('li[data-sobre]', root).forEach((li) => { li.onclick = () => editSobre(li.dataset.sobre); });
}

// ---------------- APUNTAR ----------------
const PLANTILLAS = [
  ['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['traspaso', 'Traspaso'], ['activo', 'Compra de activo'], ['libre', 'Asiento libre'],
];
function viewApuntar() {
  const t = S.apuntar; const L = S.libro; S.verCodigos = t === 'libre';
  const last = (k, def) => LS.get(`last_${t}_${k}`) || def;
  // cuenta de pago más usada en los últimos movimientos (si no, Mediolanum o la primera de tesorería)
  const freq = {}; L.activeRows.slice(-200).forEach((r) => { if (L.byCode[r.haber] && isTes(L.byCode[r.haber])) freq[r.haber] = (freq[r.haber] || 0) + 1; });
  const firstTes = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || (L.byCode['5721'] ? '5721' : L.cuentas.find(isTes)?.codigo || '');
  const flows = {
    gasto: 'Pagas algo desde uno de tus bancos.',
    ingreso: 'Te entra dinero en uno de tus bancos (nómina, venta…).',
    traspaso: 'Mueves dinero entre tus cuentas (reparto, ahorro a Trade Republic…). No es gasto ni ingreso.',
    activo: 'Compras algo que conserva valor (piso, coche, patinete…). No cuenta como gasto; si lo amortizas, se reparte en meses.',
    libre: 'Modo contable: eliges tú la cuenta de debe y la de haber.',
  };
  let body = '';
  const fecha = `<div class="field"><label class="lbl" for="f_fecha">Fecha</label><input type="date" id="f_fecha" name="fecha" value="${todayISO()}" required></div>`;
  const importe = `<div class="field"><input class="bigamount" type="text" inputmode="decimal" name="importe" placeholder="0,00 €" autocomplete="off" required aria-label="Importe"></div>`;
  const concepto = (ph) => `<div class="field"><label class="lbl" for="f_concepto">Concepto</label><input type="text" id="f_concepto" name="concepto" placeholder="${esc(ph)}" autocomplete="off"></div>`;
  const sel = (name, label, filter, def) => `<div class="field"><label class="lbl" for="f_${name}">${esc(label)}</label><select id="f_${name}" name="${name}" required>${accountOptions(filter, def)}</select></div>`;
  const notas = '<details style="margin-bottom:12px"><summary class="small muted">Notas</summary><textarea name="notas" style="margin-top:8px"></textarea></details>';

  if (t === 'gasto') {
    const gastosCorr = L.cuentas.filter((c) => c.grupo === 'Gastos variables' && c.activa !== 0);
    if (!gastosCorr.length) gastosCorr.push(...L.cuentas.filter((c) => c.tipo === 'gasto' && c.activa !== 0).slice(0, 6));
    const defCat = last('debe', gastosCorr[0]?.codigo || '');
    body = `${importe}${concepto('Lidl, gasolina, cena…')}
      <div class="quick" id="quick" style="margin-top:0">${gastosCorr.map((c) => `<button type="button" data-v="${esc(c.codigo)}" class="${c.codigo === defCat ? 'on' : ''}">${esc(c.nombre)}</button>`).join('')}</div>
      ${sel('debe', 'Categoría', isGasto, defCat)}
      ${sel('haber', 'Pagado con', isMoney, last('haber', firstTes))}
      <div class="two">${fecha}<div class="field"><label class="lbl">&nbsp;</label><label class="check"><input type="checkbox" name="imprevisto"> Imprevisto</label></div></div>${notas}`;
  } else if (t === 'ingreso') {
    body = `${importe}${concepto('Nómina, comisión, venta…')}
      ${sel('haber', 'Tipo de ingreso', isIngreso, last('haber', L.accountsOf('ingreso')[0]?.codigo))}
      ${sel('debe', 'Cobrado en', isMoney, last('debe', firstTes))}${fecha}${notas}`;
  } else if (t === 'traspaso') {
    const pay = isPayer;
    body = `${importe}${concepto('Reparto, ahorro, aportación…')}
      ${sel('haber', 'Desde', pay, last('haber', firstTes))}
      ${sel('debe', 'Hacia', pay, last('debe', L.cuentas.find((c) => c.codigo === '540')?.codigo || firstTes))}${fecha}${notas}`;
  } else if (t === 'activo') {
    const act = (c) => kindOf(c) === 'bien';
    body = `${importe}${concepto('Patinete, impresora, entrada piso…')}
      ${sel('debe', 'Tipo de bien', act, last('debe', '218'))}
      ${sel('haber', 'Pagado con', isMoney, last('haber', firstTes))}${fecha}
      <div class="field"><label class="check"><input type="checkbox" name="amortizar" id="f_amortizar"> Amortizar (repartir el gasto en el tiempo)</label></div>
      <div id="amortbox" hidden class="two"><div class="field"><label class="lbl">Vida útil (años)</label><input type="text" inputmode="decimal" name="vida" value="3"></div><div class="field"><label class="lbl">Valor residual €</label><input type="text" inputmode="decimal" name="residual" value="0"></div></div>${notas}`;
  } else {
    body = `${importe}${concepto('Concepto')}
      ${sel('debe', 'Debe (recibe)', () => true, last('debe', ''))}
      ${sel('haber', 'Haber (entrega)', () => true, last('haber', ''))}
      <div class="two">${fecha}<div class="field"><label class="lbl" for="f_clase">Clase</label><select id="f_clase" name="clase">${Object.entries(CLASES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div></div>${notas}`;
  }

  view().innerHTML = `<div class="seg" role="tablist">${PLANTILLAS.map(([k, l]) => `<button role="tab" data-t="${k}" class="${k === t ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <div class="flow" style="margin-top:12px">ℹ ${esc(flows[t])}</div>
    <form id="apunte" novalidate>${body}<button class="btn primary block" type="submit">Guardar</button></form>`;

  $$('.seg button').forEach((b) => { b.onclick = () => { S.apuntar = b.dataset.t; viewApuntar(); }; });
  const form = $('#apunte');
  $$('#quick button').forEach((b) => { b.onclick = () => { $$('#quick button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); form.elements.debe.value = b.dataset.v; }; });
  if (form.elements.debe && $('#quick')) form.elements.debe.onchange = () => $$('#quick button').forEach((x) => x.classList.toggle('on', x.dataset.v === form.elements.debe.value));
  const am = $('#f_amortizar'); if (am) am.onchange = () => { $('#amortbox').hidden = !am.checked; };
  setTimeout(() => form.elements.importe?.focus(), 50);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements; const importeV = round2(num(f.importe.value));
    if (!importeV) { toast('Pon un importe'); f.importe.focus(); return; }
    if (f.debe.value === f.haber.value) { toast('Las dos cuentas no pueden ser la misma'); return; }
    const clase = t === 'gasto' ? (f.imprevisto.checked ? 'imprevisto' : 'corriente') : t === 'ingreso' ? 'ingreso' : t === 'traspaso' ? 'traspaso' : t === 'activo' ? 'patrimonial' : f.clase.value;
    const row = newEntry({ fecha: f.fecha.value || todayISO(), concepto: f.concepto.value.trim(), debe: f.debe.value, haber: f.haber.value, importe: importeV, clase, notas: f.notas?.value.trim() || '' });
    const btn = $('button[type=submit]', form); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try {
      await S.store.add('Diario', [row]);
      if (t === 'activo' && f.amortizar.checked) {
        const vida = Math.round(num(f.vida.value) * 12);
        if (vida > 0) await S.store.add('Activos', [{ id: uid(), nombre: row.concepto || L.nombre(row.debe), cuenta: row.debe, fecha_alta: row.fecha, valor: importeV, vida_meses: vida, residual: num(f.residual.value), activo: 1 }]);
      }
      LS.set(`last_${t}_debe`, row.debe); LS.set(`last_${t}_haber`, row.haber);
      await reload({ automations: t === 'activo' });
      toast(`Apuntado: ${row.concepto || L.nombre(row.debe)} · ${eur(importeV)}`);
      viewApuntar();
    } catch (err) { btn.disabled = false; btn.textContent = 'Guardar'; fail(err); }
  };
}

// editar asiento existente
function editEntry(id) {
  const L = S.libro; const r = L.rows.find((x) => String(x.id) === String(id)); if (!r) return;
  const all = () => true;
  const fields = [
    { key: 'fecha', label: 'Fecha', type: 'date', required: true },
    { key: 'concepto', label: 'Concepto' },
    { key: 'importe', label: 'Importe €', type: 'number', required: true },
    { key: 'debe', label: 'Va a (debe)', type: 'select', options: (v) => accountOptions(all, v), required: true },
    { key: 'haber', label: 'Sale de (haber)', type: 'select', options: (v) => accountOptions(all, v), required: true },
    { key: 'clase', label: 'Clase', type: 'select', options: Object.entries(CLASES) },
    { key: 'notas', label: 'Notas', type: 'textarea' },
  ];
  const auto = r.origen && r.origen !== 'manual' && r.origen !== 'importado' && r.origen !== 'demo' ? `<div class="hint" style="margin-bottom:10px">Generado automáticamente (${esc(r.origen.split(':')[0])}). Si lo borras no se vuelve a generar.</div>` : '';
  formModal({
    title: 'Editar movimiento', fields, values: r, extra: auto,
    onSave: async (d) => updateRows('Diario', [{ ...r, ...d, importe: round2(d.importe) }]),
    onDelete: async () => updateRows('Diario', [{ ...r, borrado: 1 }]),
  });
}

// ---------------- DIARIO ----------------
function viewDiario() {
  const L = S.libro; const st = S.diario;
  const months = [...new Set(L.activeRows.map((r) => ym(r.fecha)))].sort().reverse();
  let rows = [...L.activeRows];
  if (st.mes) rows = rows.filter((r) => ym(r.fecha) === st.mes);
  if (st.cuenta) rows = rows.filter((r) => r.debe === st.cuenta || r.haber === st.cuenta);
  if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((r) => `${r.concepto} ${r.notas} ${L.nombre(r.debe)} ${L.nombre(r.haber)} ${fmt(r.importe)}`.toLowerCase().includes(q)); }
  rows.sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
  const shown = rows.slice(0, st.n);
  let lastDay = ''; let html = '';
  for (const r of shown) { if (r.fecha !== lastDay) { if (lastDay) html += '</ul>'; html += `<div class="daysep">${esc(dayLabel(r.fecha))}</div><ul class="list">`; lastDay = r.fecha; } html += rowItem(r); }
  if (lastDay) html += '</ul>';
  const tot = rows.reduce((s, r) => s + (L.tipo(r.debe) === 'gasto' ? r.importe : 0), 0);
  const saldoCuenta = st.cuenta ? L.balanceToDate(st.cuenta) : null;

  view().innerHTML = `
    <div class="field"><input type="search" id="q" placeholder="Buscar concepto, cuenta, importe…" value="${esc(st.q)}"></div>
    <div class="two">
      <select id="fm"><option value="">Todos los meses</option>${months.map((m) => `<option value="${m}" ${st.mes === m ? 'selected' : ''}>${esc(mesLargo(m))}</option>`).join('')}</select>
      <select id="fc"><option value="">Todas las cuentas</option>${accountOptions(() => true, st.cuenta)}</select>
    </div>
    <div class="row between small muted" style="margin:10px 2px 0"><span>${rows.length} movimientos</span><span>${tot ? `Gastos: ${eur(tot)}` : ''}${saldoCuenta !== null ? ` · Saldo cuenta: ${eur(saldoCuenta)}` : ''}</span></div>
    <div class="card" style="margin-top:8px">${html || '<div class="empty">Nada por aquí.</div>'}
    ${rows.length > shown.length ? '<button class="btn block" id="more" style="margin-top:10px">Ver más</button>' : ''}</div>`;
  const q = $('#q'); q.oninput = () => { st.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { viewDiario(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $('#fm').onchange = (e) => { st.mes = e.target.value; st.n = 80; viewDiario(); };
  $('#fc').onchange = (e) => { st.cuenta = e.target.value; st.n = 80; viewDiario(); };
  $('#more')?.addEventListener('click', () => { st.n += 120; viewDiario(); });
  bindRowItems();
}

// ---------------- INFORMES ----------------
const INFORMES = [['pyg', 'Ingresos y gastos'], ['balance', 'Patrimonio'], ['graficos', 'Gráficos'], ['sobres', 'Presupuesto'], ['cuadre', 'Comprobar bancos']];
function viewInformes() {
  view().innerHTML = `<div class="seg">${INFORMES.map(([k, l]) => `<button data-i="${k}" class="${S.informe === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="inf" style="margin-top:14px"></div>`;
  $$('.seg button[data-i]').forEach((b) => { b.onclick = () => { S.informe = b.dataset.i; viewInformes(); }; });
  ({ pyg: infPyG, balance: infBalance, graficos: infGraficos, sobres: infSobres, cuadre: infCuadre })[S.informe]();
}

// selector de periodo común: Mes / Año
function periodBar(onChange, { allowYear = true } = {}) {
  if (!allowYear) S.periodo = 'mes';
  const isMes = S.periodo !== 'año';
  const label = isMes ? mesLargo(S.mes) : String(S.year);
  setTimeout(() => {
    $$('[data-per]').forEach((b) => { b.onclick = () => { S.periodo = b.dataset.per; if (S.periodo === 'año') S.year = Number(S.mes.slice(0, 4)); onChange(); }; });
    $$('[data-step]').forEach((b) => { b.onclick = () => { const k = Number(b.dataset.step); if (S.periodo === 'año') { S.year += k; S.mes = `${S.year}-${S.mes.slice(5)}`; } else { S.mes = addMonths(S.mes, k); S.year = Number(S.mes.slice(0, 4)); } onChange(); }; });
    $('[data-hoy]')?.addEventListener('click', () => { S.mes = ym(todayISO()); S.year = Number(S.mes.slice(0, 4)); onChange(); });
  }, 0);
  const hoy = S.periodo === 'año' ? S.year !== Number(todayISO().slice(0, 4)) : S.mes !== ym(todayISO());
  return `<div class="periodbar">
    ${allowYear ? `<div class="seg mini"><button data-per="mes" class="${isMes ? 'on' : ''}">Mes</button><button data-per="año" class="${!isMes ? 'on' : ''}">Año</button></div>` : ''}
    <div class="monthnav grow"><button class="iconbtn" data-step="-1" aria-label="Anterior">‹</button><strong>${esc(label)}</strong><button class="iconbtn" data-step="1" aria-label="Siguiente">›</button></div>
    ${hoy ? '<button class="btn sm" data-hoy>Hoy</button>' : ''}
  </div>`;
}
const cell = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : ''}">${Math.abs(v) < 0.005 ? '–' : fmt(v, 0)}</td>`;
const cellNeg = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : cls(v)}">${Math.abs(v) < 0.005 ? '–' : fmt(v, 0)}</td>`;
const cellDiff = (v, gasto = true) => `<td class="n ${Math.abs(v) < 0.5 ? 'z' : (gasto ? (v > 0 ? 'neg' : 'pos') : (v > 0 ? 'pos' : 'neg'))}">${Math.abs(v) < 0.5 ? '–' : `${v > 0 ? '+' : ''}${fmt(v, 0)}`}</td>`;
const goAccount = (root) => $$('tr[data-acc]', root).forEach((tr) => { tr.onclick = () => { S.diario = { ...S.diario, cuenta: tr.dataset.acc, mes: S.periodo === 'año' ? '' : S.mes, q: '' }; location.hash = '#/diario'; }; });

function infPyG() {
  const L = S.libro; const isMes = S.periodo !== 'año';
  let cols; let diffAt = -1;
  if (isMes) {
    const m = S.mes; const p = addMonths(m, -1);
    cols = [{ label: MESES[Number(m.slice(5)) - 1], from: m, to: m }, { label: MESES[Number(p.slice(5)) - 1], from: p, to: p }, { label: 'En el año', from: `${m.slice(0, 4)}-01`, to: m }];
    diffAt = 1;
  } else {
    const cur = ym(todayISO());
    const months = Array.from({ length: 12 }, (_, i) => `${S.year}-${pad(i + 1)}`);
    const probe = L.pygCols(months.map((mm) => ({ from: mm, to: mm })));
    const has = (i) => probe.totalGastos[i] || probe.totalIngresos[i];
    const first = months.findIndex((_, i) => has(i));
    const keep = months.filter((mm, i) => (first < 0 || i >= first) && (mm <= cur || has(i)));
    cols = [...keep.map((mm) => ({ label: MESES[Number(mm.slice(5)) - 1], from: mm, to: mm })), { label: 'Total', from: `${S.year}-01`, to: `${S.year}-12`, total: true }];
  }
  const p = L.pygCols(cols);
  const n = cols.length + (diffAt >= 0 ? 1 : 0);
  const head = `<tr><th></th>${cols.map((c, i) => `<th>${esc(c.label)}</th>${i === diffAt ? '<th>Dif.</th>' : ''}`).join('')}</tr>`;
  const cellsOf = (values, render = cell, gasto = true) => values.map((v, i) => `${render(v)}${i === diffAt ? cellDiff(values[0] - values[1], gasto) : ''}`).join('');
  const line = (r, gasto) => `<tr class="tap" data-acc="${esc(r.code)}"><td>${esc(r.nombre)}</td>${cellsOf(r.values, cell, gasto)}</tr>`;
  const groups = {}; p.gastos.forEach((r) => (groups[r.grupo || 'Otros'] ??= []).push(r));
  let gastosHtml = '';
  for (const [g, list] of Object.entries(groups)) {
    gastosHtml += list.map((r) => line(r, true)).join('');
    if (list.length > 1 && Object.keys(groups).length > 1) gastosHtml += `<tr class="sub dim"><td>Total ${esc(g.toLowerCase())}</td>${cellsOf(cols.map((_, i) => list.reduce((s, r) => s + r.values[i], 0)))}</tr>`;
  }
  const empty = `<tr><td class="muted" colspan="${n + 1}">Nada en este periodo</td></tr>`;
  $('#inf').innerHTML = `${periodBar(infPyG)}
    ${isMes ? `<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="lbl">Ahorro de ${esc(mesLargo(S.mes))}</div><div class="val ${cls(p.resultado[0])}">${eur(p.resultado[0], 0)}</div><div class="sub">ingresos − gastos</div></div><div class="kpi"><div class="lbl">Ingresos</div><div class="val">${eur(p.totalIngresos[0], 0)}</div></div><div class="kpi"><div class="lbl">Gastos</div><div class="val">${eur(p.totalGastos[0], 0)}</div><div class="sub">${p.imprevistos[0] ? `${eur(p.imprevistos[0], 0)} imprevistos` : 'sin imprevistos'}</div></div></div>` : ''}
    <div class="tablewrap"><table class="rep">${head}
      <tr class="sec"><td colspan="${n + 1}">Ingresos</td></tr>
      ${p.ingresos.map((r) => line(r, false)).join('') || empty}
      <tr class="sub"><td>Total ingresos</td>${cellsOf(p.totalIngresos, cell, false)}</tr>
      <tr class="sec"><td colspan="${n + 1}">Gastos</td></tr>
      ${gastosHtml || empty}
      <tr class="sub"><td>Total gastos</td>${cellsOf(p.totalGastos)}</tr>
      <tr class="dim"><td>· de ellos imprevistos</td>${cellsOf(p.imprevistos)}</tr>
      <tr class="tot"><td>Ahorro (resultado)</td>${cellsOf(p.resultado, cellNeg, false)}</tr>
      <tr class="dim"><td>Ahorro sin imprevistos</td>${cellsOf(p.resultado.map((v, i) => v + p.imprevistos[i]), cellNeg, false)}</tr>
    </table></div>
    <p class="small muted">Toca una línea para ver sus movimientos. Los traspasos entre tus cuentas y las compras de bienes (piso, coche…) no aparecen aquí porque no son ni ingreso ni gasto.</p>`;
  goAccount($('#inf'));
}

function needsApertura() {
  return `<div class="banner warn">Aún no has metido tus <strong>saldos iniciales</strong>. Sin ellos Financito no sabe cuánto dinero tienes, solo lo que entra y sale. <a href="#/ajustes" id="goap">Introducirlos →</a></div>`;
}

function infBalance() {
  const L = S.libro; const cur = ym(todayISO()); const isMes = S.periodo !== 'año';
  const start = L.inicio ? ym(L.inicio) : null;
  let months;
  if (isMes) months = [addMonths(S.mes, -1), S.mes];
  else months = Array.from({ length: 12 }, (_, i) => `${S.year}-${pad(i + 1)}`).filter((m) => m <= cur);
  if (start) months = months.filter((m) => m >= start);
  const top = `${periodBar(infBalance)}${L.inicio ? '' : needsApertura()}`;
  if (!months.length) { $('#inf').innerHTML = `${top}<div class="empty">Tus saldos empiezan en ${esc(mesLargo(start))}. Antes de esa fecha solo hay estadísticas de gastos.</div>`; return; }
  const bals = months.map((m) => L.balance(m)); const target = bals[bals.length - 1];
  const withDiff = isMes && bals.length === 2;
  const head = `<tr><th></th>${months.map((m) => `<th>${isMes ? `fin ${MESES[Number(m.slice(5)) - 1].toLowerCase()}` : MESES[Number(m.slice(5)) - 1]}</th>`).join('')}${withDiff ? '<th>Variación</th>' : ''}</tr>`;
  const n = months.length + (withDiff ? 1 : 0);
  const codesBy = (key) => { const set = new Map(); bals.forEach((b) => b[key].forEach((x) => set.set(x.code, x))); return [...set.values()].sort((a, b) => a.code.localeCompare(b.code)); };
  const valsOf = (key, code) => bals.map((b) => b[key].find((y) => y.code === code)?.saldo || 0);
  const row = (label, vals, klass = '', acc = '') => `<tr class="${klass}${acc ? ' tap' : ''}" ${acc ? `data-acc="${esc(acc)}"` : ''}><td>${esc(label)}</td>${vals.map(cell).join('')}${withDiff ? cellDiff(vals[1] - vals[0], false) : ''}</tr>`;
  const section = (key, title) => {
    const list = codesBy(key).filter((x) => valsOf(key, x.code).some((v) => Math.abs(v) > 0.004)); const groups = {};
    list.forEach((x) => (groups[displayGroup(L.byCode[x.code]) || x.grupo] ??= []).push(x));
    if (!list.length) return '';
    return `<tr class="sec"><td colspan="${n + 1}">${title}</td></tr>${Object.entries(groups).map(([g, l]) => `${l.map((x) => row(x.nombre, valsOf(key, x.code), '', x.code)).join('')}${l.length > 1 && Object.keys(groups).length > 1 ? row(`Total ${g.toLowerCase()}`, bals.map((b) => b[key].filter((y) => l.some((z) => z.code === y.code)).reduce((s, y) => s + y.saldo, 0)), 'sub dim') : ''}`).join('')}`;
  };
  $('#inf').innerHTML = `${top}
    <div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="lbl">Patrimonio neto · fin de ${esc(MESES[Number(target.month.slice(5)) - 1].toLowerCase())}</div><div class="val">${eur(target.patrimonioNeto, 0)}</div><div class="sub">${withDiff ? `${target.patrimonioNeto - bals[0].patrimonioNeto >= 0 ? '+' : ''}${eur(target.patrimonioNeto - bals[0].patrimonioNeto, 0)} en el mes` : 'lo que tienes − lo que debes'}</div></div>
    <div class="kpi"><div class="lbl">Lo que tienes</div><div class="val">${eur(target.totalActivo, 0)}</div></div><div class="kpi"><div class="lbl">Lo que debes</div><div class="val">${eur(target.totalPasivo, 0)}</div></div></div>
    <div class="tablewrap"><table class="rep">${head}
      ${section('activo', 'Lo que tienes (activo)')}
      ${row('Total activo', bals.map((b) => b.totalActivo), 'sub')}
      ${section('pasivo', 'Lo que debes (pasivo)')}
      ${row('Total deudas', bals.map((b) => b.totalPasivo), 'sub')}
      ${row('Patrimonio neto', bals.map((b) => b.patrimonioNeto), 'tot')}
      <tr class="dim"><td>¿Cuadra la contabilidad?</td>${bals.map((b) => `<td class="n">${Math.abs(b.descuadre) < 0.01 ? '✓' : `<span class="neg">${fmt(b.descuadre)}</span>`}</td>`).join('')}${withDiff ? '<td></td>' : ''}</tr>
    </table></div>
    <p class="small muted">Saldos a final de mes${L.inicio ? `, contando desde tu apertura del ${esc(L.inicio)}` : ''}. La variación del patrimonio debería coincidir con tu ahorro del mes (más revalorizaciones).</p>`;
  $('#goap')?.addEventListener('click', () => { setTimeout(apertura, 50); });
  goAccount($('#inf'));
}

let chartLib = null;
async function loadChart() {
  if (window.Chart) return window.Chart;
  chartLib ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; s.onload = () => res(window.Chart); s.onerror = rej; document.head.appendChild(s); });
  return chartLib;
}
const PALETTE = ['#1d8a68', '#3a78c2', '#d08a2e', '#b4508f', '#7a5cc2', '#3ba3a3', '#c2553a', '#7d8a3a', '#8a6b4f', '#5a6b7d'];
async function infGraficos() {
  const L = S.libro; const isMes = S.periodo !== 'año';
  const year = isMes ? Number(S.mes.slice(0, 4)) : S.year;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const cur = ym(todayISO());
  const showMonths = months.filter((m) => m <= cur || L.activeRows.some((r) => ym(r.fecha) === m));
  const data = showMonths.map((m) => L.gastoMes(m));
  const cats = [...new Set(data.flatMap((d) => Object.keys(d.porCuenta)))].sort();
  const mesSel = isMes ? S.mes : (showMonths[showMonths.length - 1] || cur);
  $('#inf').innerHTML = `${periodBar(infGraficos)}
    <div class="card"><h3>En qué se fue ${esc(mesLargo(mesSel))}</h3><div class="chartbox"><canvas id="c2"></canvas></div><p class="small muted">Incluye imprevistos.</p></div>
    <div class="card"><h3>Gasto corriente por mes · ${year}</h3><div class="chartbox"><canvas id="c1"></canvas></div><p class="small muted">Sin imprevistos ni amortizaciones.</p></div>
    <div class="card"><h3>Ingresos vs gastos · ${year}</h3><div class="chartbox"><canvas id="c3"></canvas></div></div>
    ${L.inicio ? `<div class="card"><h3>Patrimonio neto · ${year}</h3><div class="chartbox"><canvas id="c4"></canvas></div></div>` : ''}`;
  let Chart;
  try { Chart = await loadChart(); } catch { $('#inf').insertAdjacentHTML('afterbegin', '<div class="banner warn">No se pudo cargar la librería de gráficos (¿sin conexión?).</div>'); return; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  Chart.defaults.color = dark ? '#94a096' : '#667066';
  Chart.defaults.borderColor = dark ? '#2b332e' : '#e3e7e0';
  Chart.defaults.font.family = 'system-ui, sans-serif';
  const labels = showMonths.map((m) => MESES[Number(m.slice(5)) - 1]);
  const money = { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${eur(c.parsed.y ?? c.parsed)}` } };
  const axis = { ticks: { callback: (v) => `${fmt(v, 0)} €` } };
  S.charts?.forEach((c) => c.destroy()); S.charts = [];
  const d = L.gastoMes(mesSel, { incluirImprevistos: true }); const entries = Object.entries(d.porCuenta).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  S.charts.push(new Chart($('#c2'), { type: 'doughnut', data: { labels: entries.map(([c]) => L.nombre(c)), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${eur(c.parsed)}` } } } } }));
  S.charts.push(new Chart($('#c1'), { type: 'bar', data: { labels, datasets: cats.map((c, i) => ({ label: L.nombre(c), data: data.map((x) => x.porCuenta[c] || 0), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 3 })) }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: money }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ...axis } } } }));
  const p = L.pyg(year); const idx = showMonths.map((m) => Number(m.slice(5)) - 1);
  S.charts.push(new Chart($('#c3'), { type: 'bar', data: { labels, datasets: [{ label: 'Ingresos', data: idx.map((i) => p.totalIngresos[i]), backgroundColor: '#1d8a68', borderRadius: 3 }, { label: 'Gastos', data: idx.map((i) => p.totalGastos[i]), backgroundColor: '#c2553a', borderRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: money }, scales: { x: { grid: { display: false } }, y: axis } } }));
  if (L.inicio) {
    const pm = showMonths.filter((m) => m >= ym(L.inicio));
    S.charts.push(new Chart($('#c4'), { type: 'line', data: { labels: pm.map((m) => MESES[Number(m.slice(5)) - 1]), datasets: [{ label: 'Patrimonio neto', data: pm.map((m) => L.balance(m).patrimonioNeto), borderColor: '#3a78c2', backgroundColor: 'rgba(58,120,194,.12)', fill: true, tension: 0.25, pointRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: money }, scales: { x: { grid: { display: false } }, y: axis } } }));
  }
}

// ---------- presupuesto ----------
function infSobres() {
  const L = S.libro; const m = S.mes;
  const list = L.presupuesto(m);
  const cats = list.filter((p) => L.kind(p.code) === 'gasto');
  const banks = list.filter((p) => L.kind(p.code) !== 'gasto');
  const tot = cats.reduce((a, p) => ({ asig: a.asig + p.asignado, real: a.real + p.real }), { asig: 0, real: 0 });
  $('#inf').innerHTML = `${periodBar(infSobres, { allowYear: false })}
    <h2 style="margin-top:4px">Límite por categoría</h2>
    <p class="small muted" style="margin-top:-6px">Cuánto quieres gastar como máximo en cada cosa al mes, la pagues desde donde la pagues.</p>
    ${tot.asig ? `<div class="kpis duo" style="margin-bottom:10px"><div class="kpi"><div class="lbl">Límite total</div><div class="val">${eur(tot.asig, 0)}</div></div><div class="kpi"><div class="lbl">Gastado</div><div class="val ${tot.real > tot.asig ? 'neg' : ''}">${eur(tot.real, 0)}</div></div></div>` : ''}
    <div class="card">${cats.length ? sobresHtml(cats) : '<div class="empty">Sin límites. Ej.: «Súper y casa: 300 € al mes».</div>'}
      <button class="btn block" id="addcat" style="margin-top:10px">Añadir límite de categoría</button></div>
    <h2>Dinero para gastar en cada cuenta</h2>
    <p class="small muted" style="margin-top:-6px">Tu sistema de sobres: lo que metes cada mes en una cuenta para gastar (p. ej. Revolut Ana 200 €). Mide lo que gastas pagando desde ella.</p>
    <div class="card">${banks.length ? sobresHtml(banks) : '<div class="empty">Sin cuentas con dinero asignado.</div>'}
      <button class="btn block" id="addbank" style="margin-top:10px">Asignar dinero a una cuenta</button></div>
    <p class="small muted">No cuentan los imprevistos ni las amortizaciones.</p>`;
  $('#addcat').onclick = () => editSobre(null, 'gasto');
  $('#addbank').onclick = () => editSobre(null, 'dinero');
  bindRowItems($('#inf'));
}
function editSobre(id, kind) {
  const L = S.libro; const p = (L.db.Presupuesto || []).find((x) => String(x.id) === String(id));
  const k = p ? (L.kind(String(p.cuenta)) === 'gasto' ? 'gasto' : 'dinero') : kind;
  const fields = [
    { key: 'cuenta', label: k === 'gasto' ? 'Categoría' : 'Cuenta', type: 'select', options: (v) => accountOptions((c) => kindOf(c) === k && (k === 'gasto' || c.grupo === 'Tesorería'), v), required: true },
    { key: 'importe', label: k === 'gasto' ? 'Límite mensual €' : 'Dinero asignado al mes €', type: 'number', required: true },
    { key: 'ambito', label: 'Para', type: 'select', options: [['*', 'Todos los meses'], ['mes', `Solo ${mesLargo(S.mes)}`]] },
  ];
  formModal({
    title: p ? 'Editar' : (k === 'gasto' ? 'Nuevo límite de categoría' : 'Asignar dinero a una cuenta'), fields, values: p ? { ...p, ambito: p.mes === '*' ? '*' : 'mes' } : { ambito: '*' },
    onSave: async (d) => {
      const row = { id: p?.id || uid(), cuenta: d.cuenta, importe: d.importe, mes: d.ambito === '*' ? '*' : (p && p.mes !== '*' ? p.mes : S.mes), borrado: '' };
      if (p) await updateRows('Presupuesto', [{ ...p, ...row }]); else await addRows('Presupuesto', [row]);
    },
    onDelete: p ? async () => updateRows('Presupuesto', [{ ...p, borrado: 1 }]) : null,
  });
}

// ---------- comprobar con el banco ----------
function infCuadre() {
  const L = S.libro; const fecha = todayISO();
  if (!L.inicio) { $('#inf').innerHTML = `${needsApertura()}<p class="muted">Cuando metas los saldos iniciales podrás comprobar aquí, cuenta por cuenta, que lo que dice Financito coincide con lo que tienes de verdad en el banco.</p>`; $('#goap')?.addEventListener('click', () => setTimeout(apertura, 50)); return; }
  const accs = L.cuentas.filter((c) => kindOf(c) === 'dinero' && (c.activa !== 0 || L.balanceToDate(c.codigo)));
  const lastReal = (code) => (L.db.Saldos || []).filter((s) => String(s.cuenta) === code).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  $('#inf').innerHTML = `<div class="card" style="margin-bottom:12px"><strong>¿Cómo funciona?</strong><ol class="small" style="margin:6px 0 0;padding-left:18px"><li>Abre la app de tu banco y mira cuánto tienes ahora.</li><li>Escríbelo en su cuenta, abajo.</li><li>Si no coincide con Financito, te falta algún movimiento por apuntar.</li></ol></div>
    <div class="card"><ul class="list">${accs.map((c) => { const lib = L.balanceToDate(c.codigo, fecha); const lr = lastReal(c.codigo); return `<li style="flex-wrap:wrap"><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">Según Financito: <strong>${eur(lib)}</strong>${lr ? ` · comprobado el ${esc(normDate(lr.fecha))}` : ''}</div></div>
      <input type="text" inputmode="decimal" data-real="${esc(c.codigo)}" placeholder="En tu banco" aria-label="Saldo en tu banco de ${esc(c.nombre)}" style="width:130px;min-height:38px;padding:7px 10px;text-align:right">
      <div data-diff="${esc(c.codigo)}" class="small" style="width:100%"></div></li>`; }).join('')}</ul></div>`;
  $$('[data-real]').forEach((inp) => {
    inp.oninput = () => {
      const code = inp.dataset.real; const box = $(`[data-diff="${code}"]`); const inv = L.byCode[code]?.grupo === 'Inversiones';
      if (!inp.value.trim()) { box.innerHTML = ''; return; }
      const real = num(inp.value); const lib = L.balanceToDate(code, fecha); const d = round2(real - lib);
      if (Math.abs(d) < 0.01) { box.innerHTML = `<div class="row between" style="margin-top:6px"><span class="pos">✓ Cuadra</span><button class="btn sm" data-save="${esc(code)}">Marcar comprobado</button></div>`; }
      else {
        const msg = inv ? (d > 0 ? `Tu inversión vale ${eur(d)} más que lo apuntado (ha subido).` : `Tu inversión vale ${eur(-d)} menos que lo apuntado (ha bajado).`)
          : (d < 0 ? `En el banco hay ${eur(-d)} menos: probablemente falta apuntar algún gasto.` : `En el banco hay ${eur(d)} más: probablemente falta apuntar algún ingreso.`);
        box.innerHTML = `<div class="banner ${inv ? '' : 'warn'}" style="margin:8px 0 6px">${esc(msg)}</div><div class="row wrap">
          ${inv ? '' : `<button class="btn sm" data-ver="${esc(code)}">Ver movimientos</button>`}
          <button class="btn sm ${inv ? 'primary' : ''}" data-adj="${esc(code)}">${inv ? 'Actualizar valor' : 'Dar por buena la diferencia'}</button></div>`;
      }
      $(`[data-adj="${code}"]`, box)?.addEventListener('click', () => ajustar(code, real, d));
      $(`[data-ver="${code}"]`, box)?.addEventListener('click', () => { S.diario = { ...S.diario, cuenta: code, mes: '', q: '' }; location.hash = '#/diario'; });
      $(`[data-save="${code}"]`, box)?.addEventListener('click', async () => { try { await addRows('Saldos', [{ id: uid(), fecha, cuenta: code, saldo: real, notas: '' }]); toast('Comprobado'); infCuadre(); } catch (e) { fail(e); } });
    };
  });
}
async function ajustar(code, real, d) {
  const L = S.libro; const inv = L.byCode[code]?.grupo === 'Inversiones';
  const [debe, haber] = inv ? (d > 0 ? [code, '763'] : ['663', code]) : (d > 0 ? [code, '759'] : ['659', code]);
  const msg = inv ? `Registrar que ${L.nombre(code)} ha ${d > 0 ? 'ganado' : 'perdido'} ${eur(Math.abs(d))} de valor?` : `Se apuntará un descuadre de ${eur(Math.abs(d))} en ${L.nombre(code)} para que cuadre. Mejor si antes buscas el movimiento que falta. ¿Seguir?`;
  if (!confirm(msg)) return;
  try {
    await S.store.add('Diario', [newEntry({ fecha: todayISO(), concepto: inv ? `Revalorización ${L.nombre(code)}` : `Descuadre ${L.nombre(code)}`, debe, haber, importe: Math.abs(d), clase: 'ajuste' })]);
    await S.store.add('Saldos', [{ id: uid(), fecha: todayISO(), cuenta: code, saldo: real, notas: inv ? 'revalorización' : 'ajustado' }]);
    await reload(); toast(inv ? 'Valor actualizado' : 'Diferencia apuntada'); infCuadre();
  } catch (e) { fail(e); }
}

// ---------------- AJUSTES ----------------
function viewAjustes() {
  const L = S.libro; const url = S.store.sheetUrl();
  const rec = (L.db.Recurrentes || []).filter((r) => r.nombre);
  const act = (L.db.Activos || []).filter((a) => a.nombre);
  const pre = (L.db.Prestamos || []).filter((p) => p.nombre);
  const groups = {}; L.cuentas.forEach((c) => (groups[KIND_LABEL[kindOf(c)]] ??= []).push(c));
  const listOf = (kinds) => L.cuentas.filter((c) => kinds.includes(kindOf(c)) && !SYS.has(c.codigo)).sort((a, b) => kinds.indexOf(kindOf(a)) - kinds.indexOf(kindOf(b)));
  const accLi = (c, saldo) => `<li class="tap" data-acc="${esc(c.codigo)}"><div class="grow"><div class="t">${esc(c.nombre)}${c.activa === 0 || c.activa === '0' ? ' <span class="chip">oculta</span>' : ''}</div><div class="s">${esc(displayGroup(c))}</div></div>${saldo && L.inicio ? `<div class="amount">${eur(L.balanceToDate(c.codigo))}</div>` : ''}</li>`;
  view().innerHTML = `
    <h2 style="margin-top:4px">Mis cuentas</h2>
    <div class="card"><p class="small muted" style="margin-top:0">Donde tienes (o debes) el dinero: bancos, efectivo, inversiones, bienes y deudas.</p>
      <ul class="list">${listOf(['dinero', 'bien', 'deuda']).map((c) => accLi(c, true)).join('')}</ul>
      <div class="row wrap" style="margin-top:8px"><button class="btn sm" data-new="dinero">+ Banco o inversión</button><button class="btn sm" data-new="bien">+ Bien</button><button class="btn sm" data-new="deuda">+ Deuda</button></div></div>

    <h2>Categorías</h2>
    <div class="card"><h3 style="margin-top:0">De gasto</h3><ul class="list">${listOf(['gasto']).map((c) => accLi(c)).join('')}</ul>
      <button class="btn sm" data-new="gasto" style="margin-top:8px">+ Categoría de gasto</button>
      <h3>De ingreso</h3><ul class="list">${listOf(['ingreso']).map((c) => accLi(c)).join('')}</ul>
      <button class="btn sm" data-new="ingreso" style="margin-top:8px">+ Tipo de ingreso</button></div>

    <h2>Automatizaciones mensuales</h2>
    <div class="card"><ul class="list">${rec.map((r) => `<li class="tap" data-rec="${esc(r.id)}"><div class="grow"><div class="t">${esc(r.nombre)}</div><div class="s">Día ${esc(r.dia)} · ${esc(L.nombre(String(r.haber)))} → ${esc(L.nombre(String(r.debe)))} · desde ${esc(r.desde)}${r.hasta ? ` hasta ${esc(r.hasta)}` : ''}</div></div><div class="amount">${eur(num(r.importe))}</div><span class="chip">${truthy(r.activo) ? 'activa' : 'pausada'}</span></li>`).join('') || '<li class="muted">Ninguna</li>'}</ul>
      <button class="btn block" id="addrec" style="margin-top:8px">Añadir automatización</button>
      <p class="small muted">Cada mes, al abrir la app, se apuntan solas las que toquen. Si borras una generada, no se vuelve a crear.</p></div>

    <h2>Activos que se amortizan</h2>
    <div class="card"><ul class="list">${act.map((a) => { const am = L.activeRows.filter((r) => r.origen?.startsWith(`amort:${a.id}:`)).reduce((s, r) => s + r.importe, 0); return `<li class="tap" data-act="${esc(a.id)}"><div class="grow"><div class="t">${esc(a.nombre)}</div><div class="s">${eur(num(a.valor))} · ${Math.round(num(a.vida_meses) / 12 * 10) / 10} años · amortizado ${eur(am)}</div><div class="bar"><span style="width:${Math.min(100, am / Math.max(1, num(a.valor) - num(a.residual)) * 100)}%"></span></div></div></li>`; }).join('') || '<li class="muted">Ninguno. Se crean al apuntar una «Compra de activo» marcando «Amortizar».</li>'}</ul>
      <button class="btn block" id="addact" style="margin-top:8px">Añadir activo</button></div>

    <h2>Hipoteca y préstamos</h2>
    <div class="card"><ul class="list">${pre.map((p) => { const cq = cuadroPrestamo(p); const hoy = todayISO(); const next = cq.find((q) => q.fecha > hoy); const pend = [...cq].reverse().find((q) => q.fecha <= hoy)?.pendiente ?? num(p.capital); return `<li class="tap" data-pre="${esc(p.id)}"><div class="grow"><div class="t">${esc(p.nombre)}</div><div class="s">Cuota ${eur(cq[0]?.cuota || 0)} · ${esc(p.interes_anual)} % · pendiente ${eur(pend)}${next ? ` · próxima ${esc(next.fecha)}` : ''}</div></div></li>`; }).join('') || '<li class="muted">Ninguno</li>'}</ul>
      <button class="btn block" id="addpre" style="margin-top:8px">Añadir hipoteca o préstamo</button>
      <p class="small muted">Cada cuota se apunta sola separando intereses (gasto 662) y capital (baja la deuda 170).</p></div>

    <h2>Saldos iniciales</h2>
    <div class="card"><p class="small muted" style="margin-top:0">${L.inicio ? `Tus saldos se cuentan desde el <strong>${esc(L.inicio)}</strong>. Los movimientos anteriores solo cuentan para las estadísticas de gasto.` : 'Lo que tienes en cada banco (y lo que debes) el día que empiezas a usar Financito. Sin esto, la app no sabe cuánto dinero tienes.'}</p><button class="btn block ${L.inicio ? '' : 'primary'}" id="apertura">${L.inicio ? 'Añadir o corregir saldos iniciales' : 'Introducir saldos iniciales'}</button></div>

    <h2>Avanzado</h2>
    <details class="card"><summary>Plan contable completo (${L.cuentas.length} cuentas con su código)</summary>
      <p class="small muted">Así guarda Financito todo por debajo, con la numeración del Plan General Contable: 2 bienes, 5 bancos e inversiones, 6 gastos, 7 ingresos, 1 patrimonio y deudas.</p>
      ${Object.entries(groups).map(([g, list]) => `<h3>${esc(g)}</h3><ul class="list">${list.map((c) => `<li class="tap" data-acc="${esc(c.codigo)}"><div class="grow"><div class="t">${esc(c.nombre)}${c.activa === 0 || c.activa === '0' ? ' <span class="chip">oculta</span>' : ''}</div><div class="s">${esc(c.codigo)} · ${esc(c.tipo)}</div></div></li>`).join('')}</ul>`).join('')}
    </details>

    <h2>Datos</h2>
    <div class="card stack">
      ${url ? `<a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">Abrir la hoja en Google Sheets ↗</a>` : ''}
      <label class="btn block" for="imp">Importar movimientos (JSON)</label><input type="file" id="imp" accept=".json,application/json" hidden>
      <button class="btn block" id="exp">Descargar copia de seguridad (JSON)</button>
      ${S.store.kind === 'demo' ? '<button class="btn block" id="resetdemo">Reiniciar datos de ejemplo</button>' : ''}
      <button class="btn block danger" id="logout">${S.store.kind === 'demo' ? 'Salir del modo demo' : 'Cerrar sesión'}</button>
    </div>
    <p class="small muted center" style="margin-top:18px">${S.store.kind === 'demo' ? 'Modo demo · datos solo en este navegador' : 'Datos en tu Google Sheets'} · ${L.activeRows.length} movimientos</p>`;

  $$('[data-rec]').forEach((li) => { li.onclick = () => editRecurrente(li.dataset.rec); });
  $('#addrec').onclick = () => editRecurrente(null);
  $$('[data-act]').forEach((li) => { li.onclick = () => editActivo(li.dataset.act); });
  $('#addact').onclick = () => editActivo(null);
  $$('[data-pre]').forEach((li) => { li.onclick = () => editPrestamo(li.dataset.pre); });
  $('#addpre').onclick = () => editPrestamo(null);
  $$('[data-acc]').forEach((li) => { li.onclick = () => editCuenta(li.dataset.acc); });
  $$('[data-new]').forEach((b) => { b.onclick = () => editCuenta(null, b.dataset.new); });
  $('#apertura').onclick = apertura;
  $('#imp').onchange = importar;
  $('#exp').onclick = exportar;
  $('#resetdemo')?.addEventListener('click', async () => { if (!confirm('¿Reiniciar los datos de ejemplo?')) return; S.store.reset(); await reload({ automations: true }); render(); });
  $('#logout').onclick = () => {
    if (!confirm(S.store.kind === 'demo' ? '¿Salir del modo demo?' : '¿Cerrar sesión?')) return;
    if (S.store.kind !== 'demo') auth.logout();
    LS.set('mode', ''); S.libro = null; location.hash = ''; location.reload();
  };
}

const CLASE_OPTS = Object.entries(CLASES).filter(([k]) => ['corriente', 'imprevisto', 'traspaso', 'ingreso', 'patrimonial'].includes(k));
function editRecurrente(id) {
  const L = S.libro; const r = (L.db.Recurrentes || []).find((x) => String(x.id) === String(id));
  const fields = [
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'importe', label: 'Importe €', type: 'number', required: true },
    { key: 'haber', label: 'Sale de', type: 'select', options: (v) => accountOptions(() => true, v), required: true },
    { key: 'debe', label: 'Va a', type: 'select', options: (v) => accountOptions(() => true, v), required: true },
    { key: 'dia', label: 'Día del mes', type: 'number', required: true },
    { key: 'clase', label: 'Clase', type: 'select', options: CLASE_OPTS },
    { key: 'desde', label: 'Desde (mes)', type: 'month', required: true },
    { key: 'hasta', label: 'Hasta (mes, opcional)', type: 'month' },
    { key: 'activo', label: 'Activa', type: 'checkbox' },
  ];
  formModal({
    title: r ? 'Editar automatización' : 'Nueva automatización', fields,
    values: r ? { ...r, desde: String(r.desde).slice(0, 7), hasta: String(r.hasta || '').slice(0, 7) } : { dia: 1, clase: 'corriente', desde: ym(todayISO()), activo: 1, haber: L.cuentas.find(isTes)?.codigo },
    onSave: async (d) => {
      const row = { ...(r || { id: uid() }), ...d, dia: Math.round(num(d.dia)) || 1 };
      if (r) await S.store.update('Recurrentes', [row]); else await S.store.add('Recurrentes', [row]);
      await reload({ automations: true }); if (S.autoMsg) toast(S.autoMsg, 4000);
    },
    onDelete: r ? async () => { await updateRows('Recurrentes', [{ ...r, activo: 0, nombre: `${r.nombre} (borrada)` }]); } : null,
  });
}
function editActivo(id) {
  const L = S.libro; const a = (L.db.Activos || []).find((x) => String(x.id) === String(id));
  const fields = [
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'cuenta', label: 'Cuenta de activo', type: 'select', options: (v) => accountOptions((c) => c.grupo === 'Inmovilizado' && c.codigo !== '281', v), required: true },
    { key: 'fecha_alta', label: 'Fecha de compra', type: 'date', required: true },
    { key: 'valor', label: 'Valor de compra €', type: 'number', required: true },
    { key: 'vida_meses', label: 'Vida útil (meses)', type: 'number', required: true, hint: '36 = 3 años' },
    { key: 'residual', label: 'Valor residual €', type: 'number' },
    { key: 'activo', label: 'Amortizando', type: 'checkbox' },
  ];
  formModal({
    title: a ? 'Editar activo' : 'Nuevo activo', fields, values: a ? { ...a, fecha_alta: normDate(a.fecha_alta) } : { fecha_alta: todayISO(), vida_meses: 36, residual: 0, activo: 1, cuenta: '218' },
    extra: a ? '' : '<p class="hint">Esto solo programa la amortización. La compra en sí apúntala con «Compra de activo» (o márcalo allí directamente).</p>',
    onSave: async (d) => { const row = { ...(a || { id: uid() }), ...d }; if (a) await S.store.update('Activos', [row]); else await S.store.add('Activos', [row]); await reload({ automations: true }); },
    onDelete: a ? async () => updateRows('Activos', [{ ...a, activo: 0 }]) : null,
  });
}
function editPrestamo(id) {
  const L = S.libro; const p = (L.db.Prestamos || []).find((x) => String(x.id) === String(id));
  const fields = [
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'capital', label: 'Capital prestado €', type: 'number', required: true },
    { key: 'interes_anual', label: 'Interés anual %', type: 'number', required: true },
    { key: 'plazo_meses', label: 'Plazo (meses)', type: 'number', required: true, hint: '360 = 30 años' },
    { key: 'primera_cuota', label: 'Fecha de la primera cuota', type: 'date', required: true },
    { key: 'cuenta_banco', label: 'Se paga desde', type: 'select', options: (v) => accountOptions(isTes, v), required: true },
    { key: 'cuenta_pasivo', label: 'Cuenta de deuda', type: 'select', options: (v) => accountOptions((c) => c.tipo === 'pasivo', v), required: true },
    { key: 'cuenta_interes', label: 'Cuenta de intereses', type: 'select', options: (v) => accountOptions(isGasto, v), required: true },
    { key: 'activo', label: 'Generar cuotas automáticamente', type: 'checkbox' },
  ];
  const cuadro = p ? cuadroPrestamo(p) : [];
  const extra = p ? `<details class="card" style="margin-bottom:12px"><summary>Ver cuadro de amortización (${cuadro.length} cuotas)</summary><div class="tablewrap" style="margin-top:8px;max-height:280px;overflow:auto"><table class="rep"><tr><th>#</th><th>Fecha</th><th>Cuota</th><th>Intereses</th><th>Capital</th><th>Pendiente</th></tr>${cuadro.map((q) => `<tr><td>${q.n}</td><td class="n">${q.fecha}</td><td class="n">${fmt(q.cuota)}</td><td class="n">${fmt(q.intereses)}</td><td class="n">${fmt(q.capital)}</td><td class="n">${fmt(q.pendiente, 0)}</td></tr>`).join('')}</table></div></details>`
    : '<p class="hint">Antes, registra la deuda: en «Saldos iniciales» (lo pendiente el día que empiezas) o con un asiento libre «Banco a Hipoteca» el día que la firmes.</p>';
  formModal({
    title: p ? 'Editar préstamo' : 'Nueva hipoteca o préstamo', fields, extra,
    values: p ? { ...p, primera_cuota: normDate(p.primera_cuota) } : { nombre: 'Hipoteca', cuenta_pasivo: '170', cuenta_interes: '662', activo: 1, cuenta_banco: L.cuentas.find(isTes)?.codigo },
    onSave: async (d) => { const row = { ...(p || { id: uid() }), ...d }; if (p) await S.store.update('Prestamos', [row]); else await S.store.add('Prestamos', [row]); await reload({ automations: true }); },
    onDelete: p ? async () => updateRows('Prestamos', [{ ...p, activo: 0 }]) : null,
  });
}
const KIND_DEF = {
  dinero: { tipo: 'activo', grupo: 'Tesorería', titulo: 'Nuevo banco o inversión' },
  bien: { tipo: 'activo', grupo: 'Inmovilizado', titulo: 'Nuevo bien' },
  deuda: { tipo: 'pasivo', grupo: 'Deudas', titulo: 'Nueva deuda' },
  gasto: { tipo: 'gasto', grupo: 'Gastos variables', titulo: 'Nueva categoría de gasto' },
  ingreso: { tipo: 'ingreso', grupo: 'Ingresos', titulo: 'Nuevo tipo de ingreso' },
};
function editCuenta(code, kind) {
  const L = S.libro; const c = L.cuentas.find((x) => x.codigo === code);
  const k = c ? kindOf(c) : kind;
  const fields = [{ key: 'nombre', label: 'Nombre', required: true }];
  if (k === 'dinero') fields.push({ key: 'grupo', label: 'Tipo', type: 'select', options: [['Tesorería', 'Banco o efectivo'], ['Inversiones', 'Inversión (Trade Republic, fondos…)']] });
  if (k === 'gasto') fields.push({ key: 'grupo', label: 'Grupo', type: 'select', options: [...new Set(['Gastos variables', 'Gastos fijos', ...L.cuentas.filter((x) => x.tipo === 'gasto').map((x) => x.grupo)])].map((g) => [g, g]) });
  fields.push({ key: 'activa', label: 'Visible en los formularios', type: 'checkbox' });
  const extra = c ? `<p class="hint">Código contable: ${esc(c.codigo)} · ${esc(c.tipo)}</p>` : '';
  formModal({
    title: c ? c.nombre : KIND_DEF[k]?.titulo || 'Nueva cuenta', fields, extra,
    values: c || { activa: 1, grupo: KIND_DEF[k]?.grupo },
    onSave: async (d) => {
      if (c) { await updateRows('Cuentas', [{ ...c, ...d, _row: c._row }]); return; }
      const def = KIND_DEF[k] || KIND_DEF.gasto;
      const codigo = d.grupo === 'Inversiones' ? nextInv(L) : nextCode(L.cuentas, k);
      await addRows('Cuentas', [{ codigo, nombre: d.nombre, tipo: def.tipo, grupo: d.grupo || def.grupo, orden: L.cuentas.length + 1, activa: 1 }]);
    },
  });
}
const nextInv = (L) => { for (let n = 541; n < 550; n++) if (!L.byCode[String(n)]) return String(n); return nextCode(L.cuentas, 'dinero'); };

function apertura() {
  const L = S.libro;
  const ORD = ['dinero', 'bien', 'deuda'];
  const accs = L.cuentas.filter((c) => ORD.includes(kindOf(c)) && c.activa !== 0).sort((a, b) => ORD.indexOf(kindOf(a)) - ORD.indexOf(kindOf(b)));
  const groups = {}; accs.forEach((c) => (groups[KIND_LABEL[kindOf(c)]] ??= []).push(c));
  const fechaDef = L.inicio || todayISO();
  openModal(`<h2>Saldos iniciales</h2><form novalidate>
    <div class="field"><label class="lbl">¿Desde qué día empiezas a llevar las cuentas?</label><input type="date" name="fecha" value="${fechaDef}"><div class="hint">Puede ser hoy o el 1 de enero. Los movimientos anteriores seguirán contando para las estadísticas de gasto, pero no para los saldos.</div></div>
    <p class="small muted">Escribe cuánto tenías ese día en cada sitio. Deja en blanco lo que esté a cero.</p>
    ${Object.entries(groups).map(([g, list]) => `<h3>${esc(g)}</h3>${list.map((c) => `<div class="row" style="margin-bottom:8px"><label class="grow" for="ap_${c.codigo}">${esc(c.nombre)}${kindOf(c) === 'deuda' ? ' <span class="muted small">(lo que queda por pagar)</span>' : ''}</label><input id="ap_${c.codigo}" name="${c.codigo}" type="text" inputmode="decimal" style="width:130px;text-align:right" placeholder="0,00"></div>`).join('')}`).join('')}
    <div class="actions"><button type="button" class="btn" data-cancel>Cancelar</button><button class="btn primary" type="submit">Guardar saldos</button></div></form>`, (m) => {
    $('[data-cancel]', m).onclick = closeModal;
    $('form', m).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const fecha = f.fecha.value || todayISO(); const asiento = uid();
      const rows = [];
      for (const c of accs) {
        const v = round2(num(f.querySelector(`[name="${c.codigo}"]`).value)); if (!v) continue;
        const [debe, haber] = c.tipo === 'pasivo' ? (v > 0 ? ['100', c.codigo] : [c.codigo, '100']) : (v > 0 ? [c.codigo, '100'] : ['100', c.codigo]);
        rows.push(newEntry({ asiento, fecha, concepto: `Saldo inicial ${c.nombre}`, debe, haber, importe: Math.abs(v), clase: 'apertura', origen: 'apertura' }));
      }
      if (!rows.length) { toast('No has puesto ningún saldo'); return; }
      try {
        await S.store.add('Diario', rows);
        if (!L.inicio || fecha < L.inicio) await setConfig('inicio', fecha);
        await reload(); closeModal(); toast(`Saldos guardados (${rows.length} cuentas)`); render();
      } catch (err) { fail(err); }
    };
  });
}

async function importar(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const L = S.libro;
    const cuentas = (data.Cuentas || []).filter((c) => !L.byCode[String(c.codigo)]).map((c) => ({ ...c, codigo: String(c.codigo) }));
    const existing = new Set(L.rows.map((r) => String(r.id)));
    const diario = (data.Diario || []).filter((r) => !existing.has(String(r.id))).map((r) => ({ id: r.id || uid(), asiento: r.asiento || uid(), origen: r.origen || 'importado', creado: todayISO(), borrado: '', notas: '', ...r, importe: round2(num(r.importe)) }));
    if (!confirm(`Importar ${diario.length} movimientos${cuentas.length ? ` y ${cuentas.length} cuentas nuevas` : ''}?`)) return;
    if (cuentas.length) await S.store.add('Cuentas', cuentas);
    for (let i = 0; i < diario.length; i += 400) await S.store.add('Diario', diario.slice(i, i + 400));
    await reload(); toast(`Importados ${diario.length} movimientos`); render();
  } catch (err) { fail(err); } finally { e.target.value = ''; }
}
function exportar() {
  const db = structuredClone(S.libro.db); Object.values(db).forEach((t) => t.forEach?.((o) => delete o._row));
  const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `libro-${todayISO()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------- service worker ----------------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
