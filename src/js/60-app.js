// ---------------------------------------------------------------------------
// App state, navigation, library, tools, signatures list and settings
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  theme: 'system', filter: 'magic', autoCrop: true, quality: 'standard', pageSize: 'auto', margin: 'none',
  ocrLang: 'eng', cloud: true, layout: 'list', sort: 'updated', folders: [],
};
const FILTERS = [
  { id: 'original', label: 'Original' }, { id: 'magic', label: 'Magic Color' }, { id: 'noshadow', label: 'No Shadow' },
  { id: 'lighten', label: 'Lighten' }, { id: 'gray', label: 'Grayscale' }, { id: 'bw', label: 'B&W' },
];
const FULL_QUAD = [0, 0, 1, 0, 1, 1, 0, 1];
const isFullQuad = (q) => !q || q.every((v, i) => Math.abs(v - FULL_QUAD[i]) < 1e-4);
const STORE_MAX = 2400, STORE_JPEG = 0.9;
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M3.5 12.5h17" style="stroke:var(--accent)"/></svg>';

const S = { docs: [], settings: { ...DEFAULT_SETTINGS }, tab: 'home', folder: 'all', query: '', docId: null, select: null, reorder: false };

// ------------------------------ Documents ----------------------------------
const getDoc = (id) => S.docs.find((d) => d.id === id);
function newDoc(title, pages, extra = {}) {
  const now = Date.now();
  return { id: uid(), title: title || defaultTitle(), folder: S.folder !== 'all' && S.folder !== 'starred' ? S.folder : '', starred: false, createdAt: now, updatedAt: now, pages, ...extra };
}
async function saveDoc(doc, touch = true) {
  if (touch) doc.updatedAt = Date.now();
  if (doc.sample && touch) delete doc.sample;
  if (!S.docs.includes(doc)) S.docs.push(doc);
  await Store.putDoc(doc);
  Cloud.touch(doc);
}
function docBlobKeys(doc) {
  const k = [];
  for (const p of doc.pages) { k.push(p.orig, p.proc, p.thumb); for (const m of p.marks || []) if (m.blob) k.push(m.blob); }
  return k.filter(Boolean);
}
async function removeDocLocal(id, fromCloud = false) {
  const d = getDoc(id); if (!d) return;
  S.docs = S.docs.filter((x) => x !== d);
  await Store.delDoc(id);
  for (const k of docBlobKeys(d)) await Store.delBlob(k);
  if (fromCloud && S.docId === id) { closeAllOverlays(); S.docId = null; S.tab = 'home'; }
}
async function deleteDoc(id) {
  const d = getDoc(id); if (!d) return;
  await removeDocLocal(id);
  await Cloud.docDeleted(d);
}
async function deletePageBlobs(p) {
  for (const k of [p.orig, p.proc, p.thumb]) await Store.delBlob(k);
  for (const m of p.marks || []) if (m.blob) await Store.delBlob(m.blob);
}
async function copyPage(p) {
  const np = structuredClone(p); np.id = uid(); delete np.cloudExtra;
  for (const k of ['orig', 'proc', 'thumb']) { const b = await Store.getBlob(p[k]); np[k] = b ? await Store.putBlob(b) : null; }
  for (const m of np.marks || []) if (m.blob) { const b = await Store.getBlob(m.blob); m.blob = b ? await Store.putBlob(b) : null; }
  return np;
}
function docText(doc) { return doc.pages.map((p) => (p.ocr && p.ocr.text) || '').join('\n'); }
function allFolders() {
  const set = new Set(S.settings.folders || []);
  for (const d of S.docs) if (d.folder) set.add(d.folder);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Process a source image into a stored page (new or replacing `existing`).
async function buildPage(src, existing) {
  const origBlob = src.origBlob || await Store.getBlob(src.origKey);
  if (!origBlob) throw new Error('The original photo for this page is missing.');
  const oc = await blobToCanvas(origBlob, STORE_MAX);
  const res = await IP.run('process', { img: getImageData(oc), quad: isFullQuad(src.quad) ? null : src.quad, filter: src.filter, adj: src.adj, rot: src.rot || 0, maxDim: STORE_MAX });
  const pc = imgDataToCanvas(res);
  const procBlob = await canvasToBlob(pc, 'image/jpeg', STORE_JPEG);
  const page = existing || { id: uid(), marks: [], ocr: null };
  const old = existing ? { orig: existing.orig, proc: existing.proc, thumb: existing.thumb } : null;
  page.orig = src.origKey || await Store.putBlob(origBlob);
  page.ow = oc.width; page.oh = oc.height;
  page.quad = (src.quad || FULL_QUAD).slice(); page.filter = src.filter || 'original';
  page.adj = { b: 0, c: 0, s: 0, ...(src.adj || {}) }; page.rot = src.rot || 0;
  if (src.kind) page.kind = src.kind;
  page.proc = await Store.putBlob(procBlob); page.pw = pc.width; page.ph = pc.height;
  page.thumb = await makeThumb(page, pc);
  if (old) {
    if (old.proc && old.proc !== page.proc) await Store.delBlob(old.proc);
    if (old.thumb && old.thumb !== page.thumb) await Store.delBlob(old.thumb);
    if (old.orig && old.orig !== page.orig) await Store.delBlob(old.orig);
  }
  return page;
}
async function makeThumb(page, procCanvas) {
  const c = await renderPage(page, { maxDim: 480, procCanvas });
  return Store.putBlob(await canvasToBlob(c, 'image/jpeg', 0.75));
}
async function refreshThumb(page) {
  const old = page.thumb;
  page.thumb = await makeThumb(page);
  if (old) await Store.delBlob(old);
}

// ------------------------------ File picking -------------------------------
// Must be called synchronously inside a click handler.
function pickFiles(kind, multiple = true) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = kind === 'pdf' ? 'application/pdf,.pdf' : 'image/*';
    if (kind === 'camera') inp.setAttribute('capture', 'environment');
    inp.multiple = !!multiple;
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(inp);
    let done = false;
    const finish = (list) => { if (done) return; done = true; resolve(list); setTimeout(() => inp.remove(), 0); };
    inp.addEventListener('change', () => finish(Array.from(inp.files || [])));
    inp.addEventListener('cancel', () => finish([]));
    inp.click();
  });
}
function menuSheet(title, items, note = '') {
  const list = items.filter(Boolean);
  const s = openSheet({
    title,
    body: (note ? `<p class="sheet-msg">${esc(note)}</p>` : '') + `<div class="choice-list">${list.map((o, i) => `
      <button class="choice ${o.danger ? 'danger' : ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}>
        ${o.thumb ? `<span class="choice-ic"><img data-blob="${esc(o.thumb)}" alt=""></span>` : o.icon ? `<span class="choice-ic">${ic(o.icon)}</span>` : ''}
        <span class="choice-txt"><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span>
      </button>`).join('')}</div>`,
  });
  hydrateImages(s.el);
  s.el.querySelectorAll('.choice').forEach((b) => {
    b.onclick = () => {
      const o = list[+b.dataset.i];
      s.close();
      try { const r = o.fn && o.fn(); if (r && r.catch) r.catch(handleErr); } catch (e) { handleErr(e); }
    };
  });
  return s;
}
function sourceMenu(title, mode, opts = {}) {
  menuSheet(title, [
    { icon: 'camera', label: 'Take a photo', desc: 'Opens your camera', fn: () => startScan(mode, 'camera', opts) },
    { icon: 'image', label: 'Choose photos', desc: 'Pick one or more images', fn: () => startScan(mode, 'gallery', opts) },
  ]);
}
function startScan(mode, source, opts = {}) {
  const p = pickFiles(source === 'camera' ? 'camera' : 'gallery', true);
  p.then((files) => { if (files.length) Sess.begin(mode, files, opts).catch(handleErr); });
}
function pickDoc(title, fn, filter) {
  const docs = sortedDocs(S.docs).filter(filter || (() => true));
  if (!docs.length) { toast('Scan or import a document first.'); return; }
  menuSheet(title, docs.map((d) => ({ thumb: d.pages[0] && d.pages[0].thumb, label: d.title, desc: `${d.pages.length} pp · ${fmtDate(d.updatedAt)}`, fn: () => fn(d) })));
}

// ------------------------------- Errors ------------------------------------
function handleErr(err) {
  console.error(err);
  busy.n = 0; $('#busy').hidden = true;
  if (err && err.message === 'Cancelled') return;
  toast((err && err.message) || 'Something went wrong. Please try again.', { type: 'err' });
}
window.addEventListener('unhandledrejection', (e) => { console.warn('Unhandled', e.reason); });

// ------------------------------ Navigation ---------------------------------
function go(tab) {
  S.tab = tab;
  if (tab !== 'doc') { S.docId = null; S.select = null; S.reorder = false; }
  render();
  $('#view').scrollTop = 0;
}
function openDoc(id) { S.docId = id; S.select = null; S.reorder = false; go('doc'); }
function render() {
  const v = $('#view');
  const tab = S.tab;
  $('#tabbar').hidden = tab === 'doc';
  if (tab === 'doc' && !getDoc(S.docId)) { S.tab = 'home'; return render(); }
  v.innerHTML = tab === 'home' ? viewHome() : tab === 'tools' ? viewTools() : tab === 'sigs' ? viewSigs() : tab === 'settings' ? viewSettings() : viewDoc();
  $$('#tabbar .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  hydrateImages(v);
  renderCloudChip();
  if (tab === 'home') bindHome();
  if (tab === 'sigs') renderSigList();
  if (tab === 'settings') bindSettings();
}
function tabbarHTML() {
  return `<button class="tab" data-act="tab" data-tab="home">${ic('home')}<span>Docs</span></button>
    <button class="tab" data-act="tab" data-tab="tools">${ic('tools')}<span>Tools</span></button>
    <button class="tab-scan" data-act="scan" aria-label="Scan with camera">${ic('camera')}</button>
    <button class="tab" data-act="tab" data-tab="sigs">${ic('sign')}<span>Signatures</span></button>
    <button class="tab" data-act="tab" data-tab="settings">${ic('sliders')}<span>Settings</span></button>`;
}
function refreshView() {
  if (!$('#view')) return;
  const a = document.activeElement;
  if (S.tab === 'home' && a && a.id === 'q') { $('#doc-list-wrap').innerHTML = docListHTML(); hydrateImages($('#doc-list-wrap')); renderCloudChip(); refreshOverlay(); return; }
  const st = $('#view').scrollTop; render(); $('#view').scrollTop = st; refreshOverlay();
}

// --------------------------------- Home ------------------------------------
function sortedDocs(list) {
  const s = S.settings.sort;
  return list.slice().sort((a, b) => s === 'name' ? a.title.localeCompare(b.title) : s === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
}
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();
function filteredDocs() {
  let list = S.docs;
  if (S.folder === 'starred') list = list.filter((d) => d.starred);
  else if (S.folder !== 'all') list = list.filter((d) => d.folder === S.folder);
  const q = norm(S.query).trim();
  if (q) list = list.filter((d) => norm(d.title).includes(q) || norm(docText(d)).includes(q));
  return sortedDocs(list);
}
function snippetFor(doc) {
  const q = norm(S.query).trim();
  if (!q || norm(doc.title).includes(q)) return '';
  const text = docText(doc).replace(/\s+/g, ' ');
  const i = norm(text).indexOf(q);
  if (i < 0) return '';
  const a = Math.max(0, i - 40), b = Math.min(text.length, i + q.length + 60);
  return (a > 0 ? '…' : '') + esc(text.slice(a, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, b)) + (b < text.length ? '…' : '');
}
function docCard(d) {
  const snip = snippetFor(d);
  return `<article class="doc-card" data-act="open-doc" data-id="${d.id}" tabindex="0" role="button" aria-label="Open ${esc(d.title)}">
    <div class="doc-thumb"><img data-blob="${esc(d.pages[0] ? d.pages[0].thumb : '')}" alt=""><span class="pp-badge">${d.pages.length}</span></div>
    <div class="doc-info">
      <h3>${esc(d.title)}</h3>
      <div class="meta">${d.starred ? `<span class="star-on" title="Starred">${ic('star')}</span>` : ''}<span>${d.pages.length} pp</span><span>${esc(fmtDate(d.updatedAt))}</span>${d.folder ? `<span class="tag">${esc(d.folder)}</span>` : ''}${d.sample ? '<span class="tag tag-sample">Sample</span>' : ''}</div>
      ${snip ? `<p class="snippet">${snip}</p>` : ''}
    </div>
    <button class="icon-btn" data-act="doc-menu" data-id="${d.id}" aria-label="More for ${esc(d.title)}">${ic('more')}</button>
  </article>`;
}
function docListHTML() {
  const docs = filteredDocs();
  if (!S.docs.length) {
    return `<div class="empty">
      <svg class="empty-art" viewBox="0 0 120 120" fill="none" aria-hidden="true"><rect x="30" y="14" width="60" height="80" rx="4" fill="var(--sheet)" stroke="var(--rule)" stroke-width="2"/><path d="M40 34h40M40 44h40M40 54h28M40 64h34" stroke="var(--rule)" stroke-width="3" stroke-linecap="round"/><path d="M18 58h84" stroke="var(--accent)" stroke-width="3"/><path d="M22 22v-8h8M98 22v-8h-8M22 98v8h8M98 98v8h-8" stroke="var(--ink)" stroke-width="3"/></svg>
      <h2>No scans yet</h2><p>Scan paper with your camera, or bring in photos and PDFs you already have.</p>
      <div class="row"><button class="btn btn-primary" data-act="q-scan">${ic('camera')}<span>Scan a document</span></button><button class="btn" data-act="q-import">${ic('image')}<span>Import</span></button></div>
    </div>`;
  }
  const pages = docs.reduce((n, d) => n + d.pages.length, 0);
  const sortLabel = { updated: 'Last edited', created: 'Date created', name: 'Name' }[S.settings.sort];
  return `<div class="list-head"><span class="mono">${docs.length} ${docs.length === 1 ? 'doc' : 'docs'} · ${pages} pp</span><span class="grow"></span>
      <button class="btn btn-sm" data-act="sort" style="border:0;background:none">${ic('sort')}<span>${sortLabel}</span></button>
      <button class="icon-btn" data-act="layout" aria-label="${S.settings.layout === 'grid' ? 'Show as list' : 'Show as grid'}">${ic(S.settings.layout === 'grid' ? 'list' : 'grid')}</button></div>
    ${docs.length ? `<div class="doc-list ${S.settings.layout === 'grid' ? 'grid' : ''}">${docs.map(docCard).join('')}</div>`
      : `<div class="empty"><h2>Nothing here</h2><p>${S.query ? 'No document names or scanned text match your search.' : 'This folder is empty.'}</p></div>`}`;
}
function viewHome() {
  const folders = allFolders();
  const count = (f) => S.docs.filter(f).length;
  return `<header class="appbar"><div class="wrap appbar-in">
      <div class="brand"><span class="brand-mark">${LOGO}</span><span class="brand-name">Flatbed</span></div>
      <button class="cloud-chip" id="cloud-chip" data-act="cloud-info"></button>
    </div></header>
    <div class="wrap">
      <label class="search">${ic('search')}<input id="q" type="search" placeholder="Search names and text in scans" value="${esc(S.query)}" aria-label="Search documents" enterkeyhint="search"></label>
      <div class="quick">
        <button data-act="q-scan">${ic('camera')}<span>Scan</span></button>
        <button data-act="q-import">${ic('image')}<span>Import photos</span></button>
        <button data-act="q-pdf">${ic('pdf')}<span>Import PDF</span></button>
        <button data-act="q-id">${ic('idcard')}<span>ID card</span></button>
        <button data-act="q-ocr">${ic('ocr')}<span>Image to text</span></button>
        <button data-act="q-qr">${ic('qr')}<span>QR code</span></button>
      </div>
      <div class="chips" role="group" aria-label="Folders">
        <button class="chip ${S.folder === 'all' ? 'on' : ''}" data-act="folder" data-f="all">All <span class="count">${S.docs.length}</span></button>
        <button class="chip ${S.folder === 'starred' ? 'on' : ''}" data-act="folder" data-f="starred">${ic('star')}Starred <span class="count">${count((d) => d.starred)}</span></button>
        ${folders.map((f) => `<button class="chip ${S.folder === f ? 'on' : ''}" data-act="folder" data-f="${esc(f)}">${ic('folder')}${esc(f)} <span class="count">${count((d) => d.folder === f)}</span></button>`).join('')}
        <button class="chip" data-act="folder-new">${ic('plus')}Folder</button>
      </div>
      <div id="doc-list-wrap">${docListHTML()}</div>
    </div>`;
}
function bindHome() {
  const q = $('#q');
  if (q) q.addEventListener('input', debounce(() => { S.query = q.value; $('#doc-list-wrap').innerHTML = docListHTML(); hydrateImages($('#doc-list-wrap')); }, 120));
}

// ------------------------------ Cloud chip ---------------------------------
function renderCloudChip() {
  const el = $('#cloud-chip'); if (!el) return;
  const st = S.settings.cloud === false && Cloud.col ? 'off' : Cloud.state;
  const map = {
    off: ['cloudoff', 'Backup off', ''], unavailable: ['cloudoff', 'On this device', ''], connecting: ['cloud', 'Connecting…', 'busy'],
    ready: ['cloud', 'Backed up', 'ok'], syncing: ['cloud', 'Syncing…', 'busy'], error: ['cloudoff', 'Backup paused', 'warn'],
  };
  const [icn, label, cls] = map[st] || map.unavailable;
  el.className = 'cloud-chip ' + cls;
  el.innerHTML = ic(icn) + `<span>${label}</span>`;
  el.setAttribute('aria-label', 'Backup status: ' + label);
}
async function cloudInfo() {
  const usage = await Cloud.usage();
  const st = Cloud.state;
  const on = S.settings.cloud !== false;
  let msg;
  if (st === 'unavailable') msg = Cloud.note || 'Cloud backup is not available here. Your scans are saved in this browser.';
  else if (!on) msg = 'Backup is turned off. Scans are kept only in this browser.';
  else if (st === 'error') msg = Cloud.note;
  else msg = 'Your scans are backed up privately to your Claude account and sync to this app on your other devices.' + (Cloud.lastSync ? ` Last sync ${new Date(Cloud.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '');
  const local = Store.persistent ? '' : '<p class="note warn">This browser blocks local storage, so scans live only in this tab until they are backed up.</p>';
  const meter = usage ? `<div><div class="row"><span class="grow note">Cloud storage</span><span class="mono note">${fmtBytes(usage.bytes)} of ${fmtBytes(usage.maxBytes)}</span></div><div class="meter"><i style="width:${Math.min(100, (usage.bytes / Math.max(1, usage.maxBytes)) * 100).toFixed(1)}%"></i></div></div>` : '';
  openSheet({
    title: 'Backup & sync',
    body: `<p class="sheet-msg">${esc(msg)}</p>${local}${meter}
      ${Cloud.col ? `<div class="toggle-row"><div class="grow"><b>Back up to the cloud</b><small>Keeps a private copy of every scan</small></div><label class="switch"><input type="checkbox" id="cloud-on" ${on ? 'checked' : ''}><span></span></label></div>` : ''}`,
    actions: Cloud.col && on ? [{ label: 'Close' }, { label: 'Sync now', primary: true, icon: 'refresh', fn: () => { Cloud.syncAll().then(() => toast('Everything is backed up', { type: 'ok' })).catch(handleErr); } }] : [{ label: 'Close' }],
  });
  const t = $('#cloud-on');
  if (t) t.onchange = async () => { S.settings.cloud = t.checked; await saveSettings(); renderCloudChip(); if (t.checked) Cloud.syncAll().catch(() => {}); };
}

// --------------------------------- Tools -----------------------------------
function toolTile(act, icon, title, desc, ai = false) {
  return `<button class="tool ${ai ? 'ai' : ''}" data-act="${act}"><span class="tool-ic">${ic(icon)}</span><b>${esc(title)}</b><small>${esc(desc)}</small></button>`;
}
function viewTools() {
  return `<header class="appbar"><div class="wrap appbar-in"><h1 class="page-title" style="flex:1">Tools</h1></div></header>
  <div class="wrap">
    <section class="section"><h2 class="section-title">Scan</h2><div class="tools-grid">
      ${toolTile('q-scan', 'camera', 'Scan document', 'Auto edges, batch pages')}
      ${toolTile('q-import', 'image', 'Import photos', 'Turn pictures into scans')}
      ${toolTile('q-id', 'idcard', 'ID card', 'Front and back on one page')}
      ${toolTile('t-book', 'book', 'Book scan', 'Splits a spread into 2 pages')}
      ${toolTile('q-qr', 'qr', 'QR & barcode', 'Read codes from a photo')}
    </div></section>
    <section class="section"><h2 class="section-title">Convert</h2><div class="tools-grid">
      ${toolTile('q-ocr', 'ocr', 'Image to text', 'English, नेपाली, हिन्दी')}
      ${toolTile('t-pdf2word', 'word', 'PDF to Word', 'Editable .docx with text')}
      ${toolTile('t-img2pdf', 'pdf', 'Images to PDF', 'Combine photos into a PDF')}
      ${toolTile('q-pdf', 'download', 'PDF to images', 'Import a PDF, export JPG/PNG')}
      ${toolTile('t-long', 'longimg', 'Long image', 'Stitch pages into one picture')}
    </div></section>
    <section class="section"><h2 class="section-title">Edit & secure</h2><div class="tools-grid">
      ${toolTile('t-sign', 'sign', 'Sign a document', 'Place your saved signature')}
      ${toolTile('t-annotate', 'pen', 'Mark up', 'Pen, highlighter, text, white-out')}
      ${toolTile('t-merge', 'layers', 'Merge', 'Join documents or PDFs')}
      ${toolTile('t-split', 'scissors', 'Split & extract', 'Pull pages into a new doc')}
      ${toolTile('t-protect', 'lock', 'Password PDF', 'AES-256 encryption')}
      ${toolTile('t-watermark', 'drop', 'Watermark', 'Your own text, tiled or centred')}
    </div></section>
    ${IN_CLAUDE ? `<section class="section" id="ai-tools"><h2 class="section-title">Ask Claude</h2>
      <div class="tools-grid">
        ${toolTile('t-ai-sum', 'list', 'Summarize', 'Key facts, dates and amounts', true)}
        ${toolTile('t-ai-tr', 'globe', 'Translate', 'Into English, नेपाली and more', true)}
        ${toolTile('t-ai-ask', 'chat', 'Ask a document', 'Questions about your scan', true)}
        ${toolTile('t-ai-hand', 'sparkle', 'Handwriting to text', 'Reads messy or mixed-language pages', true)}
      </div>
      <p class="note" id="ai-note" ${Assist.ok ? 'hidden' : ''} style="margin-top:10px">These tools use your Claude account. ${Assist.checked ? 'They are not available in this view.' : 'Checking availability…'}</p>
    </section>` : ''}
  </div>`;
}

// ------------------------------ Signatures ---------------------------------
function viewSigs() {
  return `<header class="appbar"><div class="wrap appbar-in"><h1 class="page-title" style="flex:1">Signatures</h1></div></header>
  <div class="wrap">
    <p class="note">Draw once, then drop it onto any page. Signatures are saved as transparent images.</p>
    <div class="row" style="margin:14px 0 16px;flex-wrap:wrap">
      <button class="btn btn-primary" data-act="sig-new">${ic('pen')}<span>Draw a signature</span></button>
      <button class="btn" data-act="sig-photo">${ic('camera')}<span>From a photo</span></button>
    </div>
    <div class="sig-list" id="sig-list"></div>
  </div>`;
}
async function renderSigList() {
  const el = $('#sig-list'); if (!el) return;
  const sigs = await Store.getKV('sigs', []);
  el.innerHTML = sigs.length ? sigs.map((s) => `<div class="sig-card"><div class="sig-img"><img data-blob="${esc(s.key)}" alt="Saved signature"></div>
      <button class="icon-btn" data-act="sig-del" data-id="${s.id}" aria-label="Delete signature">${ic('trash')}</button></div>`).join('')
    : `<div class="empty" style="grid-column:1/-1;padding:24px"><p>No saved signatures yet.</p></div>`;
  hydrateImages(el);
}

// ------------------------------- Settings ----------------------------------
async function saveSettings() { await Store.setKV('settings', S.settings); }
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function selectHTML(key, opts) {
  return `<select class="select" data-set="${key}" id="set-${key}" aria-label="${esc(key)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(S.settings[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function switchHTML(key) {
  return `<label class="switch"><input type="checkbox" data-set="${key}" id="set-${key}" ${S.settings[key] ? 'checked' : ''}><span></span></label>`;
}
function viewSettings() {
  return `<header class="appbar"><div class="wrap appbar-in"><h1 class="page-title" style="flex:1">Settings</h1></div></header>
  <div class="wrap">
    <section class="section"><h2 class="section-title">Scanning</h2><div class="card">
      <div class="set-row"><div class="grow"><b>Find page edges</b><small>Crops to the paper automatically</small></div>${switchHTML('autoCrop')}</div>
      <div class="set-row"><div class="grow"><b>Default look</b><small>Applied to new scans</small></div>${selectHTML('filter', FILTERS.map((f) => [f.id, f.label]))}</div>
      <div class="set-row"><div class="grow"><b>Text language</b><small>For Image to text and searchable PDFs</small></div>${selectHTML('ocrLang', OCR_LANGS.map((l) => [l.code, l.label]))}</div>
    </div></section>
    <section class="section"><h2 class="section-title">Export</h2><div class="card">
      <div class="set-row"><div class="grow"><b>PDF page size</b></div>${selectHTML('pageSize', [['auto', 'Fit to image'], ['a4', 'A4 · 210 × 297 mm'], ['letter', 'Letter · 8.5 × 11 in'], ['legal', 'Legal · 8.5 × 14 in']])}</div>
      <div class="set-row"><div class="grow"><b>Margins</b></div>${selectHTML('margin', [['none', 'None'], ['small', 'Small · 6 mm'], ['wide', 'Wide · 15 mm']])}</div>
      <div class="set-row"><div class="grow"><b>Quality</b><small>Smaller files are easier to email</small></div>${selectHTML('quality', [['small', 'Small file'], ['standard', 'Standard'], ['high', 'High']])}</div>
    </div></section>
    <section class="section"><h2 class="section-title">Appearance</h2><div class="card">
      <div class="set-row"><div class="grow"><b>Theme</b></div>${selectHTML('theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']])}</div>
    </div></section>
    <section class="section"><h2 class="section-title">Storage</h2><div class="card">
      <button class="set-row" data-act="cloud-info" style="width:100%;text-align:left">${ic('cloud', 'lead')}<div class="grow"><b>Backup & sync</b><small id="set-cloud-state">…</small></div>${ic('right')}</button>
      <div class="set-row">${ic('folder', 'lead')}<div class="grow"><b>On this device</b><small id="set-local">…</small></div></div>
      <button class="set-row" data-act="wipe" style="width:100%;text-align:left;color:var(--danger)">${ic('trash', 'lead')}<div class="grow"><b>Delete all scans</b><small>Removes every document and signature</small></div></button>
    </div></section>
    <section class="section"><h2 class="section-title">About</h2><div class="card"><div class="set-row"><div class="grow"><b>Flatbed Scanner ${APP_VERSION}</b><small>Edge detection, perspective correction, scan looks, OCR, signatures, password PDFs and Word export${IN_CLAUDE ? ', plus cloud backup inside Claude' : ''}. Everything runs in your browser; scans never leave your device unless you export them${IN_CLAUDE ? ', back them up or ask Claude about them' : ''}.</small></div></div></div></section>
  </div>`;
}
async function bindSettings() {
  $$('[data-set]').forEach((el) => {
    el.addEventListener('change', async () => {
      const k = el.dataset.set;
      S.settings[k] = el.type === 'checkbox' ? el.checked : el.value;
      await saveSettings();
      if (k === 'theme') applyTheme();
      toast('Saved', { type: 'ok', ms: 1200 });
    });
  });
  const st = $('#set-cloud-state');
  if (st) st.textContent = { ready: 'On · backed up', syncing: 'Syncing…', connecting: 'Connecting…', error: 'Paused', unavailable: 'Not available here', off: 'Off' }[S.settings.cloud === false && Cloud.col ? 'off' : Cloud.state] || '';
  const est = await Store.usage();
  const loc = $('#set-local');
  if (loc) loc.textContent = `${S.docs.length} docs · ${S.docs.reduce((n, d) => n + d.pages.length, 0)} pages` + (est && est.usage ? ` · ${fmtBytes(est.usage)} used` : '') + (Store.persistent ? '' : ' · not saved after closing');
}

// ------------------------------ Sample doc ---------------------------------
async function makeSampleDoc() {
  try { await withTimeout(document.fonts.ready, 3000); } catch (e) { /* draw with fallbacks */ }
  const W = 1240, H = 1754, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#fbfbf8'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#14171a';
  x.font = '800 74px "Schibsted Grotesk", Arial, sans-serif'; x.fillText('Welcome to Flatbed', 110, 210);
  x.fillStyle = '#2a44f0'; x.fillRect(110, 250, 220, 8);
  x.fillStyle = '#2b2f35'; x.font = '400 38px "IBM Plex Sans", Arial, sans-serif';
  const lines = [
    'This is a sample page so you can try things out.',
    '',
    '1.  Tap the blue camera button to scan paper.',
    '     Edges are found and straightened for you.',
    '2.  Pick a look: Magic Color, No Shadow, B&W …',
    '3.  Mark up pages and add your signature.',
    '4.  Tap Text to copy the words on any page.',
    '5.  Export a PDF with a password, or JPG, PNG,',
    '     Word and plain text.',
    '',
    'Invoice no. 2026-0142        Total NPR 9,214.00',
    'Due date: 30 November 2026',
  ];
  lines.forEach((l, i) => x.fillText(l, 110, 360 + i * 64));
  x.font = '500 30px "IBM Plex Mono", monospace'; x.fillStyle = '#5a6068';
  x.fillText('Delete this sample any time from the ⋮ menu.', 110, H - 150);
  const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  const page = await buildPage({ origBlob: blob, quad: FULL_QUAD, filter: 'original', adj: null, rot: 0 });
  const doc = newDoc('Sample · Getting started', [page], { sample: true, folder: '' });
  S.docs.push(doc);
  await Store.putDoc(doc);
}
