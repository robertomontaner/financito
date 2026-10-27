import { CONFIG } from './config.js';
import { auth, AuthError, SheetsStore, LocalStore } from './store.js';
import {
  Libro, TABLES, CLASES, uid, round2, num, truthy, todayISO, ym, addMonths, eur, fmt, MESES, mesLargo, normDate, cuadroPrestamo, participacion, pad, kindOf, KIND_LABEL, displayGroup, nextCode, lastDay, monthsBetween,
} from './model.js';

// ---------------- estado y utilidades de UI ----------------
const S = { store: null, libro: null, loading: false, mes: ym(todayISO()), year: Number(todayISO().slice(0, 4)), informe: 'libro', periodo: 'mes', apuntar: 'gasto', diario: { q: '', mes: '', cuenta: '', n: 80 } };
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

// ---------------- selector de cuentas amigable ----------------
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const EMOJI_RULES = [
  [/s[uú]per|mercadona|lidl|casa|hogar/i, '🛒'], [/coche|transporte|gasolina|veh[ií]culo/i, '🚗'], [/salud|cuidado|fisio|farmacia/i, '💊'],
  [/ocio|social|cena|bar/i, '🎉'], [/compras|proyecto/i, '🛍️'], [/viaje/i, '✈️'], [/mam[aá]|familia/i, '👪'], [/seguro/i, '🛡️'],
  [/suscrip/i, '📺'], [/gimnasio|gym/i, '🏋️'], [/n[oó]mina|trabajo/i, '💼'], [/comisi/i, '🤝'], [/amazon|cheque|regalo/i, '🎁'],
  [/piso|vivienda/i, '🏠'], [/mobiliario|mueble/i, '🛋️'], [/equipo|inform/i, '💻'], [/hipoteca|pr[eé]stamo/i, '🏛️'],
  [/inter[eé]s/i, '％'], [/amortiz/i, '⏳'], [/patrimonio|hist[oó]rico/i, '⚖️'], [/descuadre/i, '🧮'], [/inversi|ganancia|p[eé]rdida/i, '📈'],
];
const KIND_EMOJI = { dinero: '🏦', bien: '📦', deuda: '📉', gasto: '🧾', ingreso: '💶', contable: '⚙️' };
function emojiFor(c) {
  if (!c) return '•';
  const k = kindOf(c);
  if (k === 'dinero') return /efectivo/i.test(c.nombre) ? '💵' : /trade|inversi|fondo|broker/i.test(c.nombre) || c.grupo === 'Inversiones' ? '📈' : /extraordinario/i.test(c.nombre) ? '🧰' : '🏦';
  for (const [re, e] of EMOJI_RULES) if (re.test(c.nombre)) return e;
  return KIND_EMOJI[k];
}
const PICKERS = {}; let pickerSeq = 0;
function pickerFace(code, ph = 'Elegir…') {
  const c = S.libro.byCode[String(code)];
  if (!c) return `<span class="pk-ic">＋</span><span class="pk-txt"><span class="pk-ph">${esc(ph)}</span></span><span class="pk-caret">›</span>`;
  return `<span class="pk-ic">${emojiFor(c)}</span><span class="pk-txt"><span class="pk-name">${esc(c.nombre)}</span><span class="pk-sub">${esc(displayGroup(c))}${S.verCodigos ? ` · ${esc(c.codigo)}` : ''}</span></span><span class="pk-caret">›</span>`;
}
// filter(c, root) puede depender de lo que haya en el formulario
function pickerField(name, label, filter, selected = '', opts = {}) {
  const id = `pk${++pickerSeq}`; PICKERS[id] = { filter, label, ...opts };
  return `<div class="field"><label class="lbl">${esc(label)}</label><input type="hidden" name="${name}" value="${esc(selected || '')}" data-pk-input="${id}">
    <button type="button" class="picker" data-pk="${id}" aria-label="${esc(label)}">${pickerFace(selected, opts.placeholder)}</button>${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}</div>`;
}
function setPicker(root, name, code) {
  const input = $(`input[type=hidden][name="${name}"]`, root); if (!input) return;
  input.value = code; const btn = $(`[data-pk="${input.dataset.pkInput}"]`, root); if (btn) btn.innerHTML = pickerFace(code);
}
function bindPickers(root) {
  $$('[data-pk]', root).forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.pk; const cfg = PICKERS[id]; const input = $(`[data-pk-input="${id}"]`, root);
      openPicker({
        title: cfg.title || cfg.label, selected: input.value, createKind: cfg.createKind,
        filter: (c) => cfg.filter(c, root),
        onPick: (code) => { input.value = code; btn.innerHTML = pickerFace(code); input.dispatchEvent(new Event('change', { bubbles: true })); },
      });
    };
  });
}
function openPicker({ title, filter, selected, onPick, createKind }) {
  const L = S.libro; const root = $('#picker-root');
  const all = L.cuentas.filter((c) => filter(c) && (!(c.activa === 0 || c.activa === '0') || c.codigo === String(selected)));
  const freq = {}; L.activeRows.slice(-300).forEach((r) => { freq[r.debe] = (freq[r.debe] || 0) + 1; freq[r.haber] = (freq[r.haber] || 0) + 1; });
  const recents = all.length > 7 ? all.filter((c) => freq[c.codigo]).sort((a, b) => freq[b.codigo] - freq[a.codigo]).slice(0, 4) : [];
  const ORDER = ['dinero', 'gasto', 'ingreso', 'bien', 'deuda', 'contable'];
  const item = (c) => {
    const sub = [displayGroup(c), kindOf(c) === 'dinero' && L.inicio ? eur(L.balanceToDate(c.codigo)) : '', S.verCodigos ? c.codigo : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="pk-item ${c.codigo === String(selected) ? 'on' : ''}" data-code="${esc(c.codigo)}"><span class="pk-ic">${emojiFor(c)}</span><span class="pk-txt"><span class="pk-name">${esc(c.nombre)}</span><span class="pk-sub">${esc(sub)}</span></span>${c.codigo === String(selected) ? '<span class="pk-check">✓</span>' : ''}</button>`;
  };
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = `<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="row between"><h2 style="margin:0">${esc(title)}</h2><button type="button" class="iconbtn" data-x aria-label="Cerrar">✕</button></div>
    ${all.length > 7 ? '<input type="search" class="pk-search" placeholder="Buscar…" autocomplete="off">' : ''}
    <div class="pk-list"></div></div></div>`;
  const back = $('.sheet-back', root); const listEl = $('.pk-list', root); const search = $('.pk-search', root);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('[data-x]', root).onclick = close;
  const draw = () => {
    const q = norm(search?.value);
    const showRecents = !q && recents.length;
    const found = all.filter((c) => (!q || norm(`${c.nombre} ${displayGroup(c)} ${c.codigo}`).includes(q)) && !(showRecents && recents.includes(c)));
    const groups = {}; found.forEach((c) => (groups[kindOf(c)] ??= []).push(c));
    let html = '';
    if (showRecents) html += `<h3>Más usadas</h3><div class="pk-grid">${recents.map(item).join('')}</div>`;
    for (const k of ORDER) if (groups[k]) html += `${Object.keys(groups).length > 1 || showRecents ? `<h3>${esc(KIND_LABEL[k])}</h3>` : ''}<div class="pk-grid">${groups[k].map(item).join('')}</div>`;
    if (!found.length && !showRecents) html += `<div class="empty">Nada con «${esc(search?.value || '')}».</div>`;
    if (createKind && q && !all.some((c) => norm(c.nombre) === q)) html += `<button type="button" class="pk-item pk-new" data-create><span class="pk-ic">＋</span><span class="pk-txt"><span class="pk-name">Crear «${esc(search.value.trim())}»</span><span class="pk-sub">${esc((KIND_DEF[createKind]?.titulo || '').replace(/^Nuev[oa] /, ''))}</span></span></button>`;
    listEl.innerHTML = html;
    $$('[data-code]', listEl).forEach((b) => { b.onclick = () => { close(); onPick(b.dataset.code); }; });
    $('[data-create]', listEl)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const def = KIND_DEF[createKind]; const codigo = nextCode(L.cuentas, createKind); const nombre = search.value.trim().replace(/^./, (x) => x.toUpperCase());
        await S.store.add('Cuentas', [{ codigo, nombre, tipo: def.tipo, grupo: def.grupo, orden: L.cuentas.length + 1, activa: 1 }]);
        await reload(); close(); onPick(codigo); toast(`Creada: ${nombre}`);
      } catch (err) { btn.disabled = false; fail(err); }
    });
  };
  draw();
  if (search) { search.oninput = draw; if (matchMedia('(pointer:fine)').matches) search.focus(); }
  $('.pk-item.on', listEl)?.scrollIntoView({ block: 'center' });
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
  if (f.type === 'account') return pickerField(f.key, f.label, f.filter, val, { createKind: f.createKind, hint: f.hint });
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
    bindPickers(m);
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
    if (S.store.kind !== 'demo') keepSession();
    if (!location.hash || location.hash === '#') location.hash = '#/inicio'; else render();
  } catch (e) { fail(e); }
}

// ---- sesión recordada ----
// Google da tokens de 1 hora. Mientras tu cuenta de Google siga abierta en el navegador,
// Financito pide uno nuevo sin preguntarte (prompt=none): un parpadeo de un segundo y sigues en la misma pantalla.
function keepSession() {
  // recuerda con qué cuenta entras, para que la renovación silenciosa no dude entre varias cuentas de Google
  if (!LS.get('login_hint')) S.store.api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)').then((r) => r?.user?.emailAddress && LS.set('login_hint', r.user.emailAddress)).catch(() => {});
  const busy = () => $('#modal-root')?.children.length || $('#picker-root')?.children.length || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || location.hash.startsWith('#/apuntar');
  const check = () => {
    if (LS.get('mode') !== 'google') return;
    const left = auth.expiresIn();
    // renueva al volver a la app con el token caducado, o justo antes de caducar si no estás escribiendo nada
    if (left < 5 * 60e3 && !busy()) auth.login('none');
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(() => { if (!document.hidden) check(); }, 60e3);
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
  openModal(`<h2>Sesión caducada</h2><p class="muted">Google renueva el acceso cada hora por seguridad. Pulsa para renovarlo (normalmente no te pide nada) y vuelves a esta misma pantalla. Lo ya guardado no se pierde.</p>
    <div class="actions"><button class="btn primary" id="re">Volver a entrar</button></div>`, (m) => {
    $('#re', m).onclick = () => auth.login('none');
  });
}

// ---------------- router ----------------
const ROUTES = { inicio: viewInicio, mes: viewMes, apuntar: viewApuntar, diario: viewDiario, informes: viewInformes, ajustes: viewAjustes, graficos: viewGraficos, inversiones: viewInversiones };
function render() {
  if (!S.libro) return;
  const r = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'inicio';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r));
  $('#title').textContent = { inicio: 'Financito', mes: 'Mes', apuntar: 'Apuntar', diario: 'Movimientos', informes: 'Informes', ajustes: 'Ajustes', graficos: 'Gráficos', inversiones: 'Inversiones' }[r] || 'Financito';
  $('#topbar-actions').innerHTML = `${S.store.kind === 'demo' ? '<span class="chip">demo</span>' : ''}<a href="#/inversiones" class="iconbtn ${r === 'inversiones' ? 'on' : ''}" aria-label="Inversiones" title="Inversiones"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></a><a href="#/graficos" class="iconbtn ${r === 'graficos' ? 'on' : ''}" aria-label="Gráficos" title="Gráficos"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></a><a href="#/ajustes" class="iconbtn ${r === 'ajustes' ? 'on' : ''}" aria-label="Ajustes">⚙</a>`;
  view().classList.toggle('wide', ['graficos', 'informes', 'inversiones'].includes(r));
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
  const sob = L.presupuesto(mes).filter((p) => L.kind(p.code) === 'gasto');
  const last = [...L.activeRows].sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado)).slice(0, 6);
  const diff = g.total - gp.total;
  const top = Object.entries(g.porCuenta).sort((a, b) => b[1] - a[1]).slice(0, 6);

  view().innerHTML = `
    ${S.autoMsg ? `<div class="banner">⚙ ${esc(S.autoMsg)}</div>` : ''}
    ${S.store.kind === 'demo' ? '<div class="banner warn">Estás en modo demo: los datos son de ejemplo y solo se guardan en este navegador.</div>' : ''}
    <h1 style="text-transform:capitalize">${esc(mesLargo(mes))}</h1>
    ${(() => { const P = L.planMes(mes); if (!P.hasPlan && L.fuentePlan(mes)) return `<a class="banner" href="#/mes" style="display:block;text-decoration:none">📝 Prepara el plan de ${esc(MESES_LARGOS_MES(mes))}: copia el del mes anterior y ajústalo →</a>`; return P.pendientes.length ? `<a class="banner" href="#/mes" style="display:block;text-decoration:none">📬 Reparto de ${esc(MESES_LARGOS_MES(mes))} pendiente: ${P.pendientes.length} traspaso${P.pendientes.length > 1 ? 's' : ''} por ${eur(P.pendientes.reduce((s2, l) => s2 + l.plan, 0), 0)} →</a>` : ''; })()}
    <div class="kpis">
      <div class="kpi"><div class="lbl">Gasto corriente del mes</div><div class="val">${eur(g.total)}</div><div class="sub">${gp.total ? `${diff >= 0 ? '+' : ''}${eur(diff, 0)} vs ${MESES[Number(prev.slice(5)) - 1].toLowerCase()} (${eur(gp.total, 0)})` : 'sin imprevistos ni amortizaciones'}</div></div>
      <div class="kpi"><div class="lbl">Ingresos del mes</div><div class="val">${eur(ingresos, 0)}</div><div class="sub">Resultado: <span class="${cls(ingresos - g.total)}">${eur(round2(L.pyg(mes.slice(0, 4)).resultado[Number(mes.slice(5)) - 1]), 0)}</span></div></div>
      <div class="kpi"><div class="lbl">Patrimonio neto</div><div class="val">${L.inicio ? eur(bal.patrimonioNeto, 0) : '—'}</div><div class="sub">${L.inicio ? 'lo que tienes − lo que debes' : 'falta meter saldos iniciales'}</div></div>
    </div>

    ${sob.length ? `<h2>Límites de ${esc(MESES[Number(mes.slice(5)) - 1].toLowerCase())}</h2><div class="card">${sobresHtml(sob.slice(0, 6))}<div style="margin-top:8px"><a href="#/mes" class="small">Ver el mes completo →</a></div></div>` : ''}

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
  const sel = (name, label, filter, def, createKind) => pickerField(name, label, filter, def, { createKind });
  const notas = '<details style="margin-bottom:12px"><summary class="small muted">Notas</summary><textarea name="notas" style="margin-top:8px"></textarea></details>';

  if (t === 'gasto') {
    const gastosCorr = L.cuentas.filter((c) => c.grupo === 'Gastos variables' && c.activa !== 0);
    if (!gastosCorr.length) gastosCorr.push(...L.cuentas.filter((c) => c.tipo === 'gasto' && c.activa !== 0).slice(0, 6));
    const defCat = last('debe', gastosCorr[0]?.codigo || '');
    body = `${importe}${concepto('Lidl, gasolina, cena…')}
      <div class="quick" id="quick" style="margin-top:0">${gastosCorr.map((c) => `<button type="button" data-v="${esc(c.codigo)}" class="${c.codigo === defCat ? 'on' : ''}">${esc(c.nombre)}</button>`).join('')}</div>
      ${sel('debe', 'Categoría', isGasto, defCat, 'gasto')}
      ${sel('haber', 'Pagado con', isMoney, last('haber', firstTes))}
      <div class="two">${fecha}<div class="field"><label class="lbl">&nbsp;</label><label class="check"><input type="checkbox" name="imprevisto"> Imprevisto</label></div></div>${notas}`;
  } else if (t === 'ingreso') {
    body = `${importe}${concepto('Nómina, comisión, venta…')}
      ${sel('haber', 'Tipo de ingreso', isIngreso, last('haber', L.accountsOf('ingreso')[0]?.codigo), 'ingreso')}
      ${sel('debe', 'Cobrado en', isMoney, last('debe', firstTes))}${fecha}${notas}`;
  } else if (t === 'traspaso') {
    const pay = isPayer;
    body = `${importe}${concepto('Reparto, ahorro, aportación…')}
      ${sel('haber', 'Desde', pay, last('haber', firstTes))}
      ${sel('debe', 'Hacia', pay, last('debe', L.cuentas.find((c) => c.codigo === '540')?.codigo || firstTes))}${fecha}${notas}`;
  } else if (t === 'activo') {
    const act = (c) => kindOf(c) === 'bien';
    body = `${importe}${concepto('Patinete, impresora, entrada piso…')}
      ${sel('debe', 'Tipo de bien', act, last('debe', '218'), 'bien')}
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
  bindPickers(form);
  $$('#quick button').forEach((b) => { b.onclick = () => { $$('#quick button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); setPicker(form, 'debe', b.dataset.v); }; });
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
    { key: 'haber', label: 'Sale de', type: 'account', filter: all, required: true },
    { key: 'debe', label: 'Va a', type: 'account', filter: all, required: true },
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

// ---------------- MES (plan y reparto, criterio de caja) ----------------
// Cada mes tiene su propio plan. Un mes nuevo se empieza copiando el anterior; los cambios solo afectan a ese mes.
const GRUPO_REP = { sobre: ['Sobres para gastar', 'Dinero que mandas a una cuenta para gastar desde ella.'], fondo: ['Imprevistos', 'Lo que apartas para lo que no se puede prever.'], ahorro: ['Ahorro e inversión', 'Lo que mandas a largo plazo.'] };
const MESES_LARGOS_MES = (m) => mesLargo(m).split(' ')[0];

function viewMes() {
  const L = S.libro; const m = S.mes; const P = L.planMes(m);
  const principal = L.principal; const nPrin = principal ? L.nombre(principal) : 'tu cuenta principal';
  const money = (v) => `<span class="amount">${eur(v, Math.abs(v) % 1 ? 2 : 0)}</span>`;
  const tick = (ok, plan) => (ok ? '<span class="chip ok">✓ hecho</span>' : plan > 0 ? '<span class="chip">pendiente</span>' : '');

  if (!P.hasPlan) {
    const src = L.fuentePlan(m);
    view().innerHTML = `${periodBar(viewMes, { allowYear: false })}
      <div class="card"><h2 style="margin-top:0">Plan de ${esc(mesLargo(m))}</h2>
        <p class="muted">Aquí decides qué ingresos esperas este mes y a qué cuentas mandas el dinero. Cada mes tiene su propio plan.</p>
        <div class="stack">
          ${src ? `<button class="btn primary block" id="copy">${src.mes ? `Copiar el plan de ${esc(mesLargo(src.mes))}` : 'Copiar mi reparto anterior'}</button>
            ${(() => { const nl = new Set(src.rows.lines.map((l) => l.code)).size; const ni = new Set(src.rows.ingresos.filter((i) => !i.extra).map((i) => i.code)).size; const rep = src.rows.lines.length - nl; return `<p class="small muted" style="margin:0">${nl} cuenta${nl === 1 ? '' : 's'} de reparto${ni ? ` y ${ni} fuente${ni === 1 ? '' : 's'} de ingreso` : ''}${rep ? ` (había ${rep} repetidas: se quedan una vez)` : ''}. Luego lo cambias a tu gusto.</p>`; })()}` : ''}
          <button class="btn block ${src ? '' : 'primary'}" id="blank">Empezar en blanco</button>
        </div></div>
      ${P.fijos.length || P.ingresosReal ? `<p class="small muted">Este mes ya hay ${eur(P.ingresosReal, 0)} de ingresos y ${P.fijos.length} gasto${P.fijos.length === 1 ? '' : 's'} fijo${P.fijos.length === 1 ? '' : 's'} automático${P.fijos.length === 1 ? '' : 's'}.</p>` : ''}`;
    $('#copy')?.addEventListener('click', (e) => copiarPlan(m, src, e.currentTarget));
    $('#blank').onclick = async (e) => { e.currentTarget.disabled = true; try { await S.store.add('RepartoMes', [{ id: uid(), mes: m, linea: 'inicio', hacia: '', importe: 0, borrado: '' }]); await reload(); viewMes(); } catch (err) { fail(err); } };
    return;
  }

  const ingHtml = P.ingresos.length ? `<ul class="list">${P.ingresos.map((i) => `<li class="${i.extra ? '' : 'tap'}" ${i.extra ? '' : `data-ing="${esc(i.linea)}"`}><span class="pk-ic">${emojiFor(L.byCode[i.code])}</span><div class="grow"><div class="t">${esc(i.nombre)}${i.extra ? ' <span class="chip">fuera del plan</span>' : ''}</div><div class="s">${i.extra ? '' : `previsto ${eur(i.plan, 0)} · `}entrado ${eur(i.real)}</div>${i.plan ? `<div class="bar"><span style="width:${Math.min(100, (i.real / i.plan) * 100)}%"></span></div>` : ''}</div>${money(i.plan || i.real)}</li>`).join('')}</ul>` : '<div class="empty">Añade tus fuentes de ingreso previstas (nómina, cuenta propia…).</div>';
  const linesHtml = ['sobre', 'fondo', 'ahorro'].map((g) => {
    const list = P.lines.filter((l) => l.grupo === g); if (!list.length) return '';
    return `<h3>${GRUPO_REP[g][0]}</h3><ul class="list">${list.map((l) => {
      let sub = '';
      if (g === 'sobre') { const q = round2((l.done ? l.real : l.plan) - l.gastado); sub = `gastado ${eur(l.gastado)} · <span class="${q < 0 ? 'neg' : ''}">${q < 0 ? `te pasas ${eur(-q)}` : `quedan ${eur(q)}`}</span>`; }
      if (g !== 'sobre' && L.inicio) sub = `saldo: ${eur(L.balanceToDate(l.code))}`;
      return `<li class="tap" data-line="${esc(l.linea)}"><span class="pk-ic">${emojiFor(L.byCode[l.code])}</span><div class="grow"><div class="t">${esc(l.nombre)} ${tick(l.done, l.plan)}</div><div class="s">${sub}</div></div>${money(l.done ? l.real : l.plan)}</li>`;
    }).join('')}</ul>`;
  }).join('');
  const fijosHtml = P.fijos.length ? `<ul class="list">${P.fijos.map((f) => `<li class="tap" ${f.prestamo ? `data-pre="${esc(f.prestamo.id)}"` : `data-fijo="${esc(f.id)}"`}><span class="pk-ic">${emojiFor(L.byCode[f.code])}</span><div class="grow"><div class="t">${esc(f.nombre)} ${f.activo ? tick(f.real > 0, f.plan) : '<span class="chip">pausada</span>'}${f.override !== null && !f.gen ? `<span class="chip">${f.override ? 'importe especial' : 'saltado'}</span>` : ''}</div><div class="s">${f.activo ? `día ${esc(f.dia || f.rec?.dia)} · se apunta solo` : 'tócala para activarla'}</div></div>${money(f.real || f.plan || num(f.rec?.importe))}</li>`).join('')}</ul>` : '<div class="empty">Sin gastos fijos. Se crean como automatizaciones.</div>';
  const limites = L.presupuesto(m).filter((p) => L.kind(p.code) === 'gasto');
  const doneAll = P.lines.length && !P.pendientes.length;
  const pendTotal = round2(P.pendientes.reduce((s2, l) => s2 + l.plan, 0));

  view().innerHTML = `${periodBar(viewMes, { allowYear: false })}
    ${P.dupes ? `<div class="banner warn">Hay ${P.dupes} línea${P.dupes > 1 ? 's' : ''} repetida${P.dupes > 1 ? 's' : ''} en este mes. <button class="btn sm" id="dedupe" style="margin-left:6px">Juntarlas</button></div>` : ''}
    <div class="card"><div class="row between"><h3 style="margin:0">Ingresos</h3><span class="num"><strong>${eur(P.ingresosReal, 0)}</strong> <span class="muted small">de ${eur(P.ingresosPlan, 0)}</span></span></div>
      ${ingHtml}<button class="btn sm" id="addIng" style="margin-top:8px">+ Fuente de ingreso</button></div>

    <div class="card"><div class="row between"><h3 style="margin:0">Gastos fijos</h3><span class="num"><strong>${eur(P.fijosPlan, 0)}</strong></span></div>${fijosHtml}
      <button class="btn sm" id="addFijo" style="margin-top:8px">+ Gasto fijo</button></div>

    <div class="card"><div class="row between"><h3 style="margin:0">Reparto a cuentas</h3><span class="num"><strong>${eur(P.repartoPlan, 0)}</strong></span></div>
      ${linesHtml || '<div class="empty">Sin líneas de reparto.</div>'}
      <button class="btn sm" id="addLine" style="margin-top:8px">+ Añadir cuenta al reparto</button></div>

    <div class="card">
      <div class="row between"><div><h3 style="margin:0">Se queda en ${esc(nPrin)}</h3><div class="small muted">lo que sobra tras fijos y reparto</div></div><button class="iconbtn" id="cfgMes" aria-label="Cambiar cuenta principal">⚙</button></div>
      <div class="two" style="margin-top:8px">
        <div><div class="small muted">Previsto</div><div class="kpiv ${cls(P.sobrantePlan)}">${eur(P.sobrantePlan, 0)}</div>
          <div class="calc">${eur(P.ingresosPlan, 0)} ingresos previstos<br>− ${eur(P.fijosPlan, 0)} fijos previstos<br>− ${eur(P.repartoPlan, 0)} reparto previsto</div></div>
        <div><div class="small muted">Con lo real</div><div class="kpiv ${cls(P.sobranteReal)}">${eur(P.sobranteReal, 0)}</div>
          <div class="calc">${eur(P.ingresosReal, 0)} ingresos entrados<br>− ${eur(P.fijosReal, 0)} fijos ya apuntados<br>− ${eur(P.repartoReal, 0)} traspasos ya hechos</div></div></div>
      ${P.sobrantePlan < 0 ? `<p class="small neg" style="margin:8px 0 0">Tu plan reparte ${eur(-P.sobrantePlan, 0)} más de lo que esperas cobrar.</p>` : ''}
      ${L.inicio && principal ? `<div class="small muted" style="margin-top:6px">Saldo actual de ${esc(nPrin)}: <strong>${eur(L.balanceToDate(principal))}</strong></div>` : ''}
    </div>

    ${P.lines.length ? (doneAll
    ? `<div class="banner">✓ Reparto de ${esc(mesLargo(m))} hecho. <button class="btn sm" id="undo" style="margin-left:6px">Deshacer</button></div>`
    : `<button class="btn primary block" id="doRep" style="margin:12px 0">Hacer reparto de ${esc(MESES_LARGOS_MES(m))} · ${P.pendientes.length} traspaso${P.pendientes.length > 1 ? 's' : ''} · ${eur(pendTotal, 0)}</button>`) : ''}

    <details class="card"${limites.length ? ' open' : ''}><summary>Límites por categoría${limites.length ? ` (${limites.length})` : ''}</summary>
      <p class="small muted">Cuánto quieres gastar como máximo en cada cosa, la pagues desde donde la pagues.</p>
      ${limites.length ? sobresHtml(limites) : ''}
      <button class="btn sm" id="addcat" style="margin-top:8px">+ Límite de categoría</button></details>
    ${L.inicio ? `<a class="card row between" href="#/informes" id="gocierre" style="text-decoration:none;color:inherit;margin-top:12px"><div><strong>Cierre de saldos</strong><div class="small muted">Pon lo que dice cada banco y corrige los descuadres</div></div><span class="pk-caret">›</span></a>` : ''}
    <p class="small muted">Los cambios solo afectan a ${esc(mesLargo(m))}. El mes que viene empezarás copiando este plan.</p>`;

  $('#dedupe')?.addEventListener('click', () => juntarRepetidas(m));
  $('#gocierre')?.addEventListener('click', () => { S.informe = 'cuadre'; });
  $('#addIng').onclick = () => editLinea(null, 'ingreso');
  $('#addLine').onclick = () => editLinea(null, 'reparto');
  $('#addFijo').onclick = () => editRecurrente(null);
  $('#cfgMes').onclick = cfgMes;
  $('#doRep')?.addEventListener('click', hacerReparto);
  $('#undo')?.addEventListener('click', deshacerReparto);
  $('#addcat').onclick = () => editSobre(null, 'gasto');
  $$('[data-line]').forEach((li) => { li.onclick = () => editLinea(li.dataset.line, 'reparto'); });
  $$('[data-ing]').forEach((li) => { li.onclick = () => editLinea(li.dataset.ing, 'ingreso'); });
  $$('[data-fijo]').forEach((li) => { li.onclick = () => fijoMes(li.dataset.fijo); });
  $$('[data-pre]').forEach((li) => { li.onclick = () => editPrestamo(li.dataset.pre); });
  bindRowItems();
}

// tocar un gasto fijo en Mes: cambiar solo este mes o la automatización
function fijoMes(id) {
  const L = S.libro; const m = S.mes; const f = L.planMes(m).fijos.find((x) => String(x.id) === String(id)); if (!f) return;
  if (!f.activo) { editRecurrente(id); return; }
  const base = num(f.rec.importe);
  openModal(`<h2>${esc(f.nombre)}</h2>
    <p class="muted small">Normalmente ${eur(base)} el día ${esc(f.rec.dia)}.${f.gen ? ` En ${esc(mesLargo(m))} ya está apuntado (${eur(f.real)}).` : f.override !== null ? ` Este mes tiene un importe especial: ${eur(f.override)}.` : ''}</p>
    <form novalidate><div class="field"><label class="lbl" for="fm_imp">Importe solo en ${esc(mesLargo(m))} €</label><input type="text" inputmode="decimal" id="fm_imp" value="${esc(String(f.gen ? f.real : (f.override ?? base)).replace('.', ','))}"><div class="hint">Pon 0 para saltártelo este mes. Los demás meses no cambian.</div></div>
    <div class="actions"><button type="button" class="btn" data-all>Cambiar la automatización</button><button class="btn primary" type="submit">Guardar este mes</button></div>
    ${f.override !== null && !f.gen ? '<button type="button" class="btn block" data-reset style="margin-top:8px">Volver al importe normal</button>' : ''}</form>`, (mm) => {
    $('[data-all]', mm).onclick = () => { closeModal(); editRecurrente(id); };
    $('[data-reset]', mm)?.addEventListener('click', async () => { try { const rows = (L.db.RepartoMes || []).filter((x) => x.mes === m && x.linea === `rec:${id}` && !truthy(x.borrado)); await S.store.update('RepartoMes', rows.map((x) => ({ ...x, borrado: 1 }))); await reload(); closeModal(); render(); } catch (e) { fail(e); } });
    $('form', mm).onsubmit = async (e) => {
      e.preventDefault(); const v = round2(num($('#fm_imp', mm).value));
      try {
        if (f.gen) { // ya apuntado: se corrige el movimiento
          await S.store.update('Diario', [v ? { ...f.gen, importe: v } : { ...f.gen, borrado: 1 }]);
        } else {
          const old = (L.db.RepartoMes || []).filter((x) => x.mes === m && x.linea === `rec:${id}` && !truthy(x.borrado));
          if (old.length) await S.store.update('RepartoMes', old.map((x) => ({ ...x, borrado: 1 })));
          await S.store.add('RepartoMes', [{ id: uid(), mes: m, linea: `rec:${id}`, hacia: String(f.rec.debe), importe: v, borrado: '' }]);
        }
        await reload({ automations: true }); closeModal(); toast(v ? `${f.nombre}: ${eur(v)} en ${mesLargo(m)}` : `${f.nombre}: sin cargo en ${mesLargo(m)}`); render();
      } catch (err) { fail(err); }
    };
  });
}

async function copiarPlan(m, src, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const seen = new Map();
    for (const l of [...src.rows.ingresos.filter((i) => !i.extra), ...src.rows.lines]) {
      const k = String(l.code); if (!k) continue;
      if (!seen.has(k)) seen.set(k, l.plan); // repetidas: se queda la primera
    }
    const rows = [...seen].map(([hacia, importe]) => { const id = uid(); return { id, mes: m, linea: id, hacia, importe, borrado: '' }; });
    if (src.tpl && src.rows.ingresosPlan && !src.rows.ingresos.length && S.libro.byCode['700']) { const id = uid(); rows.unshift({ id, mes: m, linea: id, hacia: '700', importe: src.rows.ingresosPlan, borrado: '' }); }
    if (!rows.length) rows.push({ id: uid(), mes: m, linea: 'inicio', hacia: '', importe: 0, borrado: '' });
    await S.store.add('RepartoMes', rows);
    if (!S.libro.config.cuenta_principal && S.libro.principal) await setConfig('cuenta_principal', S.libro.principal);
    await reload(); toast('Plan copiado: cámbialo a tu gusto'); viewMes();
  } catch (e) { fail(e); viewMes(); }
}

async function juntarRepetidas(m) {
  const L = S.libro; const P = L.planMes(m); const seen = new Set(); const kill = []; const killMov = [];
  for (const l of [...P.ingresos.filter((i) => !i.extra), ...P.lines]) {
    if (seen.has(l.code)) { kill.push({ ...l.row, borrado: 1 }); if (l.done) killMov.push({ ...l.done, borrado: 1 }); } else seen.add(l.code);
  }
  if (!kill.length) return;
  try {
    await S.store.update('RepartoMes', kill); if (killMov.length) await S.store.update('Diario', killMov);
    await reload(); toast(`${kill.length} línea${kill.length > 1 ? 's' : ''} repetida${kill.length > 1 ? 's' : ''} quitada${kill.length > 1 ? 's' : ''}`); viewMes();
  } catch (e) { fail(e); }
}

// tipo: 'reparto' (a una cuenta tuya) o 'ingreso' (fuente de ingreso)
function editLinea(linea, tipo) {
  const L = S.libro; const m = S.mes; const P = L.planMes(m);
  const l = linea ? [...P.lines, ...P.ingresos].find((x) => x.linea === String(linea)) : null;
  const ing = tipo === 'ingreso';
  const fields = [
    ing ? { key: 'hacia', label: 'Fuente de ingreso', type: 'account', filter: (c) => isIngreso(c), createKind: 'ingreso', required: true }
      : { key: 'hacia', label: 'Cuenta', type: 'account', filter: (c) => kindOf(c) === 'dinero' && c.codigo !== L.principal, createKind: 'dinero', required: true },
    { key: 'importe', label: ing ? 'Previsto este mes €' : 'Importe este mes €', type: 'number', required: true },
  ];
  const extra = l?.done ? `<div class="banner" style="margin-bottom:10px">Este traspaso ya está hecho (${eur(l.real)}). Si cambias el importe, se corrige también el movimiento.</div>` : '';
  formModal({
    title: l ? l.nombre : (ing ? 'Nueva fuente de ingreso' : 'Añadir cuenta al reparto'), fields, extra,
    values: l ? { hacia: l.code, importe: l.plan } : {},
    onSave: async (d) => {
      if (!l) { const id = uid(); await S.store.add('RepartoMes', [{ id, mes: m, linea: id, hacia: d.hacia, importe: d.importe, borrado: '' }]); await reload(); return; }
      await S.store.update('RepartoMes', [{ ...l.row, hacia: d.hacia, importe: d.importe }]);
      if (l.done) await S.store.update('Diario', [{ ...l.done, debe: d.hacia, importe: round2(d.importe) }]);
      await reload();
    },
    onDelete: l ? async () => {
      await S.store.update('RepartoMes', [{ ...l.row, borrado: 1 }]);
      if (l.done) await S.store.update('Diario', [{ ...l.done, borrado: 1 }]);
      await reload();
    } : null,
  });
}

function cfgMes() {
  const L = S.libro;
  formModal({
    title: 'Cuentas del reparto',
    fields: [
      { key: 'principal', label: 'Cuenta principal (donde cobras y se queda lo que sobra)', type: 'account', filter: (c) => kindOf(c) === 'dinero', createKind: 'dinero', required: true },
      { key: 'fondo', label: 'Fondo de imprevistos', type: 'account', filter: (c) => kindOf(c) === 'dinero', createKind: 'dinero' },
    ],
    values: { principal: L.principal, fondo: L.fondo },
    onSave: async (d) => { await setConfig('cuenta_principal', d.principal); if (d.fondo) await setConfig('cuenta_fondo', d.fondo); await reload(); },
  });
}

async function hacerReparto() {
  const L = S.libro; const m = S.mes; const P = L.planMes(m);
  if (!L.principal) { cfgMes(); return; }
  const fecha = m === ym(todayISO()) ? todayISO() : `${m}-01`;
  const rows = P.pendientes.map((l) => newEntry({ fecha, concepto: `Reparto ${MESES_LARGOS_MES(m)}: ${l.nombre}`, debe: l.code, haber: L.principal, importe: l.plan, clase: 'traspaso', origen: `rep:${m}:${l.linea}` }));
  if (!confirm(`Se apuntarán ${rows.length} traspasos desde ${L.nombre(L.principal)} por ${eur(rows.reduce((s2, r) => s2 + r.importe, 0))}. ¿Seguir?`)) return;
  const btn = $('#doRep'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try { await S.store.add('Diario', rows); await reload(); toast('Reparto hecho'); render(); } catch (e) { fail(e); render(); }
}
async function deshacerReparto() {
  const L = S.libro; const m = S.mes;
  const rows = L.activeRows.filter((r) => String(r.origen).startsWith(`rep:${m}:`));
  if (!confirm(`Se borrarán los ${rows.length} traspasos del reparto de ${mesLargo(m)}. El plan se mantiene. ¿Seguir?`)) return;
  try { await S.store.update('Diario', rows.map((r) => ({ ...r, borrado: 1 }))); await reload(); toast('Reparto deshecho'); render(); } catch (e) { fail(e); }
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
const INFORMES = [['libro', 'Libro diario'], ['mayor', 'Libro mayor'], ['pyg', 'PyG'], ['balance', 'Balance'], ['cuadre', 'Bancos'], ['reporte', 'Reporte']];
const INF_HELP = {
  libro: ['Libro diario', 'Todos los asientos en orden de fecha. Cada uno dice qué cuenta recibe (debe) y cuál entrega (haber). Debe y haber siempre suman lo mismo.'],
  mayor: ['Libro mayor', 'Los mismos asientos, pero ordenados por cuenta: cada cuenta es una «T» con el debe a la izquierda y el haber a la derecha. Cada movimiento aparece dos veces: en el debe de una cuenta y en el haber de otra. Toca un apunte para ver sus dos mitades iluminadas.'],
  pyg: ['PyG · ¿cuánto ahorro?', 'Solo cuentas de gasto (6) e ingreso (7). Ingresos − gastos = ahorro. Los traspasos y el reparto no aparecen: solo mueven dinero entre tus cuentas.'],
  balance: ['Balance · ¿cuánto tengo?', 'Lo que tienes (bancos, inversiones, bienes) y lo que debes, a final de mes. Sube cada mes lo que ahorras.'],
  reporte: ['Reporte mensual', 'Un resumen ejecutivo del mes en dos páginas: ahorro, gastos frente a tu media, plan, balance y evolución. Para imprimir o guardar como PDF.'],
  cuadre: ['Cierre de saldos', 'Escribes lo que dice cada banco y Financito apunta una corrección donde no cuadre (céntimos, gastos olvidados).'],
};
function viewInformes() {
  if (!INFORMES.some(([k]) => k === S.informe)) S.informe = 'libro';
  const [t, d] = INF_HELP[S.informe];
  view().innerHTML = `<div class="seg">${INFORMES.map(([k, l]) => `<button data-i="${k}" class="${S.informe === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <details class="infohelp"><summary><strong>${esc(t)}</strong> · <span class="muted">${esc(d.split('.')[0])}.</span></summary><p class="small">${esc(d)}</p>
      <div class="flowmap small"><span>Apuntar</span>→<span>Libro diario</span>→<span>Libro mayor</span>→<span>PyG (6 y 7)</span>+<span>Balance (1 a 5)</span></div>
      <p class="small muted">La pestaña <strong>Mes</strong> es la de caja: el reparto solo pasa dinero de ${esc(S.libro.principal ? S.libro.nombre(S.libro.principal) : 'tu cuenta principal')} a otras cuentas (traspasos), así que cambia el balance de cada cuenta pero no la PyG.</p></details>
    <div id="inf" style="margin-top:12px"></div>`;
  $$('.seg button[data-i]').forEach((b) => { b.onclick = () => { S.informe = b.dataset.i; viewInformes(); }; });
  ({ libro: infLibro, mayor: infMayor, pyg: infPyG, balance: infBalance, cuadre: infCuadre, reporte: infReporte })[S.informe]();
}

// rango del periodo elegido
const periodRange = () => (S.periodo === 'año' ? [`${S.year}-01-01`, `${S.year}-12-31`] : [`${S.mes}-01`, `${S.mes}-31`]);
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
// número de asiento: orden cronológico dentro del año
function asientos(L) {
  const groups = new Map();
  for (const r of [...L.activeRows].sort((a, b) => (a.fecha + (a.creado || '')).localeCompare(b.fecha + (b.creado || '')))) {
    const k = r.asiento || r.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
  }
  const list = [...groups.values()].map((rows) => ({ rows, fecha: rows[0].fecha, concepto: rows.length > 1 ? rows[0].concepto.replace(/ · (intereses|capital).*/, '') : rows[0].concepto, clase: rows[0].clase, total: round2(rows.reduce((s, r) => s + r.importe, 0)) }));
  const byYear = {}; list.forEach((a) => { const y = a.fecha.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; a.n = byYear[y]; });
  return list;
}

function infLibro() {
  const L = S.libro; const [from, to] = periodRange();
  const all = asientos(L).filter((a) => a.fecha >= from && a.fecha <= to).reverse();
  S.libroN ??= 40; const shown = all.slice(0, S.libroN);
  const sideRows = (rows, side) => {
    const acc = {}; rows.forEach((r) => { const c = side === 'd' ? r.debe : r.haber; acc[c] = (acc[c] || 0) + r.importe; });
    return Object.entries(acc).map(([c, v]) => `<div class="as-line"><span class="as-acc"><span class="as-code">${esc(c)}</span> ${esc(L.nombre(c))}</span><span class="as-amt">${fmt(v)}</span></div>`).join('');
  };
  $('#inf').innerHTML = `${periodBar(infLibro)}
    <div class="small muted" style="margin:-4px 2px 8px">${all.length} asientos · ${eur(all.reduce((s, a) => s + a.total, 0), 0)} movidos</div>
    ${shown.map((a) => `<div class="asiento tap" data-id="${esc(a.rows[0].id)}">
      <div class="as-head"><span class="as-n">Nº ${a.n}</span><span class="as-date">${esc(shortDate(a.fecha))}</span><span class="as-concept">${esc(a.concepto || '(sin concepto)')}</span>${a.clase && a.clase !== 'corriente' ? `<span class="chip ${esc(a.clase)}">${esc(CLASES[a.clase] || a.clase)}</span>` : ''}</div>
      <div class="as-body"><div class="as-col debe"><div class="as-lbl">Debe · recibe</div>${sideRows(a.rows, 'd')}</div><div class="as-col haber"><div class="as-lbl">Haber · entrega</div>${sideRows(a.rows, 'h')}</div></div>
    </div>`).join('') || '<div class="empty">Sin asientos en este periodo.</div>'}
    ${all.length > shown.length ? '<button class="btn block" id="more">Ver más</button>' : ''}`;
  $$('.asiento[data-id]').forEach((el) => { el.onclick = () => editEntry(el.dataset.id); });
  $('#more')?.addEventListener('click', () => { S.libroN += 60; infLibro(); });
}

// ---- tooltip con el asiento completo (las dos mitades: qué se mueve en balance y en PyG) ----
const AREA = { dinero: 'Balance', bien: 'Balance', deuda: 'Balance', contable: 'Balance', gasto: 'PyG', ingreso: 'PyG' };
const MOVE = { // [si va al debe, si va al haber]
  dinero: ['entra dinero', 'sale dinero'], bien: ['sube su valor', 'baja su valor'], deuda: ['debes menos', 'debes más'],
  gasto: ['gasto', 'devolución'], ingreso: ['ingreso que se anula', 'ingreso'], contable: ['debe', 'haber'],
};
const tipBtn = (r) => `<button type="button" class="tip-i" data-tip="${esc(r.asiento || r.id)}" aria-label="Ver asiento completo">i</button>`;
function asientoTip(key) {
  const L = S.libro; const rs = L.activeRows.filter((r) => (r.asiento || r.id) === key); if (!rs.length) return '';
  const part = (code, side, imp) => { const kk = L.kind(code); const ar = AREA[kk] || 'Balance';
    return `<div class="tip-row"><span class="tip-side">${side === 'd' ? 'Debe' : 'Haber'}</span><span class="tip-acc">${emojiFor(L.byCode[code])} ${esc(L.nombre(code))}<small><span class="chip area-${ar === 'PyG' ? 'pyg' : 'bal'}">${ar}</span> ${esc((MOVE[kk] || MOVE.contable)[side === 'd' ? 0 : 1])}</small></span><span class="tip-amt">${fmt(imp)}</span></div>`; };
  return `<div class="tip-head"><strong>${esc(rs[0].concepto || 'Apunte')}</strong><span class="muted">${esc(shortDate(rs[0].fecha))}</span></div>
    ${rs.map((r) => part(r.debe, 'd', r.importe)).join('')}${rs.map((r) => part(r.haber, 'h', r.importe)).join('')}
    <div class="tip-foot">Debe ${fmt(rs.reduce((a, r) => a + r.importe, 0))} = Haber ${fmt(rs.reduce((a, r) => a + r.importe, 0))} ✓</div>`;
}
function bindTips(root) {
  let tip = $('#tip'); if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip); }
  const show = (btn) => {
    tip.innerHTML = asientoTip(btn.dataset.tip); tip.hidden = false; tip.dataset.for = btn.dataset.tip;
    const b = btn.getBoundingClientRect(); const w = Math.min(320, innerWidth - 24); tip.style.width = `${w}px`;
    const x = Math.max(12, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - 12));
    const hgt = tip.offsetHeight; const y = b.bottom + 8 + hgt > innerHeight ? b.top - hgt - 8 : b.bottom + 8;
    tip.style.left = `${x}px`; tip.style.top = `${Math.max(8, y)}px`;
  };
  const hide = () => { tip.hidden = true; tip.dataset.for = ''; };
  const fine = matchMedia('(hover: hover)').matches;
  $$('[data-tip]', root).forEach((btn) => {
    if (fine) { btn.addEventListener('mouseenter', () => show(btn)); btn.addEventListener('mouseleave', hide); }
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!tip.hidden && tip.dataset.for === btn.dataset.tip) hide(); else show(btn); });
  });
  if (!window.__tipDoc) { window.__tipDoc = true; document.addEventListener('click', () => { $('#tip') && ($('#tip').hidden = true); }); addEventListener('scroll', () => { $('#tip') && ($('#tip').hidden = true); }, { passive: true }); addEventListener('hashchange', () => { $('#tip') && ($('#tip').hidden = true); }); }
}

function infMayor() {
  const L = S.libro; const [from, to] = periodRange();
  if (S.mayorCuenta) return mayorCuenta(S.mayorCuenta);
  S.mayorVista ??= 't';
  const rows = L.activeRows.filter((r) => r.fecha >= from && r.fecha <= to).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const sums = {};
  for (const r of rows) { (sums[r.debe] ??= { d: [], h: [] }).d.push(r); (sums[r.haber] ??= { d: [], h: [] }).h.push(r); }
  const codes = Object.keys(sums).sort((a, b) => a.localeCompare(b));
  const KORD = ['dinero', 'gasto', 'ingreso', 'deuda', 'bien', 'contable'];
  const toggle = `<div class="seg mini" style="margin-bottom:10px"><button data-mv="t" class="${S.mayorVista === 't' ? 'on' : ''}">Cuentas en T</button><button data-mv="tabla" class="${S.mayorVista === 'tabla' ? 'on' : ''}">Sumas y saldos</button></div>`;
  let body = '';
  if (S.mayorVista === 't') {
    const key = (r) => esc(r.asiento || r.id);
    const line = (r, side) => `<div class="tl" data-as="${key(r)}"><span class="tl-c">${esc(r.concepto || '')}</span><span class="tl-v">${fmt(r.importe)}${tipBtn(r)}</span><span class="tl-o">${side === 'd' ? '←' : '→'} ${esc(L.nombre(side === 'd' ? r.haber : r.debe))}</span></div>`;
    const MAX = 6;
    const tCard = (c) => {
      const { d, h } = sums[c]; const sd = round2(d.reduce((s, r) => s + r.importe, 0)); const sh = round2(h.reduce((s, r) => s + r.importe, 0));
      const dn = L.debitNormal(c); const mov = round2(dn ? sd - sh : sh - sd); const k = L.kind(c);
      const more = (arr) => (arr.length > MAX ? `<button class="tl-more" data-open="${esc(c)}">+${arr.length - MAX} más</button>` : '');
      return `<div class="tcard k-${k}"><button class="tc-head" data-open="${esc(c)}"><span class="pk-ic sm">${emojiFor(L.byCode[c])}</span><span class="tc-name">${esc(L.nombre(c))}</span><span class="tc-mov ${mov < 0 ? 'neg' : ''}">${mov > 0 ? '+' : ''}${fmt(mov)}</span></button>
        <div class="tc-cols"><div class="tc-col"><div class="tc-h">Debe</div>${d.slice(-MAX).map((r) => line(r, 'd')).join('') || '<div class="tl-empty">—</div>'}${more(d)}<div class="tc-sum">${fmt(sd)}</div></div>
        <div class="tc-col"><div class="tc-h">Haber</div>${h.slice(-MAX).map((r) => line(r, 'h')).join('') || '<div class="tl-empty">—</div>'}${more(h)}<div class="tc-sum">${fmt(sh)}</div></div></div></div>`;
    };
    const KTXT = { dinero: 'Bancos e inversiones · debe = entra, haber = sale', gasto: 'Gastos · casi todo en el debe', ingreso: 'Ingresos · casi todo en el haber', deuda: 'Deudas · haber = debes más, debe = devuelves', bien: 'Bienes', contable: 'Cuentas contables' };
    for (const k of KORD) {
      const cs = codes.filter((c) => L.kind(c) === k); if (!cs.length) continue;
      body += `<h3 class="tgroup">${esc(KTXT[k])}</h3><div class="tgrid">${cs.map(tCard).join('')}</div>`;
    }
    body = `<div id="hlinfo" class="banner" hidden></div>${body || '<div class="empty">Sin movimientos en este periodo.</div>'}`;
  } else {
    const GRP = { 1: 'Financiación y patrimonio', 2: 'Bienes (inmovilizado)', 4: 'Deudores y acreedores', 5: 'Bancos e inversiones', 6: 'Gastos', 7: 'Ingresos' };
    let html = ''; let cur = ''; let td = 0; let th = 0;
    for (const c of codes) {
      const g = c[0]; if (g !== cur) { cur = g; html += `<tr class="sec"><td colspan="4">${esc(g)} · ${esc(GRP[g] || 'Otras')}</td></tr>`; }
      const d = round2(sums[c].d.reduce((s, r) => s + r.importe, 0)); const h = round2(sums[c].h.reduce((s, r) => s + r.importe, 0)); td += d; th += h; const sal = L.debitNormal(c) ? d - h : h - d;
      html += `<tr class="tap" data-acc="${esc(c)}"><td><span class="as-code">${esc(c)}</span> ${esc(L.nombre(c))}</td><td class="n">${d ? fmt(d, 0) : '<span class="muted">—</span>'}</td><td class="n">${h ? fmt(h, 0) : '<span class="muted">—</span>'}</td><td class="n ${cls(sal)}">${fmt(sal, 0)}</td></tr>`;
    }
    body = `<div class="tablewrap"><table class="rep"><tr><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Movimiento</th></tr>${html || '<tr><td colspan="4" class="muted">Sin movimientos</td></tr>'}
      <tr class="tot"><td>Total</td><td class="n">${fmt(td, 0)}</td><td class="n">${fmt(th, 0)}</td><td class="n">${Math.abs(td - th) < 0.01 ? '✓' : `<span class="neg">${fmt(td - th)}</span>`}</td></tr></table></div>
      <p class="small muted">En doble partida el total del debe siempre es igual al del haber. Toca una cuenta para ver su mayor.</p>`;
  }
  $('#inf').innerHTML = `${periodBar(infMayor)}
    <div class="row between wrap" style="gap:8px">${toggle}<div style="flex:1;min-width:220px">${pickerField('cuenta', '', () => true, '', { placeholder: 'Abrir el mayor de una cuenta…' })}</div></div>${body}`;
  bindPickers($('#inf'));
  $('#inf input[name=cuenta]').addEventListener('change', (e) => { S.mayorCuenta = e.target.value; infMayor(); });
  $$('#inf [data-mv]').forEach((b) => { b.onclick = () => { S.mayorVista = b.dataset.mv; infMayor(); }; });
  $$('#inf tr[data-acc], #inf [data-open]').forEach((el) => { el.onclick = () => { S.mayorCuenta = el.dataset.acc || el.dataset.open; infMayor(); scrollTo(0, 0); }; });
  bindTips($('#inf'));
  // tocar un apunte ilumina sus dos mitades (debe de una cuenta, haber de otra)
  $$('#inf .tl').forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.as; const on = !el.classList.contains('hl');
      $$('#inf .tl.hl').forEach((x) => x.classList.remove('hl'));
      const info = $('#hlinfo');
      if (!on) { info.hidden = true; return; }
      $$(`#inf .tl[data-as="${CSS.escape(k)}"]`).forEach((x) => x.classList.add('hl'));
      const rs = rows.filter((r) => (r.asiento || r.id) === k);
      info.hidden = false;
      info.innerHTML = `<strong>${esc(rs[0].concepto || 'Apunte')}</strong> · ${esc(shortDate(rs[0].fecha))}<br>${rs.map((r) => `<span class="nowrap">Debe <strong>${esc(L.nombre(r.debe))}</strong> ${fmt(r.importe)} ⇄ Haber <strong>${esc(L.nombre(r.haber))}</strong> ${fmt(r.importe)}</span>`).join('<br>')}<div class="small muted">Las dos mitades están iluminadas en sus cuentas.</div>`;
    };
  });
}

function mayorCuenta(code) {
  const L = S.libro; const [from, to] = periodRange(); const dn = L.debitNormal(code);
  const sign = (r) => (r.debe === code ? 1 : -1) * (dn ? 1 : -1) * r.importe;
  const rowsAll = L.activeRows.filter((r) => r.debe === code || r.haber === code).sort((a, b) => (a.fecha + (a.creado || '')).localeCompare(b.fecha + (b.creado || '')));
  const c = L.byCode[code]; const k = c ? kindOf(c) : (/^[67]/.test(code) ? (code[0] === '6' ? 'gasto' : 'ingreso') : '');
  const pyg = k === 'gasto' || k === 'ingreso'; const yStart = `${from.slice(0, 4)}-01-01`;
  // las cuentas de gasto/ingreso se ponen a cero cada 1 de enero
  const ini = round2(rowsAll.filter((r) => r.fecha < from && (!pyg || r.fecha >= yStart)).reduce((s, r) => s + sign(r), 0));
  const rows = rowsAll.filter((r) => r.fecha >= from && r.fecha <= to);
  let saldo = ini; const d = rows.filter((r) => r.debe === code); const h = rows.filter((r) => r.haber === code);
  const sd = round2(d.reduce((s, r) => s + r.importe, 0)); const sh = round2(h.reduce((s, r) => s + r.importe, 0));
  const fin = round2(ini + (dn ? sd - sh : sh - sd));
  const tLine = (r) => `<div class="t-line tap" data-id="${esc(r.id)}"><span class="t-date">${esc(shortDate(r.fecha))}</span><span class="t-desc">${esc(r.concepto || '')}</span><span class="t-amt">${fmt(r.importe)}</span>${tipBtn(r)}</div>`;
  const area = AREA[k] || 'Balance';
  // cada movimiento con sus dos cuentas: a la izquierda la que va al debe, a la derecha la que va al haber
  const aCell = (acc, imp, side, r) => { const kk = L.kind(acc); const ar = AREA[kk] || 'Balance'; const me = acc === code;
    return `<div class="a-cell ${side === 'd' ? 'l' : ''} ${me ? 'me' : ''}"><span class="a-acc">${emojiFor(L.byCode[acc])} ${me ? `<strong>${esc(L.nombre(acc))}</strong>` : `<a href="#" class="t-go" data-go="${esc(acc)}">${esc(L.nombre(acc))}</a>`}<small><span class="chip area-${ar === 'PyG' ? 'pyg' : 'bal'}">${ar}</span> ${esc((MOVE[kk] || MOVE.contable)[side === 'd' ? 0 : 1])}</small></span><span class="a-amt">${fmt(imp)}</span></div>`; };
  const other = k === 'gasto' ? 'Solo los movimientos reales de esta cuenta. Pasa el ratón (o toca) por <span class="tip-i">i</span> para ver el asiento completo: de qué banco salió el dinero.'
    : k === 'ingreso' ? 'Solo los movimientos reales de esta cuenta. Pasa el ratón (o toca) por <span class="tip-i">i</span> para ver en qué banco entró el dinero.'
    : k === 'dinero' ? 'En un banco el <strong>debe</strong> es lo que entra y el <strong>haber</strong> lo que sale. Pasa el ratón (o toca) por <span class="tip-i">i</span> para ver a qué gasto, ingreso o cuenta va cada movimiento.' : '';
  $('#inf').innerHTML = `${periodBar(() => mayorCuenta(code))}
    <div class="row between" style="margin-bottom:8px"><button class="btn sm" id="back">‹ Todas las cuentas</button><span class="chip">${esc(c ? KIND_LABEL[kindOf(c)] : L.tipo(code))}</span></div>
    <div class="taccount">
      <div class="t-title"><span class="pk-ic">${emojiFor(c)}</span><div class="grow"><div class="t-name">${esc(L.nombre(code))} <span class="chip area-${area === 'PyG' ? 'pyg' : 'bal'}">${area}</span></div><div class="small muted">Cuenta ${esc(code)} · ${pyg ? 'acumulado del año antes de este periodo' : 'saldo inicial'} ${eur(ini)}</div></div></div>
      ${S.mayorModo === 'clasica' ? `<div class="t-cols">
        <div class="t-col"><div class="t-h">Debe <small>${dn ? 'suma' : 'resta'}</small></div>${d.map(tLine).join('') || '<div class="t-empty">—</div>'}<div class="t-sum">${fmt(sd)}</div></div>
        <div class="t-col"><div class="t-h">Haber <small>${dn ? 'resta' : 'suma'}</small></div>${h.map(tLine).join('') || '<div class="t-empty">—</div>'}<div class="t-sum">${fmt(sh)}</div></div>
      </div>` : `<div class="a-grid">
        <div class="a-h l">Debe</div><div class="a-h">Haber</div>
        ${rows.map((r) => `<div class="a-row tap" data-id="${esc(r.id)}"><div class="a-concept"><span class="muted">${esc(shortDate(r.fecha))}</span> ${esc(r.concepto || '')}</div>${aCell(r.debe, r.importe, 'd', r)}${aCell(r.haber, r.importe, 'h', r)}</div>`).join('') || '<div class="t-empty" style="grid-column:1/-1">Sin movimientos en este periodo.</div>'}
        <div class="a-sum l">${fmt(sd + sh)}</div><div class="a-sum">${fmt(sd + sh)} <b class="pos">✓</b></div>
      </div>`}
      <div class="row between" style="margin-top:10px;gap:8px;flex-wrap:wrap"><div class="seg mini"><button data-modo="asiento" class="${S.mayorModo !== 'clasica' ? 'on' : ''}">Con su pareja</button><button data-modo="clasica" class="${S.mayorModo === 'clasica' ? 'on' : ''}">T clásica</button></div>
        <span class="small muted">${S.mayorModo === 'clasica' ? 'Solo esta cuenta' : `Resaltado: ${esc(L.nombre(code))} · ${dn ? 'debe sube, haber baja' : 'haber sube, debe baja'}`}</span></div>
      <div class="t-saldo">${pyg ? 'Acumulado' : 'Saldo final'} <strong class="${cls(fin)}">${eur(fin)}</strong></div>
    </div>
    ${S.mayorModo === 'clasica' ? (other ? `<p class="small muted" style="margin:8px 2px">${other}</p>` : '') : `<p class="small muted" style="margin:8px 2px">Cada fila es un movimiento con sus dos cuentas: lo que va al <strong>debe</strong> a la izquierda y lo que va al <strong>haber</strong> a la derecha. ${k === 'dinero' ? `Si ${esc(L.nombre(code))} está en el haber, es que <strong>baja</strong> (sale dinero); si está en el debe, <strong>sube</strong>.` : k === 'gasto' ? 'El gasto sube en el debe y, enfrente, el banco del que salió baja en el haber.' : ''} El saldo solo cuenta la cuenta resaltada.</p>`}
    <h3>Movimiento a movimiento</h3>
    <div class="tablewrap"><table class="rep"><tr><th>Fecha</th><th>Concepto · contrapartida</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr>
      <tr class="dim"><td>${esc(shortDate(from))}</td><td>${pyg ? 'Acumulado del año' : 'Saldo inicial'}</td><td></td><td></td><td class="n">${fmt(ini)}</td></tr>
      ${rows.map((r) => { saldo = round2(saldo + sign(r)); return `<tr class="tap" data-id="${esc(r.id)}"><td>${esc(shortDate(r.fecha))}</td><td>${esc(r.concepto || '')} <span class="muted">· <a href="#" class="t-go" data-go="${esc(r.debe === code ? r.haber : r.debe)}">${esc(L.nombre(r.debe === code ? r.haber : r.debe))}</a></span></td><td class="n">${r.debe === code ? fmt(r.importe) : ''}</td><td class="n">${r.haber === code ? fmt(r.importe) : ''}</td><td class="n">${fmt(saldo)}</td></tr>`; }).join('')}
    </table></div>`;
  $('#back').onclick = () => { S.mayorCuenta = ''; infMayor(); };
  $$('#inf [data-modo]').forEach((b) => { b.onclick = () => { S.mayorModo = b.dataset.modo; mayorCuenta(code); }; });
  $$('#inf [data-id]').forEach((el) => { el.onclick = () => editEntry(el.dataset.id); });
  bindTips($('#inf'));
  $$('#inf [data-go]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); S.mayorCuenta = a.dataset.go; mayorCuenta(a.dataset.go); scrollTo(0, 0); }; });
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
const cell = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : ''}">${Math.abs(v) < 0.005 ? '–' : `${fmt(v, 0)}&nbsp;€`}</td>`;
const cellNeg = (v) => `<td class="n ${Math.abs(v) < 0.005 ? 'z' : cls(v)}">${Math.abs(v) < 0.005 ? '–' : `${fmt(v, 0)}&nbsp;€`}</td>`;
const cellDiff = (v, gasto = true) => `<td class="n ${Math.abs(v) < 0.5 ? 'z' : (gasto ? (v > 0 ? 'neg' : 'pos') : (v > 0 ? 'pos' : 'neg'))}">${Math.abs(v) < 0.5 ? '–' : `${v > 0 ? '+' : ''}${fmt(v, 0)}&nbsp;€`}</td>`;
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
  const BLOQUES = [['fijos', 'Gastos fijos'], ['variables', 'Gastos variables'], ['imprevistos', 'Imprevistos'], ['financieros', 'Hipoteca, amortizaciones y otros']];
  const blockTotals = {};
  let gastosHtml = '';
  for (const [k, label] of BLOQUES) {
    const list = p.gastos.filter((r) => r.bloque === k); if (!list.length) continue;
    const tot = cols.map((_, i) => list.reduce((s2, r) => s2 + r.values[i], 0)); blockTotals[k] = tot;
    gastosHtml += `<tr class="sec2"><td>${label}</td>${cellsOf(tot)}</tr>${list.map((r) => line(r, true)).join('')}`;
  }
  const empty = `<tr><td class="muted" colspan="${n + 1}">Nada en este periodo</td></tr>`;
  $('#inf').innerHTML = `${periodBar(infPyG)}
    ${isMes ? `<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="lbl">Ahorro de ${esc(mesLargo(S.mes))}</div><div class="val ${cls(p.resultado[0])}">${eur(p.resultado[0], 0)}</div><div class="sub">ingresos − gastos</div></div><div class="kpi"><div class="lbl">Ingresos</div><div class="val">${eur(p.totalIngresos[0], 0)}</div></div><div class="kpi"><div class="lbl">Gastos</div><div class="val">${eur(p.totalGastos[0], 0)}</div><div class="sub">${p.imprevistos[0] ? `${eur(p.imprevistos[0], 0)} imprevistos` : 'sin imprevistos'}</div></div></div>` : ''}
    <div class="tablewrap"><table class="rep xhair">${head}
      <tr class="sec"><td colspan="${n + 1}">Ingresos</td></tr>
      ${p.ingresos.map((r) => line(r, false)).join('') || empty}
      <tr class="sub"><td>Total ingresos</td>${cellsOf(p.totalIngresos, cell, false)}</tr>
      <tr class="sec"><td colspan="${n + 1}">Gastos</td></tr>
      ${gastosHtml || empty}
      <tr class="sub"><td>Total gastos</td>${cellsOf(p.totalGastos)}</tr>
      <tr class="tot"><td>Ahorro (resultado)</td>${cellsOf(p.resultado, cellNeg, false)}</tr>
      <tr class="dim"><td>Ahorro sin imprevistos</td>${cellsOf(p.resultado.map((v, i) => v + p.imprevistos[i]), cellNeg, false)}</tr>
    </table></div>
    <p class="small muted">Toca una línea para ver sus movimientos. Los traspasos entre tus cuentas y las compras de bienes (piso, coche…) no aparecen aquí porque no son ni ingreso ni gasto.</p>`;
  goAccount($('#inf')); crosshair($('#inf'));
}

function dondeAhorroHtml(m) {
  const L = S.libro; const list = L.dondeAhorro(m);
  const ahorro = L.pygCols([{ from: m, to: m }]).resultado[0];
  const total = round2(list.reduce((s2, x) => s2 + x.aporta, 0));
  if (!list.length) return '';
  const KL = { dinero: 'en bancos e inversiones', bien: 'en bienes', deuda: 'pagando deudas' };
  const desc = (x) => (x.kind === 'deuda' ? (x.aporta >= 0 ? 'deuda pagada' : 'deuda nueva') : x.kind === 'bien' ? (x.aporta >= 0 ? 'bien comprado' : 'pierde valor (amortización)') : x.aporta >= 0 ? 'ha crecido' : 'ha bajado');
  return `<div class="card" style="margin-bottom:12px"><div class="row between"><h3 style="margin:0">Dónde ha ido tu ahorro</h3><strong class="${cls(ahorro)}">${eur(ahorro, 0)}</strong></div>
    <p class="small muted" style="margin:4px 0 6px">Tu ahorro del mes (ingresos − gastos) es exactamente lo que han cambiado tus cuentas.</p>
    <ul class="list">${list.map((x) => `<li class="tap" data-acc="${esc(x.code)}"><span class="pk-ic">${emojiFor(L.byCode[x.code])}</span><div class="grow"><div class="t">${esc(x.nombre)}</div><div class="s">${desc(x)}</div></div><div class="amount ${cls(x.aporta)}">${x.aporta > 0 ? '+' : ''}${eur(x.aporta)}</div></li>`).join('')}</ul>
    ${Math.abs(total - ahorro) > 0.5 ? `<p class="small neg">No cuadra por ${eur(total - ahorro)}: revisa asientos de apertura o ajustes de este mes.</p>` : `<p class="small muted" style="margin-bottom:0">${Object.entries(list.reduce((a2, x) => { a2[x.kind] = (a2[x.kind] || 0) + x.aporta; return a2; }, {})).map(([k, v]) => `${eur(v, 0)} ${KL[k] || ''}`).join(' · ')}</p>`}</div>`;
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
    ${isMes && !(L.inicio && ym(L.inicio) === S.mes) ? dondeAhorroHtml(S.mes) : ''}
    <div class="tablewrap"><table class="rep xhair">${head}
      ${section('activo', 'Lo que tienes (activo)')}
      ${row('Total activo', bals.map((b) => b.totalActivo), 'sub')}
      ${section('pasivo', 'Lo que debes (pasivo)')}
      ${row('Total deudas', bals.map((b) => b.totalPasivo), 'sub')}
      ${row('Patrimonio neto', bals.map((b) => b.patrimonioNeto), 'tot')}
      <tr class="dim"><td>¿Cuadra la contabilidad?</td>${bals.map((b) => `<td class="n">${Math.abs(b.descuadre) < 0.01 ? '✓' : `<span class="neg">${fmt(b.descuadre)}</span>`}</td>`).join('')}${withDiff ? '<td></td>' : ''}</tr>
    </table></div>
    <p class="small muted">Saldos a final de mes${L.inicio ? `, contando desde tu apertura del ${esc(L.inicio)}` : ''}. La variación del patrimonio debería coincidir con tu ahorro del mes (más revalorizaciones).</p>`;
  $('#goap')?.addEventListener('click', () => { setTimeout(apertura, 50); });
  goAccount($('#inf')); crosshair($('#inf'));
}

// al pasar el ratón por una celda se sombrean su fila y su columna
function crosshair(root) {
  if (!matchMedia('(hover: hover)').matches) return;
  $$('table.xhair', root).forEach((t) => {
    let col = -1;
    const paint = (i) => { if (i === col) return; $$('.xcol', t).forEach((c) => c.classList.remove('xcol')); col = i; if (i > 0) $$('tr', t).forEach((tr) => tr.cells[i] && tr.cells[i].colSpan === 1 && tr.cells[i].classList.add('xcol')); };
    t.addEventListener('mouseover', (e) => { const c = e.target.closest('td,th'); if (c && t.contains(c)) paint(c.closest('tr').querySelector('[colspan]') ? -1 : c.cellIndex); });
    t.addEventListener('mouseleave', () => paint(-1));
  });
}

let chartLib = null;
async function loadChart() {
  if (window.Chart) return window.Chart;
  chartLib ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; s.onload = () => res(window.Chart); s.onerror = rej; document.head.appendChild(s); });
  return chartLib;
}
// ================= GRÁFICOS =================
// Paleta categórica fija (validada para daltonismo); el color sigue a la entidad, no al puesto.
const VIZ = {
  light: { s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], grid: '#e3e7e0', ink: '#667066', surface: '#ffffff' },
  dark: { s: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], grid: '#2b332e', ink: '#94a096', surface: '#171c19' },
};
const vizMode = () => (matchMedia('(prefers-color-scheme: dark)').matches ? VIZ.dark : VIZ.light);
const PALETTE = VIZ.light.s;
async function chartReady() {
  const Chart = await loadChart(); const v = vizMode();
  Chart.defaults.color = v.ink; Chart.defaults.borderColor = v.grid; Chart.defaults.font.family = 'system-ui, sans-serif';
  S.charts?.forEach((c) => c.destroy()); S.charts = [];
  return Chart;
}

const isoD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dOf = (iso) => new Date(`${iso}T12:00:00`);
const addDays = (iso, k) => { const d = dOf(iso); d.setDate(d.getDate() + k); return isoD(d); };
const daysBetween = (a, b) => Math.round((dOf(b) - dOf(a)) / 864e5) + 1;
const mondayOf = (iso) => { const d = dOf(iso); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return isoD(d); };
const endOfMonth = (ymStr) => `${ymStr}-${pad(lastDay(Number(ymStr.slice(0, 4)), Number(ymStr.slice(5))))}`;

const RANGOS = [
  ['7d', '7 días'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['30d', '30 días'],
  ['trim', 'Trimestre'], ['3m', '3 meses'], ['ano', 'Este año'], ['12m', '12 meses'], ['todo', 'Todo'], ['custom', 'Elegir fechas'],
];
S.g ??= { r: 'mes', off: 0, from: '', to: '', cat: '', banco: '', imp: false };

// rango [from, to] del preset con desplazamiento (‹ ›)
function gRange() {
  const g = S.g; const t = todayISO(); const o = g.off; const curM = ym(t);
  switch (g.r) {
    case '7d': return [addDays(t, -6 + 7 * o), addDays(t, 7 * o)];
    case '30d': return [addDays(t, -29 + 30 * o), addDays(t, 30 * o)];
    case 'semana': { const m = addDays(mondayOf(t), 7 * o); return [m, addDays(m, 6)]; }
    case 'mes': { const m = addMonths(curM, o); return [`${m}-01`, endOfMonth(m)]; }
    case 'mespasado': { const m = addMonths(curM, o - 1); return [`${m}-01`, endOfMonth(m)]; }
    case 'trim': { const q0 = addMonths(`${curM.slice(0, 4)}-${pad(Math.floor((Number(curM.slice(5)) - 1) / 3) * 3 + 1)}`, 3 * o); return [`${q0}-01`, endOfMonth(addMonths(q0, 2))]; }
    case '3m': { const a = addMonths(curM, -2 + 3 * o); return [`${a}-01`, endOfMonth(addMonths(a, 2))]; }
    case 'ano': { const y = Number(curM.slice(0, 4)) + o; return [`${y}-01-01`, `${y}-12-31`]; }
    case '12m': { const a = addMonths(curM, -11 + 12 * o); return [`${a}-01`, endOfMonth(addMonths(a, 11))]; }
    case 'todo': { const f = S.libro.activeRows.reduce((m, r) => (r.fecha < m ? r.fecha : m), t); return [f, t]; }
    default: return [g.from || `${curM}-01`, g.to || t];
  }
}
function gLabel(from, to) {
  const f = dOf(from); const tt = dOf(to);
  const sameY = from.slice(0, 4) === to.slice(0, 4);
  if (from.slice(8) === '01' && to === endOfMonth(ym(to))) {
    if (ym(from) === ym(to)) return mesLargo(ym(from)).replace(/^./, (c) => c.toUpperCase());
    if (sameY && from.slice(5, 7) === '01' && to.slice(5, 7) === '12') return from.slice(0, 4);
    return `${MESES[f.getMonth()]}${sameY ? '' : ` ${f.getFullYear()}`} – ${MESES[tt.getMonth()]} ${tt.getFullYear()}`;
  }
  const o = { day: 'numeric', month: 'short' };
  return `${f.toLocaleDateString('es-ES', o)}${sameY ? '' : ` ${f.getFullYear()}`} – ${tt.toLocaleDateString('es-ES', o)} ${tt.getFullYear()}`;
}

// movimientos de gasto e ingreso del rango (devoluciones restan)
function gMovs(from, to) {
  const L = S.libro; const g = S.g; const gastos = []; const ingresos = [];
  const bankOf = (code) => (['dinero', 'deuda'].includes(L.kind(code)) ? code : '');
  for (const r of L.activeRows) {
    if (r.fecha < from || r.fecha > to) continue;
    const td = L.tipo(r.debe); const th = L.tipo(r.haber); const imp = r.clase === 'imprevisto';
    if (td === 'gasto' || th === 'gasto') {
      const sign = td === 'gasto' ? 1 : -1; const code = td === 'gasto' ? r.debe : r.haber; const banco = bankOf(td === 'gasto' ? r.haber : r.debe);
      if (g.cat && code !== g.cat) continue;
      if (g.banco && banco !== g.banco) continue;
      gastos.push({ r, code, banco, v: sign * r.importe, bloque: L.bloque(code, imp), imp });
    }
    if (th === 'ingreso' || td === 'ingreso') {
      const sign = th === 'ingreso' ? 1 : -1; const code = th === 'ingreso' ? r.haber : r.debe; const banco = bankOf(th === 'ingreso' ? r.debe : r.haber);
      if (g.banco && banco !== g.banco) continue;
      ingresos.push({ r, code, banco, v: sign * r.importe });
    }
  }
  return { gastos, ingresos };
}
const sumV = (a) => round2(a.reduce((s, x) => s + x.v, 0));
const groupSum = (a, key) => { const o = {}; a.forEach((x) => { o[x[key]] = (o[x[key]] || 0) + x.v; }); return o; };

// cubetas de tiempo según la longitud del rango
function gBuckets(from, to) {
  const n = daysBetween(from, to); const out = [];
  if (n <= 35) { for (let d = from; d <= to; d = addDays(d, 1)) out.push({ k: d, a: d, b: d, l: String(Number(d.slice(8))) }); return { unit: 'día', out }; }
  if (n <= 130) {
    for (let a = mondayOf(from); a <= to; a = addDays(a, 7)) { const b = addDays(a, 6); out.push({ k: a, a: a < from ? from : a, b: b > to ? to : b, l: dOf(a).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }); }
    return { unit: 'semana', out };
  }
  for (let m = ym(from); m <= ym(to); m = addMonths(m, 1)) out.push({ k: m, a: `${m}-01` < from ? from : `${m}-01`, b: endOfMonth(m) > to ? to : endOfMonth(m), l: `${MESES[Number(m.slice(5)) - 1]}${ym(from).slice(0, 4) !== ym(to).slice(0, 4) ? ` ${m.slice(2, 4)}` : ''}` });
  return { unit: 'mes', out };
}
const inB = (b, fecha) => fecha >= b.a && fecha <= b.b;

const delta = (cur, prev, goodUp) => {
  if (!prev) return '<span class="muted">sin datos del periodo anterior</span>';
  const p = ((cur - prev) / Math.abs(prev)) * 100; if (Math.abs(p) < 0.5) return '<span class="muted">= que el periodo anterior</span>';
  const good = goodUp ? p > 0 : p < 0;
  return `<span class="${good ? 'pos' : 'neg'}">${p > 0 ? '▲' : '▼'} ${fmt(Math.abs(p), 0)} %</span> <span class="muted">vs anterior</span>`;
};
// barras horizontales en HTML: legibles, con número y tocables
function hbars(entries, total, prevMap, attr) {
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return `<div class="hb">${entries.map(([code, v]) => {
    const pv = prevMap?.[code] || 0; const d = pv ? ((v - pv) / pv) * 100 : null;
    return `<button class="hb-row" ${attr}="${esc(code)}"><span class="hb-name"><span class="pk-ic sm">${emojiFor(S.libro.byCode[code])}</span>${esc(S.libro.nombre(code) || 'Sin cuenta')}</span>
      <span class="hb-track"><span class="hb-fill" style="width:${Math.max(1.5, (v / max) * 100)}%"></span></span>
      <span class="hb-val">${eur(v, 0)}<small>${total ? `${fmt((v / total) * 100, 0)} %` : ''}${d !== null && Math.abs(d) >= 1 ? ` · <span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'}${fmt(Math.abs(d), 0)}%</span>` : ''}</small></span></button>`;
  }).join('')}</div>`;
}

async function viewGraficos() {
  const L = S.libro; const g = S.g;
  const [from, to] = gRange(); const n = daysBetween(from, to);
  const pFrom = addDays(from, -n); const pTo = addDays(from, -1);
  const cur = gMovs(from, to); const prev = gMovs(pFrom, pTo);
  const impAll = cur.gastos.filter((x) => x.imp);
  if (!g.imp) { cur.gastos = cur.gastos.filter((x) => !x.imp); prev.gastos = prev.gastos.filter((x) => !x.imp); }
  const G = sumV(cur.gastos); const I = sumV(cur.ingresos); const A = round2(I - G);
  const Gp = sumV(prev.gastos); const Ip = sumV(prev.ingresos);
  const hoy = todayISO(); const diasTrans = Math.max(1, daysBetween(from, to < hoy ? to : hoy));
  const porCat = Object.entries(groupSum(cur.gastos, 'code')).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  const porBanco = Object.entries(groupSum(cur.gastos, 'banco')).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  const imps = impAll.sort((a, b) => b.r.fecha.localeCompare(a.r.fecha));
  const top = [...cur.gastos].sort((a, b) => b.v - a.v).slice(0, 8);
  const filtros = [g.cat && `Categoría: ${L.nombre(g.cat)}`, g.banco && `Pagado con: ${L.nombre(g.banco)}`, g.imp && 'Con imprevistos'].filter(Boolean);
  const steppable = !['todo', 'custom'].includes(g.r);
  const rangoBtns = RANGOS.map(([k, l]) => `<button class="gchip ${g.r === k ? 'on' : ''}" data-r="${k}">${l}</button>`).join('');
  const pickBtn = (key, label, val) => `<button class="gchip sel ${val ? 'on' : ''}" data-pick="${key}">${esc(val ? L.nombre(val) : label)} ▾</button>`;

  view().innerHTML = `<div class="gtoolbar">
      <div class="gchips">${rangoBtns}</div>
      <div class="row between gnav">
        ${steppable ? '<button class="iconbtn" data-off="-1" aria-label="Periodo anterior">‹</button>' : '<span></span>'}
        <div class="gtitle"><strong>${esc(gLabel(from, to))}</strong><small class="muted">${n} días · comparado con los ${n} anteriores</small></div>
        ${steppable ? `<button class="iconbtn" data-off="1" aria-label="Periodo siguiente" ${g.off >= 0 ? 'disabled' : ''}>›</button>` : '<span></span>'}
      </div>
      ${g.r === 'custom' ? `<div class="two"><div class="field"><label class="lbl">Desde</label><input type="date" id="gf" value="${esc(from)}"></div><div class="field"><label class="lbl">Hasta</label><input type="date" id="gt" value="${esc(to)}"></div></div>` : ''}
      <div class="gchips">${pickBtn('cat', 'Todas las categorías', g.cat)}${pickBtn('banco', 'Todos los bancos', g.banco)}
        <button class="gchip sel ${g.imp ? 'on' : ''}" data-imp aria-pressed="${g.imp}">${g.imp ? '✓ ' : ''}Con imprevistos</button>
        ${filtros.length ? '<button class="gchip clear" data-clear>✕ Quitar filtros</button>' : ''}</div>
    </div>

    <div class="kpis g4">
      <div class="kpi"><div class="lbl">Gastos</div><div class="val">${eur(G, 0)}</div><div class="sub">${delta(G, Gp, false)}</div></div>
      <div class="kpi"><div class="lbl">Ingresos</div><div class="val">${eur(I, 0)}</div><div class="sub">${delta(I, Ip, true)}</div></div>
      <div class="kpi"><div class="lbl">Ahorro</div><div class="val ${A < 0 ? 'neg' : ''}">${eur(A, 0)}</div><div class="sub">${I > 0 ? `${fmt((A / I) * 100, 0)} % de lo que entra` : '—'}</div></div>
      <div class="kpi"><div class="lbl">Gasto por día</div><div class="val">${eur(G / diasTrans, 0)}</div><div class="sub">${to > hoy ? `${diasTrans} días transcurridos` : `en ${n} días`}</div></div>
    </div>

    <div class="ggrid">
      <div class="card span2"><div class="row between"><h3>Entra y sale</h3><span class="small muted">por ${'<span id="gunit"></span>'}</span></div><div class="chartbox"><canvas id="g1"></canvas></div></div>
      <div class="card"><h3>En qué se va</h3>${porCat.length ? hbars(porCat, G, groupSum(prev.gastos, 'code'), 'data-cat') : '<div class="empty">Sin gastos en este periodo.</div>'}<p class="small muted" style="margin-bottom:0">Toca una categoría para filtrar todo por ella. ▲▼ = vs periodo anterior.</p></div>
      <div class="card"><h3>Tipo de gasto</h3><div class="chartbox"><canvas id="g2"></canvas></div></div>
      <div class="card"><h3>Ahorro acumulado</h3><div class="chartbox sm"><canvas id="g3"></canvas></div></div>
      <div class="card"><h3>Desde dónde pagas</h3>${porBanco.length ? hbars(porBanco, G, groupSum(prev.gastos, 'banco'), 'data-banco') : '<div class="empty">—</div>'}</div>
      <div class="card"><h3>Qué día gastas más</h3><div class="chartbox sm"><canvas id="g4"></canvas></div><p class="small muted" style="margin-bottom:0">Media por día de la semana.</p></div>
      <div class="card"><h3>Gastos más grandes</h3><ul class="list">${top.map((x) => `<li class="tap" data-id="${esc(x.r.id)}"><span class="pk-ic">${emojiFor(L.byCode[x.code])}</span><div class="grow"><div class="t">${esc(x.r.concepto || L.nombre(x.code))}${x.imp ? ' <span class="chip imprevisto">imprevisto</span>' : ''}</div><div class="s">${esc(shortDate(x.r.fecha))} · ${esc(L.nombre(x.code))}</div></div><div class="amount">${eur(x.v)}</div></li>`).join('') || '<li class="muted">—</li>'}</ul></div>
      <div class="card"><div class="row between"><h3>Imprevistos</h3><strong>${eur(sumV(imps))}</strong></div>
        <p class="small muted" style="margin-top:0">${g.imp ? '' : 'No cuentan en el resto de la página (activa «Con imprevistos» para sumarlos)'}${g.imp && G ? `${fmt((sumV(imps) / G) * 100, 0)} % del gasto del periodo` : ''}${L.fondo && L.inicio ? ` · en ${esc(L.nombre(L.fondo))}: ${eur(L.balanceToDate(L.fondo), 0)}` : ''}</p>
        <ul class="list">${imps.slice(0, 8).map((x) => `<li class="tap" data-id="${esc(x.r.id)}"><span class="pk-ic">${emojiFor(L.byCode[x.code])}</span><div class="grow"><div class="t">${esc(x.r.concepto || '')}</div><div class="s">${esc(shortDate(x.r.fecha))} · ${esc(L.nombre(x.code))}</div></div><div class="amount">${eur(x.v)}</div></li>`).join('') || `<li class="muted">Ninguno en este periodo 🎉</li>`}</ul></div>
      ${L.inicio && n > 45 ? '<div class="card span2"><h3>Patrimonio neto</h3><div class="chartbox sm"><canvas id="g5"></canvas></div></div>' : ''}
    </div>`;

  // eventos
  $$('[data-r]', view()).forEach((b) => { b.onclick = () => { g.r = b.dataset.r; g.off = 0; if (g.r === 'custom' && !g.from) { g.from = from; g.to = to; } viewGraficos(); }; });
  $$('[data-off]', view()).forEach((b) => { b.onclick = () => { g.off += Number(b.dataset.off); viewGraficos(); }; });
  $('#gf')?.addEventListener('change', (e) => { g.from = e.target.value; viewGraficos(); });
  $('#gt')?.addEventListener('change', (e) => { g.to = e.target.value; viewGraficos(); });
  $('[data-imp]').onclick = () => { g.imp = !g.imp; viewGraficos(); };
  $('[data-clear]')?.addEventListener('click', () => { g.cat = ''; g.banco = ''; g.imp = false; viewGraficos(); });
  $$('[data-pick]', view()).forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.pick;
      if (g[key]) { g[key] = ''; viewGraficos(); return; }
      openPicker({ title: key === 'cat' ? 'Filtrar por categoría' : 'Filtrar por banco', selected: g[key], filter: (c) => (key === 'cat' ? kindOf(c) === 'gasto' : ['dinero', 'deuda'].includes(kindOf(c))), onPick: (code) => { g[key] = code; viewGraficos(); } });
    };
  });
  $$('[data-cat]', view()).forEach((b) => { b.onclick = () => { g.cat = g.cat === b.dataset.cat ? '' : b.dataset.cat; viewGraficos(); scrollTo(0, 0); }; });
  $$('[data-banco]', view()).forEach((b) => { b.onclick = () => { g.banco = g.banco === b.dataset.banco ? '' : b.dataset.banco; viewGraficos(); scrollTo(0, 0); }; });
  $$('li[data-id]', view()).forEach((li) => { li.onclick = () => editEntry(li.dataset.id); });

  // gráficos
  const { unit, out: B } = gBuckets(from, to); $('#gunit').textContent = unit;
  let Chart; try { Chart = await chartReady(); } catch { view().insertAdjacentHTML('afterbegin', '<div class="banner warn">No se pudo cargar la librería de gráficos (¿sin conexión?). Las listas sí funcionan.</div>'); return; }
  const v = vizMode(); const S1 = v.s;
  const money = { callbacks: { label: (c) => `${c.dataset.label ? `${c.dataset.label}: ` : ''}${eur(c.parsed.y ?? c.parsed)}` } };
  const yAxis = { ticks: { callback: (x) => `${fmt(x, 0)} €`, maxTicksLimit: 5 }, grid: { color: v.grid }, border: { display: false } };
  const xAxis = { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } };
  const bar = (label, data, color, extra = {}) => ({ label, data, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 28, ...extra });
  const legend = { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } };
  const labels = B.map((b) => b.l);
  const gB = B.map((b) => round2(cur.gastos.filter((x) => inB(b, x.r.fecha)).reduce((s, x) => s + x.v, 0)));
  const iB = B.map((b) => round2(cur.ingresos.filter((x) => inB(b, x.r.fecha)).reduce((s, x) => s + x.v, 0)));
  const hover = { mode: 'index', intersect: false };
  S.charts.push(new Chart($('#g1'), { type: 'bar', data: { labels, datasets: [bar('Ingresos', iB, S1[0]), bar('Gastos', gB, S1[1])] }, options: { maintainAspectRatio: false, interaction: hover, plugins: { legend, tooltip: money }, scales: { x: xAxis, y: yAxis }, datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } } }));
  // tipo de gasto apilado (orden fijo de bloques = color fijo)
  const BLQ = [['fijos', 'Fijos', S1[0]], ['variables', 'Variables', S1[2]], ['imprevistos', 'Imprevistos', S1[1]], ['financieros', 'Hipoteca y otros', S1[6]]];
  const blqData = BLQ.map(([k, l, c]) => bar(l, B.map((b) => round2(cur.gastos.filter((x) => x.bloque === k && inB(b, x.r.fecha)).reduce((s, x) => s + x.v, 0))), c, { borderColor: v.surface, borderWidth: { top: 2 }, borderRadius: 0 })).filter((d) => d.data.some((x) => x));
  S.charts.push(new Chart($('#g2'), { type: 'bar', data: { labels, datasets: blqData }, options: { maintainAspectRatio: false, interaction: hover, plugins: { legend, tooltip: money }, scales: { x: { ...xAxis, stacked: true }, y: { ...yAxis, stacked: true } } } }));
  let acc = 0; const accData = B.map((b, i) => (b.a > hoy ? null : (acc = round2(acc + iB[i] - gB[i]))));
  S.charts.push(new Chart($('#g3'), { type: 'line', data: { labels, datasets: [{ label: 'Ahorro acumulado', data: accData, borderColor: S1[2], backgroundColor: 'transparent', borderWidth: 2, tension: 0.25, pointRadius: B.length > 20 ? 0 : 4, pointHoverRadius: 5, pointBackgroundColor: S1[2], pointBorderColor: v.surface, pointBorderWidth: 2 }] }, options: { maintainAspectRatio: false, interaction: hover, plugins: { legend: { display: false }, tooltip: money }, scales: { x: xAxis, y: yAxis } } }));
  const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']; const cnt = Array(7).fill(0); const tot = Array(7).fill(0);
  for (let d = from; d <= to; d = addDays(d, 1)) cnt[(dOf(d).getDay() + 6) % 7]++;
  cur.gastos.filter((x) => x.bloque === 'variables' || x.bloque === 'imprevistos').forEach((x) => { tot[(dOf(x.r.fecha).getDay() + 6) % 7] += x.v; });
  S.charts.push(new Chart($('#g4'), { type: 'bar', data: { labels: DOW, datasets: [bar('Media', tot.map((t, i) => (cnt[i] ? round2(t / cnt[i]) : 0)), S1[0])] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: money }, scales: { x: xAxis, y: yAxis } } }));
  if ($('#g5')) {
    const ms = monthsBetween(ym(from) < ym(L.inicio) ? ym(L.inicio) : ym(from), ym(to < hoy ? to : hoy));
    S.charts.push(new Chart($('#g5'), { type: 'line', data: { labels: ms.map((m) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`), datasets: [{ label: 'Patrimonio neto', data: ms.map((m) => L.balance(m).patrimonioNeto), borderColor: S1[0], borderWidth: 2, tension: 0.25, pointRadius: 3, pointBackgroundColor: S1[0], pointBorderColor: v.surface, pointBorderWidth: 2 }] }, options: { maintainAspectRatio: false, interaction: hover, plugins: { legend: { display: false }, tooltip: money }, scales: { x: xAxis, y: yAxis } } }));
  }
}

// ================= REPORTE EJECUTIVO MENSUAL (2 páginas A4) =================
async function infReporte() {
  const L = S.libro; const m = S.mes; const prevM = addMonths(m, -1);
  const hist = Array.from({ length: 12 }, (_, i) => addMonths(m, i - 12)); // 12 meses anteriores
  const p = L.pygCols([{ from: m, to: m }, { from: prevM, to: prevM }, ...hist.map((x) => ({ from: x, to: x })), { from: `${m.slice(0, 4)}-01`, to: m }]);
  const H = hist.map((_, i) => i + 2); const YTD = 14;
  const conDatos = H.filter((i) => p.totalGastos[i] || p.totalIngresos[i]);
  const avg = (arr) => (conDatos.length ? conDatos.reduce((s, i) => s + arr[i], 0) / conDatos.length : 0);
  const I = p.totalIngresos[0]; const G = p.totalGastos[0]; const A = p.resultado[0]; const imp = p.imprevistos[0];
  const tasa = I ? A / I : 0; const tasaMed = (() => { const ti = conDatos.reduce((s, i) => s + p.totalIngresos[i], 0); const ta = conDatos.reduce((s, i) => s + p.resultado[i], 0); return ti ? ta / ti : 0; })();
  const balOk = !!L.inicio && ym(L.inicio) <= m;
  const bal = balOk ? L.balance(m) : null; const balP = balOk && ym(L.inicio) <= prevM ? L.balance(prevM) : null;
  const plan = L.planMes(m); const pres = L.presupuesto(m).filter((x) => L.kind(x.code) === 'gasto');
  const BLQ = [['fijos', 'Fijos'], ['variables', 'Variables'], ['imprevistos', 'Imprevistos'], ['financieros', 'Hipoteca y otros']];
  const blq = BLQ.map(([k, l]) => { const rs = p.gastos.filter((r) => r.bloque === k); const v = (i) => rs.reduce((s, r) => s + r.values[i], 0); return { k, l, v: round2(v(0)), med: round2(avg(H.reduce((o, i) => { o[i] = v(i); return o; }, []))) }; }).filter((b) => b.v || b.med);
  // categorías (sin distinguir imprevisto) este mes vs media
  const catMap = {}; p.gastos.forEach((r) => { const c = (catMap[r.code] ??= { code: r.code, nombre: r.nombre, vals: Array(p.cols.length).fill(0) }); r.values.forEach((v, i) => { c.vals[i] += v; }); });
  const cats = Object.values(catMap).map((c) => ({ ...c, v: round2(c.vals[0]), med: round2(avg(c.vals)) })).filter((c) => c.v || c.med).sort((a, b) => b.v - a.v);
  const movs = L.activeRows.filter((r) => ym(r.fecha) === m);
  const grandes = movs.filter((r) => L.tipo(r.debe) === 'gasto').sort((a, b) => b.importe - a.importe).slice(0, 5);
  const descuadre = round2(movs.reduce((s, r) => s + (r.debe === '659' ? r.importe : 0) - (r.haber === '759' ? r.importe : 0), 0));
  const fondo = L.fondo && balOk ? L.balanceToDate(L.fondo) : null; const impMed = avg(p.imprevistos);
  const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const vs = (a, b, goodUp, label) => { const d = pct(a, b); if (d === null || !isFinite(d)) return `<span class="muted">${label}: —</span>`; if (Math.abs(d) < 1) return `<span class="muted">= ${label}</span>`; const good = goodUp ? d > 0 : d < 0; return `<span class="${good ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), 0)} %</span> <span class="muted">${label}</span>`; };

  // ---- lo destacado (frases automáticas) ----
  const notas = [];
  if (I) notas.push(`Has ahorrado <strong>${eur(A, 0)}</strong>, el <strong>${fmt(tasa * 100, 0)} %</strong> de lo que ha entrado${conDatos.length ? ` (tu media: ${fmt(tasaMed * 100, 0)} %)` : ''}.`);
  else notas.push('No hay ingresos apuntados este mes: el ahorro no es representativo.');
  const sube = cats.filter((c) => c.med > 20 && c.v > c.med * 1.2).sort((a, b) => (b.v - b.med) - (a.v - a.med))[0];
  if (sube) notas.push(`<strong>${esc(sube.nombre)}</strong> está un ${fmt(pct(sube.v, sube.med), 0)} % por encima de tu media (${eur(sube.v, 0)} frente a ${eur(sube.med, 0)}).`);
  const baja = cats.filter((c) => c.med > 20 && c.v < c.med * 0.8).sort((a, b) => (a.v - a.med) - (b.v - b.med))[0];
  if (baja) notas.push(`<strong>${esc(baja.nombre)}</strong> baja un ${fmt(Math.abs(pct(baja.v, baja.med)), 0)} % respecto a tu media.`);
  if (imp) notas.push(`Imprevistos: <strong>${eur(imp, 0)}</strong>${fondo !== null ? `; en tu fondo quedan ${eur(fondo, 0)}${impMed ? ` (≈ ${fmt(fondo / impMed, 0)} meses de imprevistos medios)` : ''}` : ''}.`);
  const pasados = pres.filter((x) => x.real > x.asignado);
  if (pres.length) notas.push(pasados.length ? `Límites superados: ${pasados.map((x) => `<strong>${esc(x.nombre)}</strong> (${eur(x.real - x.asignado, 0)} de más)`).join(', ')}.` : `Has respetado los ${pres.length} límites por categoría.`);
  if (bal && balP) { const d = bal.patrimonioNeto - balP.patrimonioNeto; notas.push(`Tu patrimonio neto ${d >= 0 ? 'sube' : 'baja'} <strong>${eur(Math.abs(d), 0)}</strong> y queda en ${eur(bal.patrimonioNeto, 0)}.`); }
  if (Math.abs(descuadre) >= 1) notas.push(`Correcciones del cierre de saldos: ${eur(descuadre, 0)} ${descuadre > 0 ? 'que se escaparon sin apuntar' : 'a tu favor'}.`);

  const bar = (v, max, cls2 = '') => `<span class="r-track"><span class="r-fill ${cls2}" style="width:${max ? Math.max(1, Math.min(100, (v / max) * 100)) : 0}%"></span></span>`;
  const maxB = Math.max(...blq.map((b) => Math.max(b.v, b.med)), 1);
  const maxC = Math.max(...cats.slice(0, 8).map((c) => Math.max(c.v, c.med)), 1);
  const grp = (list) => { const o = {}; list.forEach((x) => { const g = displayGroup(L.byCode[x.code]) || x.grupo; (o[g] ??= []).push(x); }); return o; };
  const balRows = (list) => Object.entries(grp(list.filter((x) => Math.abs(x.saldo) > 0.5))).map(([g, l]) => `<tr class="r-g"><td>${esc(g)}</td><td class="n">${eur(l.reduce((s, x) => s + x.saldo, 0), 0)}</td></tr>${l.map((x) => `<tr><td class="r-ind">${esc(x.nombre)}</td><td class="n">${eur(x.saldo, 0)}</td></tr>`).join('')}`).join('');
  const donde = balOk ? L.dondeAhorro(m) : [];
  const titulo = mesLargo(m).replace(/^./, (c) => c.toUpperCase());

  $('#inf').innerHTML = `${periodBar(infReporte, { allowYear: false })}
    <div class="row between noprint" style="margin-bottom:12px;gap:8px;flex-wrap:wrap"><span class="small muted">Dos páginas A4 con lo esencial del mes. Imprímelo o guárdalo como PDF.</span><button class="btn primary" id="print">Imprimir / guardar PDF</button></div>
    <div id="report">
      <section class="r-page">
        <header class="r-head"><div><div class="r-kicker">Financito · reporte mensual</div><h1>${esc(titulo)}</h1></div><div class="r-date">Generado el ${esc(new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }))}</div></header>
        <div class="r-kpis">
          <div class="r-kpi hero"><div class="lbl">Ahorro del mes</div><div class="val ${A < 0 ? 'neg' : ''}">${eur(A, 0)}</div><div class="sub">${I ? `${fmt(tasa * 100, 0)} % de los ingresos` : '—'}</div><div class="sub">${vs(A, p.resultado[1], true, 'vs mes anterior')}</div></div>
          <div class="r-kpi"><div class="lbl">Ingresos</div><div class="val">${eur(I, 0)}</div><div class="sub">${vs(I, p.totalIngresos[1], true, 'vs mes ant.')}</div><div class="sub">${vs(I, avg(p.totalIngresos), true, 'vs media 12m')}</div></div>
          <div class="r-kpi"><div class="lbl">Gastos</div><div class="val">${eur(G, 0)}</div><div class="sub">${vs(G, p.totalGastos[1], false, 'vs mes ant.')}</div><div class="sub">${vs(G, avg(p.totalGastos), false, 'vs media 12m')}</div></div>
          <div class="r-kpi"><div class="lbl">Patrimonio neto</div><div class="val">${bal ? eur(bal.patrimonioNeto, 0) : '—'}</div><div class="sub">${bal && balP ? `${bal.patrimonioNeto - balP.patrimonioNeto >= 0 ? '+' : ''}${eur(bal.patrimonioNeto - balP.patrimonioNeto, 0)} en el mes` : bal ? 'fin de mes' : 'faltan saldos iniciales'}</div></div>
        </div>
        <div class="r-box"><h2>Lo destacado</h2><ul class="r-notes">${notas.map((n) => `<li>${n}</li>`).join('')}</ul></div>
        <div class="r-cols">
          <div class="r-box"><h2>Tipo de gasto</h2><table class="r-t"><tr><th></th><th></th><th class="n">Mes</th><th class="n">Media</th></tr>${blq.map((b) => `<tr><td>${esc(b.l)}</td><td class="r-bars">${bar(b.v, maxB)}${bar(b.med, maxB, 'med')}</td><td class="n"><strong>${eur(b.v, 0)}</strong></td><td class="n muted">${eur(b.med, 0)}</td></tr>`).join('')}</table><p class="r-leg"><span class="r-sw"></span> este mes <span class="r-sw med"></span> media 12 meses</p></div>
          <div class="r-box"><h2>Plan del mes</h2>${plan.hasPlan ? `<table class="r-t">
            <tr><td>Ingresos</td><td class="n muted">plan ${eur(plan.ingresosPlan, 0)}</td><td class="n"><strong>${eur(plan.ingresosReal, 0)}</strong></td></tr>
            <tr><td>Gastos fijos</td><td class="n muted">plan ${eur(plan.fijosPlan, 0)}</td><td class="n"><strong>${eur(plan.fijosReal, 0)}</strong></td></tr>
            <tr><td>Reparto a cuentas</td><td class="n muted">plan ${eur(plan.repartoPlan, 0)}</td><td class="n"><strong>${eur(plan.repartoReal, 0)}</strong></td></tr>
            <tr class="r-tot"><td>Se queda en ${esc(L.principal ? L.nombre(L.principal) : 'principal')}</td><td class="n muted">plan ${eur(plan.sobrantePlan, 0)}</td><td class="n"><strong>${eur(plan.sobranteReal, 0)}</strong></td></tr></table>`
            : '<p class="muted small">Este mes no tiene plan de reparto.</p>'}
            ${pres.length ? `<h3>Límites por categoría</h3><table class="r-t">${pres.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="r-bars">${bar(x.real, Math.max(x.asignado, x.real), x.real > x.asignado ? 'over' : '')}</td><td class="n ${x.real > x.asignado ? 'neg' : ''}">${eur(x.real, 0)} / ${eur(x.asignado, 0)}</td></tr>`).join('')}</table>` : ''}</div>
        </div>
        <div class="r-box"><h2>En qué se ha ido</h2><table class="r-t"><tr><th>Categoría</th><th></th><th class="n">Mes</th><th class="n">Media 12m</th><th class="n">Dif.</th></tr>
          ${cats.slice(0, 8).map((c) => { const d = c.v - c.med; return `<tr><td>${emojiFor(L.byCode[c.code])} ${esc(c.nombre)}</td><td class="r-bars">${bar(c.v, maxC)}${bar(c.med, maxC, 'med')}</td><td class="n"><strong>${eur(c.v, 0)}</strong></td><td class="n muted">${eur(c.med, 0)}</td><td class="n ${Math.abs(d) < 5 ? 'muted' : d > 0 ? 'neg' : 'pos'}">${Math.abs(d) < 0.5 ? '–' : `${d > 0 ? '+' : ''}${eur(d, 0)}`}</td></tr>`; }).join('') || '<tr><td class="muted">Sin gastos</td></tr>'}</table></div>
      </section>

      <section class="r-page">
        <header class="r-head sm"><div><div class="r-kicker">Financito · reporte mensual</div><h1>${esc(titulo)} · evolución y patrimonio</h1></div></header>
        <div class="r-box"><h2>Últimos 12 meses</h2><div class="r-chart"><canvas id="rc1"></canvas></div></div>
        <div class="r-cols">
          <div class="r-box"><h2>Balance a fin de mes</h2>${bal ? `<table class="r-t bal">
            <tr class="r-sec"><td>Lo que tienes</td><td class="n">${eur(bal.totalActivo, 0)}</td></tr>${balRows(bal.activo)}
            <tr class="r-sec"><td>Lo que debes</td><td class="n">${eur(bal.totalPasivo, 0)}</td></tr>${balRows(bal.pasivo)}
            <tr class="r-tot"><td>Patrimonio neto</td><td class="n">${eur(bal.patrimonioNeto, 0)}</td></tr></table>` : '<p class="muted small">Mete tus saldos iniciales para ver el balance.</p>'}</div>
          <div>
            <div class="r-box"><h2>Año ${esc(m.slice(0, 4))} hasta ${esc(MESES_LARGOS_[Number(m.slice(5)) - 1])}</h2><table class="r-t">
              <tr><td>Ingresos</td><td class="n">${eur(p.totalIngresos[YTD], 0)}</td></tr><tr><td>Gastos</td><td class="n">${eur(p.totalGastos[YTD], 0)}</td></tr>
              <tr><td class="r-ind">de ellos imprevistos</td><td class="n muted">${eur(p.imprevistos[YTD], 0)}</td></tr>
              <tr class="r-tot"><td>Ahorro</td><td class="n">${eur(p.resultado[YTD], 0)}</td></tr>
              <tr><td>Tasa de ahorro</td><td class="n">${p.totalIngresos[YTD] ? `${fmt((p.resultado[YTD] / p.totalIngresos[YTD]) * 100, 0)} %` : '—'}</td></tr>
              <tr><td>Ahorro medio al mes</td><td class="n">${eur(p.resultado[YTD] / Number(m.slice(5)), 0)}</td></tr></table></div>
            ${donde.length ? `<div class="r-box"><h2>Dónde ha ido el ahorro</h2><table class="r-t">${donde.slice(0, 7).map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n ${cls(x.aporta)}">${x.aporta > 0 ? '+' : ''}${eur(x.aporta, 0)}</td></tr>`).join('')}</table></div>` : ''}
            <div class="r-box"><h2>Gastos más grandes</h2><table class="r-t">${grandes.map((r) => `<tr><td>${esc(shortDate(r.fecha))} · ${esc(r.concepto || L.nombre(r.debe))}${r.clase === 'imprevisto' ? ' <span class="chip imprevisto">imprevisto</span>' : ''}</td><td class="n">${eur(r.importe, 0)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>
          </div>
        </div>
        <footer class="r-foot">${movs.length} movimientos en el mes · ${conDatos.length} meses de historia para las medias${Math.abs(descuadre) >= 0.5 ? ` · correcciones de cierre: ${eur(descuadre)}` : ''}</footer>
      </section>
    </div>`;
  $('#print').onclick = () => window.print();
  let Chart; try { Chart = await chartReady(); } catch { return; }
  const v = vizMode(); const months = [...hist.slice(1), m]; const idx = [...H.slice(1), 0];
  S.charts.push(new Chart($('#rc1'), {
    type: 'bar',
    data: { labels: months.map((x) => `${MESES[Number(x.slice(5)) - 1]}${x.slice(5) === '01' || x === months[0] ? ` ${x.slice(2, 4)}` : ''}`), datasets: [
      { label: 'Ingresos', data: idx.map((i) => p.totalIngresos[i]), backgroundColor: v.s[0], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 18 },
      { label: 'Gastos', data: idx.map((i) => p.totalGastos[i]), backgroundColor: v.s[1], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 18 },
    ] },
    options: { animation: false, maintainAspectRatio: false, devicePixelRatio: 2, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${eur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (x) => `${fmt(x, 0)} €`, maxTicksLimit: 5 }, grid: { color: v.grid }, border: { display: false } } } },
  }));
}
const MESES_LARGOS_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ================= CAMBIO DE BANCO (asistente) =================
function cambioBanco() {
  const L = S.libro; const hoy = todayISO();
  const money = (c) => kindOf(c) === 'dinero';
  openModal(`<h2>Cambiar de banco</h2>
    <p class="small muted" style="margin-top:-4px">Pasa tu dinero y todo lo que apuntaba a una cuenta (automatizaciones, hipoteca, reparto, límites, cuenta principal) a otra. El historial de la cuenta antigua no se toca.</p>
    <form novalidate>
      ${pickerField('desde', 'Desde (la cuenta que dejas)', money, L.principal || '')}
      ${pickerField('hacia', 'Hacia (la nueva)', money, '', { createKind: 'dinero', placeholder: 'Elegir o crear (p. ej. «Ibercaja»)…', hint: 'Si no existe, escribe su nombre en el buscador y pulsa «Crear».' })}
      <div class="two"><div class="field"><label class="lbl" for="cb_f">Fecha del cambio</label><input type="date" id="cb_f" name="fecha" value="${hoy}"></div>
      <div class="field"><label class="lbl" for="cb_i">Dinero que pasas €</label><input type="text" inputmode="decimal" id="cb_i" name="importe" autocomplete="off"><div class="hint" id="cb_sal"></div></div></div>
      <div class="field"><label class="lbl">Qué hacer</label>
        <label class="check"><input type="checkbox" name="o_tras" checked> <span>Apuntar el traspaso del dinero</span></label>
        <label class="check"><input type="checkbox" name="o_rec" checked> <span>Automatizaciones y préstamos: cobrar/pagar desde la nueva</span></label>
        <label class="check"><input type="checkbox" name="o_rep" checked> <span>Reparto y límites: de este mes en adelante, a la nueva</span></label>
        <label class="check"><input type="checkbox" name="o_cfg" checked> <span>Si era tu cuenta principal o tu fondo, pasa a ser la nueva</span></label>
        <label class="check"><input type="checkbox" name="o_off" checked> <span>Ocultar la cuenta antigua (su historial se conserva)</span></label>
      </div>
      <div class="banner" id="cb_prev" hidden></div>
      <div class="actions"><button type="button" class="btn" data-cancel>Cancelar</button><button class="btn primary" type="submit">Hacer el cambio</button></div>
    </form>`, (m) => {
    const f = $('form', m); bindPickers(m); $('[data-cancel]', m).onclick = closeModal;
    const val = (n) => f.elements[n].value;
    const plan = () => {
      const from = val('desde'); const to = val('hacia'); const mes = ym(val('fecha') || hoy);
      const rec = (L.db.Recurrentes || []).filter((r) => r.nombre && (String(r.debe) === from || String(r.haber) === from));
      const pre = (L.db.Prestamos || []).filter((p) => p.nombre && String(p.cuenta_banco) === from);
      const rep = (L.db.RepartoMes || []).filter((x) => !truthy(x.borrado) && String(x.hacia) === from && x.mes >= mes);
      const repT = (L.db.Reparto || []).filter((x) => !truthy(x.borrado) && String(x.hacia) === from);
      const presu = (L.db.Presupuesto || []).filter((x) => !truthy(x.borrado) && String(x.cuenta) === from && (x.mes === '*' || x.mes >= mes));
      const cfg = ['cuenta_principal', 'cuenta_fondo'].filter((k) => (k === 'cuenta_principal' ? L.principal : L.fondo) === from);
      return { from, to, mes, rec, pre, rep, repT, presu, cfg };
    };
    const refresh = () => {
      const p = plan(); const prev = $('#cb_prev', m);
      if (L.inicio && p.from) { const s = L.balanceToDate(p.from); $('#cb_sal', m).textContent = `Saldo actual: ${eur(s)}`; if (!f.elements.importe.dataset.touched) f.elements.importe.value = s > 0 ? String(round2(s)).replace('.', ',') : ''; }
      if (!p.from || !p.to) { prev.hidden = true; return; }
      if (p.from === p.to) { prev.hidden = false; prev.innerHTML = 'Elige dos cuentas distintas.'; return; }
      const items = [
        f.elements.o_tras.checked && num(val('importe')) > 0 && `traspaso de ${eur(num(val('importe')))}`,
        f.elements.o_rec.checked && p.rec.length && `${p.rec.length} ${p.rec.length > 1 ? 'automatizaciones' : 'automatización'}`,
        f.elements.o_rec.checked && p.pre.length && `${p.pre.length} préstamo${p.pre.length > 1 ? 's' : ''}`,
        f.elements.o_rep.checked && (p.rep.length + p.repT.length) && `${p.rep.length + p.repT.length} línea${p.rep.length + p.repT.length > 1 ? 's' : ''} de reparto`,
        f.elements.o_rep.checked && p.presu.length && `${p.presu.length} límite${p.presu.length > 1 ? 's' : ''}`,
        f.elements.o_cfg.checked && p.cfg.length && (p.cfg.includes('cuenta_principal') ? 'cuenta principal' : 'fondo de imprevistos'),
        f.elements.o_off.checked && `ocultar ${L.nombre(p.from)}`,
      ].filter(Boolean);
      prev.hidden = false; prev.innerHTML = `<strong>${esc(L.nombre(p.from))} → ${esc(L.nombre(p.to))}</strong>: ${items.length ? esc(items.join(' · ')) : 'nada que cambiar'}.`;
    };
    f.addEventListener('change', refresh); f.elements.importe.addEventListener('input', (e) => { e.target.dataset.touched = '1'; refresh(); });
    refresh();
    f.onsubmit = async (e) => {
      e.preventDefault(); const p = plan();
      if (!p.from || !p.to || p.from === p.to) { toast('Elige la cuenta que dejas y la nueva'); return; }
      const btn = $('button[type=submit]', f); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try {
        const swap = (v) => (String(v) === p.from ? p.to : v);
        const imp = num(val('importe'));
        if (f.elements.o_tras.checked && imp > 0) await S.store.add('Diario', [newEntry({ fecha: val('fecha') || hoy, concepto: `Cambio de banco: ${L.nombre(p.from)} → ${L.nombre(p.to)}`, debe: p.to, haber: p.from, importe: imp, clase: 'traspaso', origen: 'cambio-banco' })]);
        if (f.elements.o_rec.checked) {
          if (p.rec.length) await S.store.update('Recurrentes', p.rec.map((r) => ({ ...r, debe: swap(r.debe), haber: swap(r.haber) })));
          if (p.pre.length) await S.store.update('Prestamos', p.pre.map((x) => ({ ...x, cuenta_banco: p.to })));
        }
        if (f.elements.o_rep.checked) {
          if (p.rep.length) await S.store.update('RepartoMes', p.rep.map((x) => ({ ...x, hacia: p.to })));
          if (p.repT.length) await S.store.update('Reparto', p.repT.map((x) => ({ ...x, hacia: p.to })));
          if (p.presu.length) await S.store.update('Presupuesto', p.presu.map((x) => ({ ...x, cuenta: p.to })));
        }
        if (f.elements.o_cfg.checked) for (const k of p.cfg) await setConfig(k, p.to);
        if (f.elements.o_off.checked) { const c = L.byCode[p.from]; if (c) await S.store.update('Cuentas', [{ ...c, activa: 0 }]); }
        await reload(); closeModal(); render(); toast(`Hecho: ahora usas ${L.nombre(p.to)}`);
      } catch (err) { btn.disabled = false; btn.textContent = 'Hacer el cambio'; fail(err); }
    };
  });
}

// ================= INVERSIONES (seguimiento sencillo, fuera de la contabilidad) =================
const INV_TIPOS = [['etf', 'ETF / fondo indexado'], ['fondo', 'Fondo de inversión'], ['accion', 'Acciones'], ['cripto', 'Cripto'], ['deposito', 'Depósito / letras'], ['plan', 'Plan de pensiones'], ['otro', 'Otro']];
const INV_EMOJI = { etf: '📊', fondo: '🏦', accion: '📈', cripto: '🪙', deposito: '🔒', plan: '🧓', otro: '💼' };
const dayMs = 864e5;
// una inversión: t0/v0 → t1/v1 (t1 = venta o última valoración)
function invCalc(x) {
  const v0 = num(x.importe_inicial); const cerrada = !!x.fecha_fin;
  const t0 = x.fecha_inicio; const t1 = cerrada ? x.fecha_fin : (x.fecha_valor || todayISO());
  const v1 = cerrada ? num(x.importe_final) : (x.valor_actual === '' || x.valor_actual === undefined ? v0 : num(x.valor_actual));
  const dias = Math.max(0, Math.round((new Date(`${t1}T12:00:00`) - new Date(`${t0}T12:00:00`)) / dayMs));
  const benef = round2(v1 - v0); const rent = v0 ? v1 / v0 - 1 : 0;
  const anual = v0 > 0 && v1 > 0 && dias >= 1 ? (v1 / v0) ** (365 / dias) - 1 : null;
  return { ...x, v0, v1, t0, t1, dias, benef, rent, anual, cerrada };
}
// TIR anualizada de varios flujos (XIRR): -v0 en t0 y +v1 en t1 de cada inversión
function xirr(flows) {
  if (!flows.length || !flows.some((f) => f.v > 0) || !flows.some((f) => f.v < 0)) return null;
  const t0 = Math.min(...flows.map((f) => f.t));
  const npv = (r) => flows.reduce((s, f) => s + f.v / (1 + r) ** ((f.t - t0) / (365 * dayMs)), 0);
  let lo = -0.9999; let hi = 10; let flo = npv(lo); let fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; const fm = npv(mid); if (Math.abs(fm) < 1e-7) return mid; if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
function invTotals(list) {
  const v0 = round2(list.reduce((s, x) => s + x.v0, 0)); const v1 = round2(list.reduce((s, x) => s + x.v1, 0));
  const flows = list.flatMap((x) => [{ t: new Date(`${x.t0}T12:00:00`).getTime(), v: -x.v0 }, { t: new Date(`${x.t1}T12:00:00`).getTime(), v: x.v1 }]);
  return { n: list.length, v0, v1, benef: round2(v1 - v0), rent: v0 ? v1 / v0 - 1 : 0, tir: list.length ? xirr(flows) : null };
}
const pctS = (r, dec = 1) => (r === null || r === undefined || !isFinite(r) ? '—' : `${r > 0 ? '+' : ''}${fmt(r * 100, dec)} %`);
const durTxt = (d) => (d < 60 ? `${d} días` : d < 730 ? `${fmt(d / 30.44, 0)} meses` : `${fmt(d / 365.25, 1)} años`);

function viewInversiones() {
  const L = S.libro; S.invTab ??= 'abiertas';
  const all = (L.db.Inversiones || []).filter((x) => !truthy(x.borrado) && x.nombre).map(invCalc);
  const abiertas = all.filter((x) => !x.cerrada); const cerradas = all.filter((x) => x.cerrada);
  const tA = invTotals(abiertas); const tC = invTotals(cerradas); const tT = invTotals(all);
  const list = { abiertas, cerradas, todas: all }[S.invTab].sort((a, b) => (a.cerrada === b.cerrada ? b.t0.localeCompare(a.t0) : a.cerrada ? 1 : -1));
  const maxAbs = Math.max(...list.map((x) => Math.abs(x.benef)), 1);
  const tot = (t, label, sub) => `<div class="inv-tot"><div class="lbl">${label}</div><div class="val ${cls(t.benef)}">${t.benef > 0 ? '+' : ''}${eur(t.benef, 0)}</div><div class="sub">${pctS(t.rent)} · TIR ${pctS(t.tir)}/año</div><div class="sub muted">${sub}</div></div>`;
  view().innerHTML = `
    <div class="kpis inv-k">
      <div class="kpi"><div class="lbl">Valor actual (abiertas)</div><div class="val">${eur(tA.v1, 0)}</div><div class="sub">invertido ${eur(tA.v0, 0)} en ${tA.n} posicion${tA.n === 1 ? '' : 'es'}</div></div>
      <div class="kpi"><div class="lbl">Beneficio latente</div><div class="val ${cls(tA.benef)}">${tA.benef > 0 ? '+' : ''}${eur(tA.benef, 0)}</div><div class="sub">${pctS(tA.rent)} sobre lo invertido</div></div>
      <div class="kpi"><div class="lbl">Rentabilidad anual (TIR)</div><div class="val ${cls(tA.tir || 0)}">${pctS(tA.tir)}</div><div class="sub">de las abiertas, por tiempo invertido</div></div>
    </div>
    <div class="card inv-sum"><div class="inv-tots">${tot(tA, 'Abiertas · latente', `${eur(tA.v0, 0)} → ${eur(tA.v1, 0)}`)}${tot(tC, 'Cerradas · realizado', `${tC.n} vendida${tC.n === 1 ? '' : 's'}`)}${tot(tT, 'Total de todo', `${eur(tT.v0, 0)} invertidos en total`)}</div></div>
    <div class="row between" style="margin:14px 0 10px;gap:8px;flex-wrap:wrap">
      <div class="seg mini">${[['abiertas', `Abiertas (${abiertas.length})`], ['cerradas', `Cerradas (${cerradas.length})`], ['todas', 'Todas']].map(([k, l]) => `<button data-it="${k}" class="${S.invTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn primary sm" id="invnew">+ Nueva inversión</button></div>
    <div class="inv-grid">${list.map((x) => `<div class="card inv-card ${x.cerrada ? 'closed' : ''}" data-inv="${esc(x.id)}">
        <div class="row between" style="gap:8px"><div class="row" style="gap:10px;min-width:0"><span class="pk-ic">${INV_EMOJI[x.tipo] || '💼'}</span><div style="min-width:0"><div class="t inv-name">${esc(x.nombre)}</div><div class="small muted">${esc((INV_TIPOS.find(([k]) => k === x.tipo) || [, 'Inversión'])[1])}${x.cuenta ? ` · ${esc(L.nombre(x.cuenta))}` : ''}</div></div></div>
          <span class="chip ${x.cerrada ? '' : 'ok'}">${x.cerrada ? 'vendida' : 'abierta'}</span></div>
        <div class="inv-flow"><div><small>${esc(shortDate(x.t0))} ${x.t0.slice(0, 4)}</small><strong>${eur(x.v0)}</strong></div><span class="inv-arrow">→ ${durTxt(x.dias)} →</span><div class="r"><small>${x.cerrada ? 'venta' : 'valor'} ${esc(shortDate(x.t1))} ${x.t1.slice(0, 4)}</small><strong>${eur(x.v1)}</strong></div></div>
        <div class="inv-bar"><span class="${x.benef < 0 ? 'neg' : ''}" style="width:${Math.max(2, (Math.abs(x.benef) / maxAbs) * 100)}%"></span></div>
        <div class="inv-stats"><div><small>Beneficio</small><strong class="${cls(x.benef)}">${x.benef > 0 ? '+' : ''}${eur(x.benef)}</strong></div><div><small>Rentabilidad</small><strong class="${cls(x.rent)}">${pctS(x.rent)}</strong></div><div><small>Anualizada</small><strong class="${cls(x.anual || 0)}">${pctS(x.anual)}</strong>${x.dias < 365 && x.anual !== null ? '<small class="muted">menos de 1 año</small>' : ''}</div></div>
        ${x.cerrada ? '' : `<div class="row" style="gap:6px;margin-top:10px"><button class="btn sm" data-upd="${esc(x.id)}">Actualizar valor</button><button class="btn sm" data-close="${esc(x.id)}">Vender</button></div>`}
      </div>`).join('') || `<div class="empty">${S.invTab === 'cerradas' ? 'Aún no has vendido ninguna.' : 'Apunta tu primera inversión: cuándo entraste (t0), cuánto pusiste (v0) y cuánto vale hoy.'}</div>`}</div>
    <details class="card infohelp" style="margin-top:14px"><summary><strong>Cómo se calcula</strong></summary><div class="small">
      <p><strong>Beneficio</strong> = valor (o venta) − lo invertido. <strong>Rentabilidad</strong> = beneficio ÷ invertido.</p>
      <p><strong>Anualizada</strong> (geométrica, CAGR) = (valor ÷ invertido)<sup>365 / días</sup> − 1: lo que habría rendido cada año a interés compuesto. Con menos de un año exagera, tómala con cuidado.</p>
      <p><strong>TIR</strong> de los totales: la rentabilidad anual que pondera cuánto dinero y cuánto tiempo estuvo en cada inversión.</p>
      <p class="muted">Este seguimiento va aparte de la contabilidad. Para que el balance refleje el valor de tus inversiones, usa Informes → Bancos (cierre de saldos) con tu cuenta de inversión.</p></div></details>`;
  $$('[data-it]').forEach((b) => { b.onclick = () => { S.invTab = b.dataset.it; viewInversiones(); }; });
  $('#invnew').onclick = () => editInversion();
  $$('[data-inv]').forEach((c) => { c.onclick = (e) => { if (e.target.closest('button')) return; editInversion(c.dataset.inv); }; });
  $$('[data-upd]').forEach((b) => { b.onclick = () => invQuick(b.dataset.upd, 'upd'); });
  $$('[data-close]').forEach((b) => { b.onclick = () => invQuick(b.dataset.close, 'close'); });
}
function invRow(id) { return (S.libro.db.Inversiones || []).find((x) => String(x.id) === String(id)); }
function editInversion(id) {
  const x = id ? invRow(id) : null; const hoy = todayISO();
  formModal({
    title: x ? x.nombre : 'Nueva inversión',
    fields: [
      { key: 'nombre', label: 'Nombre', required: true, placeholder: 'p. ej. MSCI World (Trade Republic)' },
      { key: 'tipo', label: 'Tipo', type: 'select', options: INV_TIPOS },
      { key: 'cuenta', label: 'Dónde está (opcional)', type: 'account', filter: (c) => kindOf(c) === 'dinero' },
      { key: 'fecha_inicio', label: 'Fecha de entrada (t0)', type: 'date', required: true },
      { key: 'importe_inicial', label: 'Invertido (v0) €', type: 'number', required: true },
      { key: 'valor_actual', label: 'Valor actual €', type: 'number', hint: 'Lo que vale hoy. Déjalo vacío si aún no lo sabes.' },
      { key: 'fecha_valor', label: 'Fecha de ese valor', type: 'date' },
      { key: 'fecha_fin', label: 'Fecha de venta (si ya la vendiste)', type: 'date' },
      { key: 'importe_final', label: 'Importe de la venta €', type: 'number' },
      { key: 'notas', label: 'Notas', type: 'textarea' },
    ],
    values: x || { tipo: 'etf', fecha_inicio: hoy, fecha_valor: hoy },
    onSave: async (d) => {
      if (d.fecha_fin && d.importe_final === '') throw new Error('Pon el importe de la venta');
      if (d.valor_actual !== '' && !d.fecha_valor) d.fecha_valor = hoy;
      const row = { ...(x || { id: uid(), borrado: '' }), ...d };
      if (x) await S.store.update('Inversiones', [row]); else await S.store.add('Inversiones', [row]);
      await reload();
    },
    onDelete: x ? async () => { await S.store.update('Inversiones', [{ ...x, borrado: 1 }]); await reload(); } : null,
  });
}
function invQuick(id, mode) {
  const x = invRow(id); const hoy = todayISO();
  formModal({
    title: mode === 'upd' ? `Valor de ${x.nombre}` : `Vender ${x.nombre}`,
    fields: mode === 'upd'
      ? [{ key: 'valor_actual', label: 'Valor hoy €', type: 'number', required: true }, { key: 'fecha_valor', label: 'Fecha', type: 'date', required: true }]
      : [{ key: 'importe_final', label: 'Importe recibido €', type: 'number', required: true, hint: 'Lo que te ingresan, ya descontadas comisiones.' }, { key: 'fecha_fin', label: 'Fecha de venta', type: 'date', required: true }],
    values: mode === 'upd' ? { valor_actual: x.valor_actual, fecha_valor: hoy } : { importe_final: x.valor_actual, fecha_fin: hoy },
    saveLabel: mode === 'upd' ? 'Guardar valor' : 'Marcar vendida',
    onSave: async (d) => { await S.store.update('Inversiones', [{ ...x, ...d }]); await reload(); },
  });
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
    { key: 'cuenta', label: k === 'gasto' ? 'Categoría' : 'Cuenta', type: 'account', filter: (c) => (k === 'gasto' ? isGasto(c) : c.grupo === 'Tesorería'), required: true },
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
  const L = S.libro;
  if (!L.inicio) { $('#inf').innerHTML = `${needsApertura()}<p class="muted">Cuando metas los saldos iniciales podrás comprobar aquí, cuenta por cuenta, que lo que dice Financito coincide con lo que tienes de verdad en el banco.</p>`; $('#goap')?.addEventListener('click', () => setTimeout(apertura, 50)); return; }
  S.cuadreFecha ??= todayISO(); const fecha = S.cuadreFecha;
  const accs = L.cuentas.filter((c) => kindOf(c) === 'dinero' && (c.activa !== 0 || L.balanceToDate(c.codigo)));
  const lastReal = (code) => (L.db.Saldos || []).filter((s2) => String(s2.cuenta) === code).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  const finMes = (() => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10); })();
  $('#inf').innerHTML = `<div class="card" style="margin-bottom:12px"><strong>Cierre de saldos</strong>
      <ol class="small" style="margin:6px 0 10px;padding-left:18px"><li>Elige la fecha (hoy o el último día del mes).</li><li>Escribe lo que dice cada banco ese día. Deja en blanco las que no quieras revisar.</li><li>Pulsa «Corregir diferencias»: se apunta un movimiento de corrección en cada cuenta que no cuadre.</li></ol>
      <div class="row wrap"><input type="date" id="cfecha" value="${esc(fecha)}" style="width:auto;flex:1">${fecha !== finMes ? `<button class="btn sm" id="fmes">Fin de ${esc(MESES[Number(finMes.slice(5, 7)) - 1].toLowerCase())}</button>` : ''}${fecha !== todayISO() ? '<button class="btn sm" id="fhoy">Hoy</button>' : ''}</div></div>
    <div class="card"><ul class="list">${accs.map((c) => { const lib = L.balanceToDate(c.codigo, fecha); const lr = lastReal(c.codigo); return `<li style="flex-wrap:wrap"><span class="pk-ic">${emojiFor(c)}</span><div class="grow"><div class="t">${esc(c.nombre)}</div><div class="s">Según Financito: <strong>${eur(lib)}</strong>${lr ? ` · comprobado el ${esc(normDate(lr.fecha))}` : ''}</div></div>
      <input type="text" inputmode="decimal" data-real="${esc(c.codigo)}" placeholder="En tu banco" aria-label="Saldo en tu banco de ${esc(c.nombre)}" style="width:120px;min-height:38px;padding:7px 10px;text-align:right">
      <div data-diff="${esc(c.codigo)}" class="small" style="width:100%"></div></li>`; }).join('')}</ul></div>
    <button class="btn primary block" id="fixall" style="margin-top:12px" disabled>Corregir diferencias</button>
    <p class="small muted">Las correcciones van a «Descuadres» (gasto o ingreso pequeño) y aparecen en la PyG, así ves cuánto se te escapa al mes. En inversiones se apuntan como revalorización (ganancia o pérdida de valor). Si encuentras el movimiento que faltaba, apúntalo y borra la corrección.</p>`;
  $('#cfecha').onchange = (e) => { S.cuadreFecha = e.target.value || todayISO(); infCuadre(); };
  $('#fmes')?.addEventListener('click', () => { S.cuadreFecha = finMes; infCuadre(); });
  $('#fhoy')?.addEventListener('click', () => { S.cuadreFecha = todayISO(); infCuadre(); });
  const state = {};
  const refreshBtn = () => { const n = Object.values(state).filter((x) => Math.abs(x.d) >= 0.01).length; const ok = Object.values(state).length; const b = $('#fixall'); b.disabled = !ok; b.textContent = n ? `Corregir ${n} diferencia${n > 1 ? 's' : ''}` : ok ? 'Guardar saldos comprobados' : 'Corregir diferencias'; };
  $$('[data-real]').forEach((inp) => {
    inp.oninput = () => {
      const code = inp.dataset.real; const box = $(`[data-diff="${code}"]`); const inv = L.byCode[code]?.grupo === 'Inversiones';
      if (!inp.value.trim()) { box.innerHTML = ''; delete state[code]; refreshBtn(); return; }
      const real = num(inp.value); const d = round2(real - L.balanceToDate(code, fecha)); state[code] = { real, d, inv };
      box.innerHTML = Math.abs(d) < 0.01 ? '<span class="pos">✓ Cuadra</span>'
        : `<span class="${inv ? '' : 'neg'}">${inv ? (d > 0 ? `Tu inversión ha subido ${eur(d)}` : `Tu inversión ha bajado ${eur(-d)}`) : (d < 0 ? `Faltan ${eur(-d)}: algún gasto sin apuntar` : `Sobran ${eur(d)}: algún ingreso sin apuntar`)}</span> · <a href="#" data-ver="${esc(code)}">ver movimientos</a>`;
      $(`[data-ver="${code}"]`, box)?.addEventListener('click', (e) => { e.preventDefault(); S.diario = { ...S.diario, cuenta: code, mes: '', q: '' }; location.hash = '#/diario'; });
      refreshBtn();
    };
  });
  $('#fixall').onclick = async () => {
    const entries = Object.entries(state); const fixes = entries.filter(([, x]) => Math.abs(x.d) >= 0.01);
    if (fixes.length && !confirm(`Se apuntarán ${fixes.length} correcciones con fecha ${fecha}:\n${fixes.map(([c, x]) => `· ${L.nombre(c)}: ${x.d > 0 ? '+' : ''}${eur(x.d)}`).join('\n')}\n\n¿Seguir?`)) return;
    const btn = $('#fixall'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try {
      const asiento = uid();
      const rows = fixes.map(([code, x]) => { const [debe, haber] = x.inv ? (x.d > 0 ? [code, '763'] : ['663', code]) : (x.d > 0 ? [code, '759'] : ['659', code]); return newEntry({ asiento, fecha, concepto: x.inv ? `Revalorización ${L.nombre(code)}` : `Corrección de saldo ${L.nombre(code)}`, debe, haber, importe: Math.abs(x.d), clase: 'ajuste', origen: 'cuadre' }); });
      if (rows.length) await S.store.add('Diario', rows);
      await S.store.add('Saldos', entries.map(([code, x]) => ({ id: uid(), fecha, cuenta: code, saldo: x.real, notas: Math.abs(x.d) >= 0.01 ? 'corregido' : 'cuadra' })));
      await reload(); toast(rows.length ? `${rows.length} corrección${rows.length > 1 ? 'es' : ''} apuntada${rows.length > 1 ? 's' : ''}` : 'Saldos comprobados'); infCuadre();
    } catch (e) { fail(e); infCuadre(); }
  };
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
      <div class="row wrap" style="margin-top:8px"><button class="btn sm" data-new="dinero">+ Banco o inversión</button><button class="btn sm" data-new="bien">+ Bien</button><button class="btn sm" data-new="deuda">+ Deuda</button><button class="btn sm" id="bankmove">⇄ Cambiar de banco…</button></div></div>

    <h2>Categorías</h2>
    <div class="card"><h3 style="margin-top:0">De gasto</h3><ul class="list">${listOf(['gasto']).map((c) => accLi(c)).join('')}</ul>
      <button class="btn sm" data-new="gasto" style="margin-top:8px">+ Categoría de gasto</button>
      <h3>De ingreso</h3><ul class="list">${listOf(['ingreso']).map((c) => accLi(c)).join('')}</ul>
      <button class="btn sm" data-new="ingreso" style="margin-top:8px">+ Tipo de ingreso</button></div>

    <h2>Automatizaciones mensuales</h2>
    <div class="card"><ul class="list">${rec.map((r) => `<li class="tap" data-rec="${esc(r.id)}"><span class="pk-ic">${emojiFor(L.byCode[String(r.debe)])}</span><div class="grow"><div class="t">${esc(r.nombre)}</div><div class="s">Día ${esc(r.dia)} de cada mes · ${esc(L.nombre(String(r.haber)))} → ${esc(L.nombre(String(r.debe)))}</div></div><div class="amount">${eur(num(r.importe))}</div><span class="chip">${truthy(r.activo) ? 'activa' : 'pausada'}</span></li>`).join('') || '<li class="muted">Ninguna</li>'}</ul>
      <button class="btn block" id="addrec" style="margin-top:8px">Añadir automatización</button>
      <p class="small muted">Cada mes, al abrir la app, se apuntan solas las que toquen. Si borras una generada, no se vuelve a crear.</p></div>

    <h2>Activos que se amortizan</h2>
    <div class="card"><ul class="list">${act.map((a) => { const am = L.activeRows.filter((r) => r.origen?.startsWith(`amort:${a.id}:`)).reduce((s, r) => s + r.importe, 0); return `<li class="tap" data-act="${esc(a.id)}"><div class="grow"><div class="t">${esc(a.nombre)}</div><div class="s">${eur(num(a.valor))} · ${Math.round(num(a.vida_meses) / 12 * 10) / 10} años · amortizado ${eur(am)}</div><div class="bar"><span style="width:${Math.min(100, am / Math.max(1, num(a.valor) - num(a.residual)) * 100)}%"></span></div></div></li>`; }).join('') || '<li class="muted">Ninguno. Se crean al apuntar una «Compra de activo» marcando «Amortizar».</li>'}</ul>
      <button class="btn block" id="addact" style="margin-top:8px">Añadir activo</button></div>

    <h2>Hipoteca y préstamos</h2>
    <div class="card"><ul class="list">${pre.map((p) => { const cq = cuadroPrestamo(p); const hoy = todayISO(); const next = cq.find((q) => q.fecha > hoy); const pend = [...cq].reverse().find((q) => q.fecha <= hoy)?.pendiente ?? num(p.capital); const f = participacion(p); return `<li class="tap" data-pre="${esc(p.id)}"><span class="pk-ic">🏛️</span><div class="grow"><div class="t">${esc(p.nombre)}${f < 1 ? ` <span class="chip">tu parte ${Math.round(f * 100)} %</span>` : ''}</div><div class="s">Cuota ${eur((cq[0]?.cuota || 0) * f)}${f < 1 ? ` (de ${eur(cq[0]?.cuota || 0)})` : ''} · ${esc(p.interes_anual)} % · te quedan ${eur(pend * f)}${next ? ` · próxima ${esc(next.fecha)}` : ''}</div></div></li>`; }).join('') || '<li class="muted">Ninguno</li>'}</ul>
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
  $('#bankmove').onclick = cambioBanco;
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
const REC_TIPOS = {
  gasto: { label: 'Gasto fijo', desc: 'Sale dinero de un banco para pagar algo (Mamá, gym, suscripciones…).', haber: ['Se paga desde', (c) => isMoney(c), null], debe: ['Categoría', (c) => isGasto(c), 'gasto'], clase: 'corriente' },
  traspaso: { label: 'Ahorro o reparto', desc: 'Mueves dinero entre tus cuentas (fondo extraordinarios, Trade Republic, Revolut…).', haber: ['Desde', (c) => isPayer(c), null], debe: ['Hacia', (c) => isPayer(c), 'dinero'], clase: 'traspaso' },
  ingreso: { label: 'Ingreso', desc: 'Te entra dinero cada mes (nómina, alquiler…).', haber: ['Tipo de ingreso', (c) => isIngreso(c), 'ingreso'], debe: ['Entra en', (c) => isMoney(c), null], clase: 'ingreso' },
};
function editRecurrente(id) {
  const L = S.libro; const r = (L.db.Recurrentes || []).find((x) => String(x.id) === String(id));
  const tipoDe = (x) => (x.clase === 'traspaso' ? 'traspaso' : (x.clase === 'ingreso' || L.tipo(String(x.haber)) === 'ingreso') ? 'ingreso' : 'gasto');
  const st = r ? { ...r, desde: String(r.desde).slice(0, 7), hasta: String(r.hasta || '').slice(0, 7), haber: String(r.haber), debe: String(r.debe), tipo: tipoDe(r) }
    : { tipo: 'gasto', dia: 1, desde: ym(todayISO()), hasta: '', activo: 1, haber: L.byCode['5721'] ? '5721' : (L.cuentas.find(isMoney)?.codigo || ''), debe: '', nombre: '', importe: '' };
  const draw = (m) => {
    const T = REC_TIPOS[st.tipo];
    if (!T.haber[1](L.byCode[st.haber] || {})) st.haber = '';
    if (!T.debe[1](L.byCode[st.debe] || {})) st.debe = '';
    m.innerHTML = `<h2>${r ? 'Editar automatización' : 'Nueva automatización'}</h2>
      <div class="seg" style="margin-bottom:8px">${Object.entries(REC_TIPOS).map(([k, t]) => `<button type="button" data-tipo="${k}" class="${k === st.tipo ? 'on' : ''}">${t.label}</button>`).join('')}</div>
      <p class="hint" style="margin:0 0 12px">${esc(T.desc)}</p>
      <form novalidate>
        <div class="field"><label class="lbl" for="r_nombre">Nombre</label><input type="text" id="r_nombre" name="nombre" value="${esc(st.nombre)}" placeholder="Ej.: Gimnasio" autocomplete="off"></div>
        <div class="two"><div class="field"><label class="lbl" for="r_imp">Importe €</label><input type="text" inputmode="decimal" id="r_imp" name="importe" value="${esc(st.importe === '' ? '' : String(st.importe).replace('.', ','))}"></div>
        <div class="field"><label class="lbl" for="r_dia">Día del mes</label><input type="text" inputmode="numeric" id="r_dia" name="dia" value="${esc(st.dia)}"></div></div>
        ${pickerField('haber', T.haber[0], T.haber[1], st.haber, { createKind: T.haber[2] })}
        ${pickerField('debe', T.debe[0], T.debe[1], st.debe, { createKind: T.debe[2] })}
        <div class="two"><div class="field"><label class="lbl" for="r_desde">Desde</label><input type="month" id="r_desde" name="desde" value="${esc(st.desde)}"></div>
        <div class="field"><label class="lbl" for="r_hasta">Hasta (opcional)</label><input type="month" id="r_hasta" name="hasta" value="${esc(st.hasta)}"></div></div>
        <div class="field"><label class="check"><input type="checkbox" name="activo" ${truthy(st.activo) ? 'checked' : ''}> Activa</label></div>
        <div class="actions">${r ? '<button type="button" class="btn danger" data-del>Borrar</button>' : ''}<button type="button" class="btn" data-cancel>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>
      </form>`;
    const form = $('form', m);
    const sync = () => { const f = form.elements; Object.assign(st, { nombre: f.nombre.value, importe: f.importe.value, dia: f.dia.value, desde: f.desde.value, hasta: f.hasta.value, activo: f.activo.checked ? 1 : 0, haber: f.haber.value, debe: f.debe.value }); };
    bindPickers(m);
    form.elements.debe.addEventListener('change', () => { if (!form.elements.nombre.value.trim()) form.elements.nombre.value = L.nombre(form.elements.debe.value); });
    $$('[data-tipo]', m).forEach((b) => { b.onclick = () => { sync(); st.tipo = b.dataset.tipo; draw(m); }; });
    $('[data-cancel]', m).onclick = closeModal;
    $('[data-del]', m)?.addEventListener('click', async () => { if (!confirm('¿Borrar esta automatización? Lo ya apuntado se queda.')) return; try { await updateRows('Recurrentes', [{ ...r, activo: 0, nombre: `${r.nombre} (borrada)` }]); closeModal(); render(); } catch (e) { fail(e); } });
    form.onsubmit = async (e) => {
      e.preventDefault(); sync();
      if (!st.nombre.trim() || !num(st.importe) || !st.haber || !st.debe || !st.desde) { toast('Rellena nombre, importe, las dos cuentas y desde cuándo'); return; }
      if (st.haber === st.debe) { toast('Las dos cuentas no pueden ser la misma'); return; }
      const row = { ...(r || { id: uid() }), nombre: st.nombre.trim(), importe: round2(num(st.importe)), dia: Math.min(31, Math.max(1, Math.round(num(st.dia)) || 1)), haber: st.haber, debe: st.debe, clase: T.clase, desde: st.desde, hasta: st.hasta, activo: st.activo };
      const btn = $('button[type=submit]', form); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try {
        if (r) await S.store.update('Recurrentes', [row]); else await S.store.add('Recurrentes', [row]);
        await reload({ automations: true }); closeModal(); render(); if (S.autoMsg) toast(S.autoMsg, 4000);
      } catch (err) { btn.disabled = false; btn.textContent = 'Guardar'; fail(err); }
    };
  };
  openModal('', draw);
}
function editActivo(id) {
  const L = S.libro; const a = (L.db.Activos || []).find((x) => String(x.id) === String(id));
  const fields = [
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'cuenta', label: 'Tipo de bien', type: 'account', filter: (c) => kindOf(c) === 'bien', createKind: 'bien', required: true },
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
    { key: 'cuenta_banco', label: 'Se paga desde', type: 'account', filter: isMoney, required: true },
    { key: 'cuenta_pasivo', label: 'Deuda', type: 'account', filter: (c) => kindOf(c) === 'deuda', createKind: 'deuda', required: true },
    { key: 'cuenta_interes', label: 'Los intereses van a', type: 'account', filter: (c) => c.tipo === 'gasto', required: true },
    { key: 'participacion', label: 'Tu parte %', type: 'number', hint: 'Si la hipoteca es a medias con otra persona, pon 50. Se apuntará solo tu parte de cada cuota.' },
    { key: 'activo', label: 'Generar cuotas automáticamente', type: 'checkbox' },
  ];
  const cuadro = p ? cuadroPrestamo(p) : []; const fp = p ? participacion(p) : 1;
  const extra = p ? `<details class="card" style="margin-bottom:12px"><summary>Ver cuadro de amortización (${cuadro.length} cuotas)</summary><div class="tablewrap" style="margin-top:8px;max-height:280px;overflow:auto"><table class="rep"><tr><th>#</th><th>Fecha</th><th>Cuota</th>${fp < 1 ? '<th>Tu parte</th>' : ''}<th>Intereses</th><th>Capital</th><th>Pendiente</th></tr>${cuadro.map((q) => `<tr><td>${q.n}</td><td class="n">${q.fecha}</td><td class="n">${fmt(q.cuota)}</td>${fp < 1 ? `<td class="n">${fmt(q.cuota * fp)}</td>` : ''}<td class="n">${fmt(q.intereses * fp)}</td><td class="n">${fmt(q.capital * fp)}</td><td class="n">${fmt(q.pendiente * fp, 0)}</td></tr>`).join('')}</table></div></details>`
    : '<p class="hint">Pon el capital, interés y plazo de la hipoteca completa: Financito calcula tu parte. La deuda en sí métela en «Saldos iniciales» (tu parte de lo pendiente) o con un asiento libre el día que la firmes.</p>';
  formModal({
    title: p ? 'Editar préstamo' : 'Nueva hipoteca o préstamo', fields, extra,
    values: p ? { ...p, primera_cuota: normDate(p.primera_cuota), participacion: p.participacion || 100 } : { nombre: 'Hipoteca', cuenta_pasivo: '170', cuenta_interes: '662', activo: 1, participacion: 100, cuenta_banco: L.principal || L.cuentas.find(isTes)?.codigo },
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
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  // cuando se instala una versión nueva de la app, recarga una vez para usarla
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !reloaded) { reloaded = true; location.reload(); } });
}

boot();
