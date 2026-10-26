import { CONFIG } from './config.js';
import { auth, AuthError, SheetsStore, LocalStore } from './store.js';
import {
  Libro, TABLES, CLASES, uid, round2, num, truthy, todayISO, ym, addMonths, eur, fmt, MESES, mesLargo, normDate, cuadroPrestamo, pad,
} from './model.js';

// ---------------- estado y utilidades de UI ----------------
const S = { store: null, libro: null, loading: false, mes: ym(todayISO()), year: Number(todayISO().slice(0, 4)), informe: 'pyg', apuntar: 'gasto', diario: { q: '', mes: '', cuenta: '', n: 80 } };
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
    (groups[c.grupo || 'Otras'] ??= []).push(c);
  }
  return Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((c) => `<option value="${esc(c.codigo)}" ${String(selected) === c.codigo ? 'selected' : ''}>${esc(c.nombre)} · ${esc(c.codigo)}</option>`).join('')}</optgroup>`).join('');
}
const isTes = (c) => c.grupo === 'Tesorería';
const isPayer = (c) => c.tipo === 'activo' && ['Tesorería', 'Inversiones'].includes(c.grupo) || c.tipo === 'pasivo';
const isGasto = (c) => c.tipo === 'gasto';
const isIngreso = (c) => c.tipo === 'ingreso';

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
  }
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
  const tes = L.cuentas.filter((c) => (isTes(c) || c.grupo === 'Inversiones' || c.tipo === 'pasivo') && Math.abs(L.balanceToDate(c.codigo)) > 0.004);
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
      <div class="kpi"><div class="lbl">Patrimonio neto</div><div class="val">${eur(bal.patrimonioNeto, 0)}</div><div class="sub">activo − deudas</div></div>
    </div>

    ${sob.length ? `<h2>Sobres de ${esc(MESES[Number(mes.slice(5)) - 1].toLowerCase())}</h2><div class="card">${sobresHtml(sob.slice(0, 6))}<div style="margin-top:8px"><a href="#/informes" data-inf="sobres" class="small">Ver todos los sobres →</a></div></div>` : ''}

    ${top.length ? `<h2>En qué se va este mes</h2><div class="card"><ul class="list">${top.map(([c, v]) => `<li><div class="grow"><div class="t">${esc(L.nombre(c))}</div><div class="bar"><span style="width:${Math.min(100, (v / (top[0][1] || 1)) * 100)}%"></span></div></div><div class="amount">${eur(v)}</div></li>`).join('')}</ul></div>` : ''}

    <h2>Saldos</h2>
    <div class="card"><ul class="list">${tes.map((c) => { const s = L.balanceToDate(c.codigo); return `<li><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">${esc(c.grupo)}</div></div><div class="amount ${s < 0 ? 'neg' : ''}">${eur(s)}</div></li>`; }).join('') || '<li class="muted">Sin cuentas</li>'}</ul></div>

    <h2>Últimos movimientos</h2>
    <div class="card">${last.length ? `<ul class="list">${last.map((r) => rowItem(r)).join('')}</ul>` : '<div class="empty">Aún no hay movimientos. Pulsa <strong>+</strong> para apuntar el primero.</div>'}</div>
  `;
  $$('[data-inf]').forEach((a) => a.addEventListener('click', () => { S.informe = a.dataset.inf; }));
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
  const t = S.apuntar; const L = S.libro;
  const last = (k, def) => LS.get(`last_${t}_${k}`) || def;
  // cuenta de pago más usada en los últimos movimientos (si no, Mediolanum o la primera de tesorería)
  const freq = {}; L.activeRows.slice(-200).forEach((r) => { if (L.byCode[r.haber] && isTes(L.byCode[r.haber])) freq[r.haber] = (freq[r.haber] || 0) + 1; });
  const firstTes = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || (L.byCode['5721'] ? '5721' : L.cuentas.find(isTes)?.codigo || '');
  const flows = {
    gasto: 'Sale de una cuenta tuya → va a una categoría de gasto (grupo 6).',
    ingreso: 'Viene de una fuente de ingreso (grupo 7) → entra en una cuenta tuya.',
    traspaso: 'Mueves dinero entre tus cuentas. No es gasto ni ingreso.',
    activo: 'Compras algo que conserva valor (grupo 2 o inversiones). No es gasto; si lo amortizas, el gasto se reparte en meses.',
    libre: 'Eliges tú la cuenta de debe y la de haber.',
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
      <label class="lbl">Categoría</label>
      <div class="quick" id="quick">${gastosCorr.map((c) => `<button type="button" data-v="${esc(c.codigo)}" class="${c.codigo === defCat ? 'on' : ''}">${esc(c.nombre)}</button>`).join('')}</div>
      ${sel('debe', 'Cuenta de gasto', isGasto, defCat)}
      ${sel('haber', 'Pagado con', isPayer, last('haber', firstTes))}
      <div class="two">${fecha}<div class="field"><label class="lbl">&nbsp;</label><label class="check"><input type="checkbox" name="imprevisto"> Imprevisto</label></div></div>${notas}`;
  } else if (t === 'ingreso') {
    body = `${importe}${concepto('Nómina, comisión, venta…')}
      ${sel('haber', 'Tipo de ingreso', isIngreso, last('haber', L.accountsOf('ingreso')[0]?.codigo))}
      ${sel('debe', 'Cobrado en', isPayer, last('debe', firstTes))}${fecha}${notas}`;
  } else if (t === 'traspaso') {
    const pay = (c) => c.tipo === 'activo' || c.tipo === 'pasivo';
    body = `${importe}${concepto('Reparto, ahorro, aportación…')}
      ${sel('haber', 'Desde', pay, last('haber', firstTes))}
      ${sel('debe', 'Hacia', pay, last('debe', L.cuentas.find((c) => c.codigo === '540')?.codigo || firstTes))}${fecha}${notas}`;
  } else if (t === 'activo') {
    const act = (c) => c.tipo === 'activo' && !isTes(c) && c.codigo !== '281';
    body = `${importe}${concepto('Patinete, impresora, entrada piso…')}
      ${sel('debe', 'Qué es (cuenta de activo)', act, last('debe', '218'))}
      ${sel('haber', 'Pagado con', isPayer, last('haber', firstTes))}${fecha}
      <div class="field"><label class="check"><input type="checkbox" name="amortizar" id="f_amortizar"> Amortizar (repartir el gasto en el tiempo)</label></div>
      <div id="amortbox" hidden class="two"><div class="field"><label class="lbl">Vida útil (años)</label><input type="text" inputmode="decimal" name="vida" value="3"></div><div class="field"><label class="lbl">Valor residual €</label><input type="text" inputmode="decimal" name="residual" value="0"></div></div>${notas}`;
  } else {
    body = `${importe}${concepto('Concepto')}
      ${sel('debe', 'Debe (recibe / se carga)', () => true, last('debe', ''))}
      ${sel('haber', 'Haber (entrega / se abona)', () => true, last('haber', ''))}
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
    { key: 'debe', label: 'Debe (va a)', type: 'select', options: (v) => accountOptions(all, v), required: true },
    { key: 'haber', label: 'Haber (sale de)', type: 'select', options: (v) => accountOptions(all, v), required: true },
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
const INFORMES = [['pyg', 'PyG'], ['balance', 'Balance'], ['graficos', 'Gráficos'], ['sobres', 'Sobres'], ['cuadre', 'Cuadre']];
function viewInformes() {
  view().innerHTML = `<div class="seg">${INFORMES.map(([k, l]) => `<button data-i="${k}" class="${S.informe === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="inf" style="margin-top:14px"></div>`;
  $$('.seg button').forEach((b) => { b.onclick = () => { S.informe = b.dataset.i; viewInformes(); }; });
  ({ pyg: infPyG, balance: infBalance, graficos: infGraficos, sobres: infSobres, cuadre: infCuadre })[S.informe]();
}
function yearNav(onChange) {
  const years = [...new Set([...S.libro.activeRows.map((r) => Number(r.fecha.slice(0, 4))), Number(todayISO().slice(0, 4))])].sort();
  const html = `<div class="monthnav"><button class="iconbtn" data-y="-1" aria-label="Año anterior">‹</button><strong>${S.year}</strong><button class="iconbtn" data-y="1" aria-label="Año siguiente">›</button></div>`;
  setTimeout(() => $$('[data-y]').forEach((b) => { b.onclick = () => { const ny = S.year + Number(b.dataset.y); if (ny >= years[0] - 1 && ny <= years[years.length - 1] + 1) { S.year = ny; onChange(); } }; }), 0);
  return html;
}
const cell = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : ''}">${Math.abs(v) < 0.005 ? '–' : fmt(v, 0)}</td>`;
const cellNeg = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : cls(v)}">${Math.abs(v) < 0.005 ? '–' : fmt(v, 0)}</td>`;

function infPyG() {
  const L = S.libro; const p = L.pyg(S.year);
  const cur = ym(todayISO());
  const lastIdx = S.year < Number(cur.slice(0, 4)) ? 11 : S.year > Number(cur.slice(0, 4)) ? -1 : Number(cur.slice(5)) - 1;
  const hasData = (i) => p.totalGastos[i] || p.totalIngresos[i];
  const firstData = p.months.findIndex((_, i) => hasData(i));
  const idx = p.months.map((_, i) => i).filter((i) => (firstData < 0 || i >= firstData) && (i <= Math.max(lastIdx, 0) || hasData(i)));
  const head = `<tr><th>${S.year}</th>${idx.map((i) => `<th>${MESES[i]}</th>`).join('')}<th>Total</th></tr>`;
  const line = (r) => `<tr class="tap" data-acc="${esc(r.code)}"><td title="${esc(r.code)}">${esc(r.nombre)}</td>${idx.map((i) => cell(r.values[i])).join('')}<td class="n"><strong>${fmt(r.total, 0)}</strong></td></tr>`;
  const groupsOf = (list) => { const g = {}; list.forEach((r) => (g[r.grupo || 'Otros'] ??= []).push(r)); return g; };
  let gastosHtml = '';
  for (const [g, list] of Object.entries(groupsOf(p.gastos))) {
    gastosHtml += list.map(line).join('');
    if (list.length > 1) { const sums = idx.map((i) => list.reduce((s, r) => s + r.values[i], 0)); gastosHtml += `<tr class="sub dim"><td>Total ${esc(g.toLowerCase())}</td>${sums.map(cell).join('')}<td class="n">${fmt(list.reduce((s, r) => s + r.total, 0), 0)}</td></tr>`; }
  }
  const resOrd = idx.map((i) => p.resultado[i] + p.imprevistos[i]);
  view().querySelector('#inf').innerHTML = `${yearNav(infPyG)}
    <div class="tablewrap"><table class="rep">${head}
      <tr class="sec"><td colspan="${idx.length + 2}">Ingresos (grupo 7)</td></tr>
      ${p.ingresos.map(line).join('') || `<tr><td class="muted">Sin ingresos</td><td colspan="${idx.length + 1}"></td></tr>`}
      <tr class="sub"><td>Total ingresos</td>${idx.map((i) => cell(p.totalIngresos[i])).join('')}<td class="n">${fmt(p.totals.ingresos, 0)}</td></tr>
      <tr class="sec"><td colspan="${idx.length + 2}">Gastos (grupo 6)</td></tr>
      ${gastosHtml || `<tr><td class="muted">Sin gastos</td><td colspan="${idx.length + 1}"></td></tr>`}
      <tr class="sub"><td>Total gastos</td>${idx.map((i) => cell(p.totalGastos[i])).join('')}<td class="n">${fmt(p.totals.gastos, 0)}</td></tr>
      <tr class="dim"><td>· de los cuales imprevistos</td>${idx.map((i) => cell(p.imprevistos[i])).join('')}<td class="n">${fmt(p.totals.imprevistos, 0)}</td></tr>
      <tr class="tot"><td>Resultado (ahorro)</td>${idx.map((i) => cellNeg(p.resultado[i])).join('')}<td class="n ${cls(p.totals.resultado)}">${fmt(p.totals.resultado, 0)}</td></tr>
      <tr class="dim"><td>Resultado sin imprevistos</td>${resOrd.map(cellNeg).join('')}<td class="n">${fmt(p.totals.resultado + p.totals.imprevistos, 0)}</td></tr>
    </table></div>
    <p class="small muted">Toca una cuenta para ver sus movimientos. Los traspasos entre tus cuentas y las compras de activos no aparecen aquí: no son ingreso ni gasto.</p>`;
  $$('#inf tr[data-acc]').forEach((tr) => { tr.onclick = () => { S.diario = { ...S.diario, cuenta: tr.dataset.acc, mes: '', q: '' }; location.hash = '#/diario'; }; });
}

function infBalance() {
  const L = S.libro; const cur = ym(todayISO());
  const months = Array.from({ length: 12 }, (_, i) => `${S.year}-${pad(i + 1)}`).filter((m) => m <= cur);
  const bals = months.map((m) => L.balance(m));
  const target = bals[bals.length - 1];
  if (!target) { $('#inf').innerHTML = `${yearNav(infBalance)}<div class="empty">Sin datos para ${S.year}.</div>`; return; }
  const head = `<tr><th>${S.year}</th>${months.map((m) => `<th>${MESES[Number(m.slice(5)) - 1]}</th>`).join('')}</tr>`;
  const codesBy = (key) => { const set = new Map(); bals.forEach((b) => b[key].forEach((x) => set.set(x.code, x))); return [...set.values()].sort((a, b) => a.code.localeCompare(b.code)); };
  const lineFor = (key, x) => `<tr class="tap" data-acc="${esc(x.code)}"><td>${esc(x.nombre)}</td>${bals.map((b) => cell(b[key].find((y) => y.code === x.code)?.saldo || 0)).join('')}</tr>`;
  const section = (key, title) => {
    const list = codesBy(key); const groups = {};
    list.forEach((x) => (groups[x.grupo] ??= []).push(x));
    return `<tr class="sec"><td colspan="${months.length + 1}">${title}</td></tr>${Object.entries(groups).map(([g, l]) => `${l.map((x) => lineFor(key, x)).join('')}${l.length > 1 ? `<tr class="sub dim"><td>${esc(g)}</td>${bals.map((b) => cell(b[key].filter((y) => y.grupo === g).reduce((s, y) => s + y.saldo, 0))).join('')}</tr>` : ''}`).join('')}`;
  };
  $('#inf').innerHTML = `${yearNav(infBalance)}
    <div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="lbl">Patrimonio neto (${esc(MESES[Number(target.month.slice(5)) - 1])})</div><div class="val">${eur(target.patrimonioNeto, 0)}</div></div>
    <div class="kpi"><div class="lbl">Activo</div><div class="val">${eur(target.totalActivo, 0)}</div></div><div class="kpi"><div class="lbl">Deudas</div><div class="val">${eur(target.totalPasivo, 0)}</div></div></div>
    <div class="tablewrap"><table class="rep">${head}
      ${section('activo', 'Activo')}
      <tr class="sub"><td>Total activo</td>${bals.map((b) => cell(b.totalActivo)).join('')}</tr>
      ${section('pasivo', 'Pasivo (deudas)')}
      <tr class="sub"><td>Total pasivo</td>${bals.map((b) => cell(b.totalPasivo)).join('')}</tr>
      ${section('pn', 'Patrimonio neto')}
      <tr><td>Resultados acumulados</td>${bals.map((b) => cell(b.resultado)).join('')}</tr>
      <tr class="sub"><td>Total patrimonio neto</td>${bals.map((b) => cell(b.totalPN)).join('')}</tr>
      <tr class="tot"><td>Pasivo + PN</td>${bals.map((b) => cell(b.totalPasivo + b.totalPN)).join('')}</tr>
      <tr class="dim"><td>¿Cuadra?</td>${bals.map((b) => `<td class="n">${Math.abs(b.descuadre) < 0.01 ? '✓' : `<span class="neg">${fmt(b.descuadre)}</span>`}</td>`).join('')}</tr>
    </table></div>
    <p class="small muted">Saldos a final de cada mes. «Cuadra» comprueba que activo = pasivo + patrimonio neto: siempre debería salir ✓ porque cada asiento tiene su contrapartida.</p>`;
  $$('#inf tr[data-acc]').forEach((tr) => { tr.onclick = () => { S.diario = { ...S.diario, cuenta: tr.dataset.acc, mes: '', q: '' }; location.hash = '#/diario'; }; });
}

let chartLib = null;
async function loadChart() {
  if (window.Chart) return window.Chart;
  chartLib ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; s.onload = () => res(window.Chart); s.onerror = rej; document.head.appendChild(s); });
  return chartLib;
}
const PALETTE = ['#1d8a68', '#3a78c2', '#d08a2e', '#b4508f', '#7a5cc2', '#3ba3a3', '#c2553a', '#7d8a3a', '#8a6b4f', '#5a6b7d'];
async function infGraficos() {
  const L = S.libro; const year = S.year;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const cur = ym(todayISO());
  const showMonths = months.filter((m) => m <= cur || L.activeRows.some((r) => ym(r.fecha) === m));
  const data = showMonths.map((m) => L.gastoMes(m));
  const cats = [...new Set(data.flatMap((d) => Object.keys(d.porCuenta)))].sort();
  const mesSel = showMonths.includes(S.mes) ? S.mes : showMonths[showMonths.length - 1] || cur;
  $('#inf').innerHTML = `${yearNav(infGraficos)}
    <div class="card"><h3>Gasto corriente por mes</h3><div class="chartbox"><canvas id="c1"></canvas></div><p class="small muted">Sin imprevistos ni amortizaciones.</p></div>
    <div class="card"><div class="row between"><h3>Reparto del mes</h3><select id="ms" style="width:auto;min-height:36px;padding:6px 10px">${showMonths.map((m) => `<option value="${m}" ${m === mesSel ? 'selected' : ''}>${esc(mesLargo(m))}</option>`).join('')}</select></div><div class="chartbox"><canvas id="c2"></canvas></div></div>
    <div class="card"><h3>Ingresos vs gastos</h3><div class="chartbox"><canvas id="c3"></canvas></div></div>
    <div class="card"><h3>Patrimonio neto</h3><div class="chartbox"><canvas id="c4"></canvas></div></div>`;
  let Chart;
  try { Chart = await loadChart(); } catch { $('#inf').insertAdjacentHTML('afterbegin', '<div class="banner warn">No se pudo cargar la librería de gráficos (¿sin conexión?).</div>'); return; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  Chart.defaults.color = dark ? '#94a096' : '#667066';
  Chart.defaults.borderColor = dark ? '#2b332e' : '#e3e7e0';
  Chart.defaults.font.family = 'system-ui, sans-serif';
  const labels = showMonths.map((m) => MESES[Number(m.slice(5)) - 1]);
  const money = { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${eur(c.parsed.y ?? c.parsed)}` } };
  S.charts?.forEach((c) => c.destroy()); S.charts = [];
  S.charts.push(new Chart($('#c1'), { type: 'bar', data: { labels, datasets: cats.map((c, i) => ({ label: L.nombre(c), data: data.map((d) => d.porCuenta[c] || 0), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 3 })) }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: money }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => `${fmt(v, 0)} €` } } } } }));
  const drawDonut = (m) => {
    const d = L.gastoMes(m, { incluirImprevistos: true }); const entries = Object.entries(d.porCuenta).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    S.charts[1]?.destroy();
    S.charts[1] = new Chart($('#c2'), { type: 'doughnut', data: { labels: entries.map(([c]) => L.nombre(c)), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${eur(c.parsed)}` } } } } });
  };
  drawDonut(mesSel);
  $('#ms').onchange = (e) => { S.mes = e.target.value; drawDonut(S.mes); };
  const p = L.pyg(year); const idx = showMonths.map((m) => Number(m.slice(5)) - 1);
  S.charts.push(new Chart($('#c3'), { type: 'bar', data: { labels, datasets: [{ label: 'Ingresos', data: idx.map((i) => p.totalIngresos[i]), backgroundColor: '#1d8a68', borderRadius: 3 }, { label: 'Gastos', data: idx.map((i) => p.totalGastos[i]), backgroundColor: '#c2553a', borderRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: money }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmt(v, 0)} €` } } } } }));
  S.charts.push(new Chart($('#c4'), { type: 'line', data: { labels, datasets: [{ label: 'Patrimonio neto', data: showMonths.map((m) => L.balance(m).patrimonioNeto), borderColor: '#3a78c2', backgroundColor: 'rgba(58,120,194,.12)', fill: true, tension: 0.25, pointRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: money }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmt(v, 0)} €` } } } } }));
}

function infSobres() {
  const L = S.libro; const m = S.mes;
  const list = L.presupuesto(m);
  const tot = list.filter((p) => L.tipo(p.code) === 'gasto').reduce((a, p) => ({ asig: a.asig + p.asignado, real: a.real + p.real }), { asig: 0, real: 0 });
  $('#inf').innerHTML = `<div class="monthnav"><button class="iconbtn" id="pm">‹</button><strong>${esc(mesLargo(m))}</strong><button class="iconbtn" id="nm">›</button></div>
    ${tot.asig ? `<div class="kpis" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><div class="kpi"><div class="lbl">Asignado a categorías</div><div class="val">${eur(tot.asig, 0)}</div></div><div class="kpi"><div class="lbl">Gastado</div><div class="val ${tot.real > tot.asig ? 'neg' : ''}">${eur(tot.real, 0)}</div></div></div>` : ''}
    <div class="card">${list.length ? sobresHtml(list) : '<div class="empty">Sin sobres este mes. Un sobre es lo que te asignas para una categoría (p. ej. Súper 150 €) o para gastar desde un banco (p. ej. Revolut Ana 200 €).</div>'}
    <button class="btn block" id="add" style="margin-top:10px">Añadir sobre</button></div>
    <p class="small muted">No cuentan imprevistos ni amortizaciones. Un sobre de banco mide lo gastado pagando desde ese banco.</p>`;
  $('#pm').onclick = () => { S.mes = addMonths(m, -1); infSobres(); };
  $('#nm').onclick = () => { S.mes = addMonths(m, 1); infSobres(); };
  $('#add').onclick = () => editSobre(null);
  bindRowItems($('#inf'));
}
function editSobre(id) {
  const L = S.libro; const p = (L.db.Presupuesto || []).find((x) => String(x.id) === String(id));
  const fields = [
    { key: 'cuenta', label: 'Categoría o banco', type: 'select', options: (v) => accountOptions((c) => c.tipo === 'gasto' || isTes(c), v), required: true },
    { key: 'importe', label: 'Importe mensual €', type: 'number', required: true },
    { key: 'ambito', label: 'Se aplica a', type: 'select', options: [['*', 'Todos los meses'], ['mes', `Solo ${mesLargo(S.mes)}`]] },
  ];
  formModal({
    title: p ? 'Editar sobre' : 'Nuevo sobre', fields, values: p ? { ...p, ambito: p.mes === '*' ? '*' : 'mes' } : { ambito: '*' },
    onSave: async (d) => {
      const row = { id: p?.id || uid(), cuenta: d.cuenta, importe: d.importe, mes: d.ambito === '*' ? '*' : (p && p.mes !== '*' ? p.mes : S.mes), borrado: '' };
      if (p) await updateRows('Presupuesto', [{ ...p, ...row }]); else await addRows('Presupuesto', [row]);
    },
    onDelete: p ? async () => updateRows('Presupuesto', [{ ...p, borrado: 1 }]) : null,
  });
}

function infCuadre() {
  const L = S.libro; const fecha = todayISO();
  const accs = L.cuentas.filter((c) => (isTes(c) || c.grupo === 'Inversiones' || c.tipo === 'pasivo') && (c.activa !== 0 || L.balanceToDate(c.codigo)));
  const lastReal = (code) => (L.db.Saldos || []).filter((s) => String(s.cuenta) === code).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  $('#inf').innerHTML = `<p class="small muted" style="margin-top:0">Escribe el saldo real que te dice cada banco hoy. Si no coincide con el libro, se te ha escapado algún movimiento: búscalo, o crea un ajuste para dejarlo cuadrado.</p>
    <div class="card"><ul class="list">${accs.map((c) => { const lib = L.balanceToDate(c.codigo, fecha); const lr = lastReal(c.codigo); return `<li style="flex-wrap:wrap"><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">Libro: ${eur(lib)}${lr ? ` · último real ${eur(num(lr.saldo))} (${esc(normDate(lr.fecha))})` : ''}</div></div>
      <input type="text" inputmode="decimal" data-real="${esc(c.codigo)}" placeholder="Saldo real" style="width:130px;min-height:38px;padding:7px 10px;text-align:right">
      <div data-diff="${esc(c.codigo)}" class="small" style="width:100%;text-align:right"></div></li>`; }).join('')}</ul></div>`;
  $$('[data-real]').forEach((inp) => {
    inp.oninput = () => {
      const code = inp.dataset.real; const box = $(`[data-diff="${code}"]`);
      if (!inp.value.trim()) { box.innerHTML = ''; return; }
      const real = num(inp.value); const lib = L.balanceToDate(code, fecha); const d = round2(real - lib);
      box.innerHTML = Math.abs(d) < 0.01 ? '<span class="pos">✓ Cuadra</span>' : `<span class="${d < 0 ? 'neg' : 'pos'}">Diferencia ${d > 0 ? '+' : ''}${eur(d)}</span> <button class="btn sm" data-adj="${esc(code)}">Ajustar</button> <button class="btn sm" data-save="${esc(code)}">Solo guardar</button>`;
      $(`[data-adj="${code}"]`, box)?.addEventListener('click', () => ajustar(code, real, d));
      $(`[data-save="${code}"]`, box)?.addEventListener('click', async () => { try { await addRows('Saldos', [{ id: uid(), fecha, cuenta: code, saldo: real, notas: '' }]); toast('Saldo guardado'); infCuadre(); } catch (e) { fail(e); } });
    };
  });
}
async function ajustar(code, real, d) {
  const L = S.libro; const inv = L.byCode[code]?.grupo === 'Inversiones'; const pasivo = L.tipo(code) === 'pasivo';
  // d>0: hay más dinero real que en el libro
  let debe; let haber;
  if (pasivo) { [debe, haber] = d > 0 ? ['659', code] : [code, '759']; } else if (inv) { [debe, haber] = d > 0 ? [code, '763'] : ['663', code]; } else { [debe, haber] = d > 0 ? [code, '759'] : ['659', code]; }
  const msg = inv ? `Registrar ${d > 0 ? 'ganancia' : 'pérdida'} de valor de ${eur(Math.abs(d))} en ${L.nombre(code)}?` : `Crear un ajuste de ${eur(Math.abs(d))} en ${L.nombre(code)}? Mejor si antes buscas el movimiento que falta.`;
  if (!confirm(msg)) return;
  try {
    await S.store.add('Diario', [newEntry({ fecha: todayISO(), concepto: inv ? `Revalorización ${L.nombre(code)}` : `Ajuste de cuadre ${L.nombre(code)}`, debe, haber, importe: Math.abs(d), clase: 'ajuste' })]);
    await S.store.add('Saldos', [{ id: uid(), fecha: todayISO(), cuenta: code, saldo: real, notas: 'ajustado' }]);
    await reload(); toast('Ajuste creado'); infCuadre();
  } catch (e) { fail(e); }
}

// ---------------- AJUSTES ----------------
function viewAjustes() {
  const L = S.libro; const url = S.store.sheetUrl();
  const rec = (L.db.Recurrentes || []).filter((r) => r.nombre);
  const act = (L.db.Activos || []).filter((a) => a.nombre);
  const pre = (L.db.Prestamos || []).filter((p) => p.nombre);
  const groups = {}; L.cuentas.forEach((c) => (groups[c.grupo || 'Otras'] ??= []).push(c));
  view().innerHTML = `
    <h2 style="margin-top:4px">Automatizaciones mensuales</h2>
    <div class="card"><ul class="list">${rec.map((r) => `<li class="tap" data-rec="${esc(r.id)}"><div class="grow"><div class="t">${esc(r.nombre)}</div><div class="s">Día ${esc(r.dia)} · ${esc(L.nombre(String(r.haber)))} → ${esc(L.nombre(String(r.debe)))} · desde ${esc(r.desde)}${r.hasta ? ` hasta ${esc(r.hasta)}` : ''}</div></div><div class="amount">${eur(num(r.importe))}</div><span class="chip">${truthy(r.activo) ? 'activa' : 'pausada'}</span></li>`).join('') || '<li class="muted">Ninguna</li>'}</ul>
      <button class="btn block" id="addrec" style="margin-top:8px">Añadir automatización</button>
      <p class="small muted">Cada mes, al abrir la app, se apuntan solas las que toquen. Si borras una generada, no se vuelve a crear.</p></div>

    <h2>Activos que se amortizan</h2>
    <div class="card"><ul class="list">${act.map((a) => { const am = L.activeRows.filter((r) => r.origen?.startsWith(`amort:${a.id}:`)).reduce((s, r) => s + r.importe, 0); return `<li class="tap" data-act="${esc(a.id)}"><div class="grow"><div class="t">${esc(a.nombre)}</div><div class="s">${eur(num(a.valor))} · ${Math.round(num(a.vida_meses) / 12 * 10) / 10} años · amortizado ${eur(am)}</div><div class="bar"><span style="width:${Math.min(100, am / Math.max(1, num(a.valor) - num(a.residual)) * 100)}%"></span></div></div></li>`; }).join('') || '<li class="muted">Ninguno. Se crean al apuntar una «Compra de activo» con «Amortizar» marcado.</li>'}</ul>
      <button class="btn block" id="addact" style="margin-top:8px">Añadir activo</button></div>

    <h2>Hipoteca y préstamos</h2>
    <div class="card"><ul class="list">${pre.map((p) => { const cq = cuadroPrestamo(p); const hoy = todayISO(); const next = cq.find((q) => q.fecha > hoy); const pend = [...cq].reverse().find((q) => q.fecha <= hoy)?.pendiente ?? num(p.capital); return `<li class="tap" data-pre="${esc(p.id)}"><div class="grow"><div class="t">${esc(p.nombre)}</div><div class="s">Cuota ${eur(cq[0]?.cuota || 0)} · ${esc(p.interes_anual)} % · pendiente ${eur(pend)}${next ? ` · próxima ${esc(next.fecha)}` : ''}</div></div></li>`; }).join('') || '<li class="muted">Ninguno</li>'}</ul>
      <button class="btn block" id="addpre" style="margin-top:8px">Añadir hipoteca o préstamo</button>
      <p class="small muted">Cada cuota se apunta sola separando intereses (gasto 662) y capital (baja la deuda 170).</p></div>

    <h2>Plan de cuentas</h2>
    <details class="card"><summary>${L.cuentas.length} cuentas · tocar para ver y editar</summary>${Object.entries(groups).map(([g, list]) => `<h3>${esc(g)}</h3><ul class="list">${list.map((c) => `<li class="tap" data-acc="${esc(c.codigo)}"><div class="grow"><div class="t">${esc(c.nombre)}${c.activa === 0 || c.activa === '0' ? ' <span class="chip">oculta</span>' : ''}</div><div class="s">${esc(c.codigo)} · ${esc(c.tipo)}</div></div></li>`).join('')}</ul>`).join('')}
      <button class="btn block" id="addacc" style="margin-top:8px">Añadir cuenta</button></details>

    <h2>Saldos iniciales</h2>
    <div class="card"><p class="small muted" style="margin-top:0">El asiento de apertura: lo que tienes en cada cuenta (y lo que debes) el día que empiezas. Va contra «100 Patrimonio inicial».</p><button class="btn block" id="apertura">Introducir saldos iniciales</button></div>

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
  $('#addacc').onclick = () => editCuenta(null);
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
function editCuenta(code) {
  const L = S.libro; const c = L.cuentas.find((x) => x.codigo === code);
  const grupos = [...new Set(L.cuentas.map((x) => x.grupo).filter(Boolean))];
  const fields = [
    ...(c ? [] : [{ key: 'codigo', label: 'Código', required: true, hint: '6xx gastos · 7xx ingresos · 572x bancos · 2xx inmovilizado · 17x deudas' }]),
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'tipo', label: 'Tipo', type: 'select', options: [['activo', 'Activo (lo que tienes)'], ['pasivo', 'Pasivo (lo que debes)'], ['patrimonio', 'Patrimonio neto'], ['ingreso', 'Ingreso'], ['gasto', 'Gasto']], required: true },
    { key: 'grupo', label: 'Grupo', type: 'text', hint: `Existentes: ${grupos.join(', ')}` },
    { key: 'orden', label: 'Orden', type: 'number' },
    { key: 'activa', label: 'Visible en los formularios', type: 'checkbox' },
  ];
  formModal({
    title: c ? `Cuenta ${c.codigo}` : 'Nueva cuenta', fields, values: c || { activa: 1, orden: L.cuentas.length + 1 },
    onSave: async (d) => {
      if (c) { await updateRows('Cuentas', [{ ...c, ...d, _row: c._row }]); return; }
      if (L.byCode[d.codigo]) throw new Error('Ya existe una cuenta con ese código');
      await addRows('Cuentas', [{ ...d, codigo: String(d.codigo) }]);
    },
  });
}

function apertura() {
  const L = S.libro;
  const accs = L.cuentas.filter((c) => (c.tipo === 'activo' || c.tipo === 'pasivo') && c.codigo !== '281' && c.activa !== 0);
  openModal(`<h2>Saldos iniciales</h2><form novalidate>
    <div class="field"><label class="lbl">Fecha de apertura</label><input type="date" name="fecha" value="${todayISO().slice(0, 4)}-01-01"></div>
    <p class="hint" style="margin-top:-4px">Deja en blanco las cuentas sin saldo. Para la hipoteca, pon lo que queda por pagar.</p>
    ${accs.map((c) => `<div class="row" style="margin-bottom:8px"><label class="grow small" for="ap_${c.codigo}">${esc(c.nombre)} <span class="muted">· ${esc(c.codigo)}${c.tipo === 'pasivo' ? ' · deuda' : ''}</span></label><input id="ap_${c.codigo}" name="${c.codigo}" type="text" inputmode="decimal" style="width:140px;text-align:right" placeholder="0,00"></div>`).join('')}
    <div class="actions"><button type="button" class="btn" data-cancel>Cancelar</button><button class="btn primary" type="submit">Crear asiento de apertura</button></div></form>`, (m) => {
    $('[data-cancel]', m).onclick = closeModal;
    $('form', m).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const fecha = f.fecha.value || todayISO(); const asiento = uid();
      const rows = [];
      for (const c of accs) {
        const v = round2(num(f.elements[c.codigo].value)); if (!v) continue;
        const [debe, haber] = c.tipo === 'pasivo' ? (v > 0 ? ['100', c.codigo] : [c.codigo, '100']) : (v > 0 ? [c.codigo, '100'] : ['100', c.codigo]);
        rows.push(newEntry({ asiento, fecha, concepto: `Saldo inicial ${c.nombre}`, debe, haber, importe: Math.abs(v), clase: 'apertura', origen: 'apertura' }));
      }
      if (!rows.length) { toast('No has puesto ningún saldo'); return; }
      try { await addRows('Diario', rows); closeModal(); toast(`Apertura creada (${rows.length} cuentas)`); render(); } catch (err) { fail(err); }
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
