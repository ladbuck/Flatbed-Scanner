'use strict';
// ---------------------------------------------------------------------------
// Utilities, icons, dialogs, toasts, busy overlay
// ---------------------------------------------------------------------------
const APP_VERSION = '1.4';
const A = {}; // click actions, keyed by data-act
// True when the page runs inside Claude (artifact), where backup, AI and downloads capabilities exist.
const IN_CLAUDE = !!(window.claude && typeof window.claude.use === 'function');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const absUrl = (p) => new URL(p, document.baseURI).href;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fmtDate(t) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const opts = d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
  return d.toLocaleDateString([], opts);
}
function defaultTitle(prefix = 'Scan') {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
function safeName(s) { return String(s || 'scan').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'scan'; }
function withTimeout(p, ms, msg = 'Timed out') {
  let t; return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]);
}
const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => { delete scriptCache[src]; rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[src];
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ------------------------------- Icons -------------------------------------
const ICONS = {
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
  pdf: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  word: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M8.5 12l1.3 5 1.7-3.6 1.7 3.6 1.3-5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M3 12h18"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  rotl: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  rotr: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  wand: '<path d="M4 20L15 9"/><path d="M14 3.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6z"/>',
  ocr: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8.5 9h7M12 9v7"/>',
  type: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  pen: '<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>',
  marker: '<path d="M9 11l-5 5v4h4l5-5"/><path d="M9 11l6-6 4 4-6 6z"/><path d="M14 20h6"/>',
  box: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  eraser: '<path d="M8 20h12"/><path d="M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8z"/><path d="M9 11l5 5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  sign: '<path d="M3 17c3-7 5-10 6-9s-3 9-1 9 3-5 5-5-1 5 1 5 3-2 4-3"/><path d="M3 21h18"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  share: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4"/><path d="M14 10h4M14 14h3"/>',
  book: '<path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z"/>',
  cloudoff: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z"/><path d="M3 3l18 18"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 6h5M12 10h7.5M12 14h7.5M12 18h5"/>',
  sharpen: '<path d="M12 3l8 15H4z"/><path d="M12 9v5"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
  longimg: '<rect x="7" y="2" width="10" height="20" rx="1.5"/><path d="M7 9h10M7 15h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r=".8"/><circle cx="5" cy="12" r=".8"/><circle cx="5" cy="18" r=".8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  zip: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M10 6h1M10 9h1M10 12h1M9.5 15h2v3h-2z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  tools: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13v7M13 16.5h7"/>',
  stamp: '<path d="M9 4h6l-1 7h3l1 4H6l1-4h3z"/><path d="M5 19h14"/>',
};
function ic(name, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`; }

// ------------------------------- Toasts ------------------------------------
function toast(msg, opts = {}) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.type ? ' toast-' + opts.type : '');
  el.setAttribute('role', opts.type === 'err' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(msg)}</span>` + (opts.action ? `<button class="toast-btn">${esc(opts.action.label)}</button>` : '');
  if (opts.action) el.querySelector('button').onclick = () => { el.remove(); opts.action.fn(); };
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, opts.ms || (opts.type === 'err' ? 5200 : 2800));
}

// ----------------------------- Busy overlay --------------------------------
const busy = {
  n: 0,
  show(msg) {
    this.n++;
    const el = $('#busy');
    el.hidden = false;
    $('#busy-msg').textContent = msg || 'Working…';
    $('#busy-bar').style.width = '0%';
    $('#busy-bar').parentElement.hidden = true;
  },
  progress(p, msg) {
    if (msg) $('#busy-msg').textContent = msg;
    const bar = $('#busy-bar'); bar.parentElement.hidden = false;
    bar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  },
  hide() { this.n = Math.max(0, this.n - 1); if (!this.n) $('#busy').hidden = true; },
  async run(msg, fn) { this.show(msg); try { return await fn(); } finally { this.hide(); } },
};

// ------------------------------- Sheets ------------------------------------
const sheetStack = [];
function openSheet({ title, body = '', actions = [], cls = '', onClose, wide = false }) {
  const root = $('#sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  const tid = 'st-' + uid();
  wrap.innerHTML = `<div class="sheet ${wide ? 'sheet-wide' : ''} ${cls}" role="dialog" aria-modal="true" aria-labelledby="${tid}">
    <header class="sheet-head"><h2 id="${tid}">${esc(title || '')}</h2><button class="icon-btn sheet-x" aria-label="Close">${ic('x')}</button></header>
    <div class="sheet-body">${body}</div>
    ${actions.length ? `<footer class="sheet-foot">${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}" data-i="${i}" ${a.id ? `id="${a.id}"` : ''}>${a.icon ? ic(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}</footer>` : ''}
  </div>`;
  let closed = false;
  const api = {
    el: wrap.querySelector('.sheet'),
    body: wrap.querySelector('.sheet-body'),
    close(result) {
      if (closed) return; closed = true;
      wrap.classList.add('out');
      const i = sheetStack.indexOf(api); if (i >= 0) sheetStack.splice(i, 1);
      setTimeout(() => wrap.remove(), 180);
      if (onClose) onClose(result);
    },
  };
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) wrap._down = true; });
  wrap.addEventListener('click', (e) => { if (e.target === wrap && wrap._down) api.close(); wrap._down = false; });
  wrap.querySelector('.sheet-x').onclick = () => api.close();
  wrap.querySelectorAll('.sheet-foot button').forEach((b) => {
    b.onclick = async () => {
      const a = actions[+b.dataset.i];
      if (a.fn) { const r = await a.fn(api); if (r === false) return; }
      if (!a.keepOpen) api.close(a.value);
    };
  });
  root.appendChild(wrap);
  sheetStack.push(api);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    const f = wrap.querySelector('[autofocus]') || wrap.querySelector('.sheet-body input, .sheet-body textarea, .sheet-body select');
    if (f && !matchMedia('(pointer: coarse)').matches) f.focus();
  });
  return api;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetStack.length) { e.preventDefault(); sheetStack[sheetStack.length - 1].close(); }
});

function confirmBox(message, { title = 'Are you sure?', ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    openSheet({
      title, body: `<p class="sheet-msg">${esc(message)}</p>`,
      actions: [{ label: cancel, value: false }, { label: ok, primary: !danger, danger, value: true }],
      onClose: (v) => resolve(!!v),
    });
  });
}
function promptBox(title, value = '', { placeholder = '', ok = 'Save', type = 'text', label = '', multiline = false, extra = '' } = {}) {
  return new Promise((resolve) => {
    const id = 'pr-' + uid();
    const field = multiline
      ? `<textarea id="${id}" class="input" rows="5" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>`
      : `<input id="${id}" class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus>`;
    let result = null;
    const s = openSheet({
      title, body: `<label class="field"><span class="field-label">${esc(label)}</span>${field}</label>${extra}`,
      actions: [{ label: 'Cancel' }, { label: ok, primary: true, fn: () => { result = $('#' + id).value; } }],
      onClose: () => resolve(result),
    });
    const inp = s.el.querySelector('#' + id);
    if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); result = inp.value; s.close(); } });
    if (!multiline && type === 'text') setTimeout(() => inp.select && inp.select(), 50);
  });
}
function chooseBox(title, options, { note = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const body = (note ? `<p class="sheet-msg">${esc(note)}</p>` : '') + `<div class="choice-list">${options.map((o, i) => `
      <button class="choice ${o.danger ? 'danger' : ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}>
        ${o.icon ? `<span class="choice-ic">${ic(o.icon)}</span>` : ''}
        <span class="choice-txt"><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span>
      </button>`).join('')}</div>`;
    const s = openSheet({ title, body, onClose: () => resolve(result) });
    s.el.querySelectorAll('.choice').forEach((b) => { b.onclick = () => { result = options[+b.dataset.i].value; s.close(); }; });
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', { type: 'ok' }); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
    toast(ok ? 'Copied to clipboard' : 'Copy was blocked here. Select the text and copy it manually.', { type: ok ? 'ok' : 'err' });
    return ok;
  }
}
