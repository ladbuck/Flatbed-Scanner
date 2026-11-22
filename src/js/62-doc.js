// ---------------------------------------------------------------------------
// Document view, page viewer, text (OCR) and page/document actions
// ---------------------------------------------------------------------------
function viewDoc() {
  const d = getDoc(S.docId), sel = S.select, ro = S.reorder;
  const tiles = d.pages.map((p, i) => {
    const flags = `<span class="pg-flags">${p.ocr && p.ocr.text ? '<span>TXT</span>' : ''}${p.marks && p.marks.length ? '<span>INK</span>' : ''}</span>`;
    if (ro) {
      return `<div class="page-tile"><img data-blob="${esc(p.thumb)}" alt="Page ${i + 1}"><span class="pg-num" style="top:6px;bottom:auto">${i + 1}</span>
        <div class="reorder"><button data-act="pg-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move page ${i + 1} earlier">${ic('left')}</button><button data-act="pg-move" data-i="${i}" data-d="1" ${i === d.pages.length - 1 ? 'disabled' : ''} aria-label="Move page ${i + 1} later">${ic('right')}</button></div></div>`;
    }
    const on = sel && sel.has(p.id);
    return `<button class="page-tile ${on ? 'sel' : ''}" data-act="pg-tap" data-i="${i}" aria-label="Page ${i + 1}${sel ? (on ? ', selected' : '') : ''}"><img data-blob="${esc(p.thumb)}" alt=""><span class="pg-num">${i + 1}</span>${flags}${sel ? `<span class="check">${on ? ic('check') : ''}</span>` : ''}</button>`;
  }).join('');
  const bar = sel ? `<div class="selbar"><span class="grow">${sel.size} selected</span>
      <button data-act="sel-all">${sel.size === d.pages.length ? 'None' : 'All'}</button>
      <button data-act="sel-export" ${sel.size ? '' : 'disabled'} aria-label="Export selected">${ic('share')}<span>Export</span></button>
      <button data-act="sel-extract" ${sel.size ? '' : 'disabled'} aria-label="Extract selected">${ic('scissors')}<span>Extract</span></button>
      <button data-act="sel-delete" ${sel.size ? '' : 'disabled'} aria-label="Delete selected">${ic('trash')}<span>Delete</span></button>
      <button data-act="sel-done" aria-label="Done">${ic('x')}</button></div>`
    : ro ? `<div class="selbar"><span class="grow">Reorder pages</span><button data-act="ro-done">${ic('check')}<span>Done</span></button></div>` : '';
  return `<header class="appbar"><div class="wrap doc-head">
      <button class="icon-btn" data-act="doc-back" aria-label="Back to documents">${ic('left')}</button>
      <button class="doc-title" data-act="doc-rename" aria-label="Rename document"><h1>${esc(d.title)}</h1><div class="meta">${d.pages.length} pp · ${esc(fmtDate(d.updatedAt))}${d.folder ? ' · ' + esc(d.folder) : ''}</div></button>
      <button class="icon-btn" data-act="doc-star" aria-label="${d.starred ? 'Remove star' : 'Star'}"><span class="${d.starred ? 'star-on' : ''}" style="display:grid">${ic('star')}</span></button>
      <button class="icon-btn" data-act="doc-more" aria-label="More actions">${ic('more')}</button>
    </div></header>
    <div class="wrap">${bar}
      <div class="page-grid">${tiles}${!sel && !ro ? `<button class="page-add" data-act="doc-add">${ic('plus')}<span>Add page</span></button>` : ''}</div>
    </div>
    ${!sel && !ro ? `<nav class="actionbar"><div class="actionbar-in">
      <button class="act" data-act="doc-export">${ic('share')}<span>Export</span></button>
      <button class="act" data-act="doc-sign">${ic('sign')}<span>Sign</span></button>
      <button class="act" data-act="doc-text">${ic('ocr')}<span>Text</span></button>
      <button class="act ai-only" data-act="doc-ai" ${Assist.ok ? '' : 'hidden'}>${ic('sparkle')}<span>Ask Claude</span></button>
      <button class="act" data-act="doc-select">${ic('select')}<span>Select</span></button>
      <button class="act" data-act="doc-more">${ic('more')}<span>More</span></button>
    </div></nav>` : ''}`;
}

function docMenu(d) {
  menuSheet(d.title, [
    S.tab !== 'doc' && { icon: 'file', label: 'Open', fn: () => openDoc(d.id) },
    { icon: 'share', label: 'Export or share', desc: 'PDF, JPG, PNG, Word, text', fn: () => openExport(d) },
    { icon: 'edit', label: 'Rename', fn: () => renameDoc(d) },
    { icon: 'folder', label: 'Move to folder', desc: d.folder || 'No folder', fn: () => moveToFolder(d) },
    { icon: 'star', label: d.starred ? 'Remove star' : 'Star', fn: async () => { d.starred = !d.starred; await saveDoc(d, false); Cloud.touch(d); refreshView(); } },
    S.tab === 'doc' && { icon: 'plus', label: 'Add pages', fn: () => addPagesMenu(d) },
    S.tab === 'doc' && d.pages.length > 1 && { icon: 'move', label: 'Reorder pages', fn: () => { S.reorder = true; S.select = null; render(); } },
    { icon: 'layers', label: 'Merge another document into this', fn: () => pickDoc('Merge which document?', (o) => mergeInto(d, [o]), (o) => o.id !== d.id) },
    { icon: 'copy', label: 'Duplicate', fn: () => duplicateDoc(d) },
    { icon: 'trash', label: 'Delete document', danger: true, fn: async () => {
      if (!(await confirmBox(`“${d.title}” and its ${d.pages.length} ${d.pages.length === 1 ? 'page' : 'pages'} will be deleted${Cloud.ready ? ' here and from your backup' : ''}.`, { title: 'Delete document?', ok: 'Delete', danger: true }))) return;
      await deleteDoc(d.id);
      if (S.tab === 'doc') go('home'); else refreshView();
      toast('Document deleted');
    } },
  ]);
}
function addPagesMenu(d) {
  menuSheet('Add pages', [
    { icon: 'camera', label: 'Take a photo', fn: () => startScan('add', 'camera', { docId: d.id }) },
    { icon: 'image', label: 'Choose photos', fn: () => startScan('add', 'gallery', { docId: d.id }) },
    { icon: 'pdf', label: 'Import a PDF', fn: () => importPdf({ docId: d.id }) },
  ]);
}
function renameDoc(d) {
  const s = openSheet({
    title: 'Rename',
    body: `<label class="field"><span class="field-label">Document name</span><input id="rn" class="input" value="${esc(d.title)}" autocomplete="off" maxlength="120"></label>
      ${Assist.ok ? `<div class="row"><button class="btn btn-sm" id="rn-ai">${ic('sparkle')}<span>Suggest a name</span></button><span class="note grow" id="rn-note"></span></div>` : ''}`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, fn: async () => { const v = $('#rn').value.trim(); if (!v) return false; d.title = v; await saveDoc(d); refreshView(); } }],
  });
  const inp = s.el.querySelector('#rn');
  inp.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); if (v) { d.title = v; await saveDoc(d); refreshView(); s.close(); } } });
  setTimeout(() => { if (!matchMedia('(pointer: coarse)').matches) inp.select(); }, 60);
  const b = s.el.querySelector('#rn-ai');
  if (b) b.onclick = async () => {
    b.disabled = true; const note = s.el.querySelector('#rn-note'); note.textContent = 'Reading the document…';
    try {
      const r = await Assist.suggestName(d);
      if (r && r.title) { inp.value = r.title; note.textContent = r.folder ? `Suggested folder: ${r.folder}` : ''; if (r.folder) { d._suggestFolder = r.folder; } }
      else note.textContent = 'No suggestion this time.';
    } catch (e) { note.textContent = Assist.errText(e); }
    b.disabled = false;
  };
}
function moveToFolder(d) {
  const folders = allFolders();
  menuSheet('Move to folder', [
    ...folders.map((f) => ({ icon: 'folder', label: f, desc: d.folder === f ? 'Current folder' : '', fn: async () => { d.folder = f; await saveDoc(d); refreshView(); toast(`Moved to ${f}`, { type: 'ok' }); } })),
    d._suggestFolder && !folders.includes(d._suggestFolder) && { icon: 'sparkle', label: d._suggestFolder, desc: 'Suggested by Claude', fn: async () => { d.folder = d._suggestFolder; await saveDoc(d); refreshView(); } },
    { icon: 'plus', label: 'New folder…', fn: async () => {
      const name = (await promptBox('New folder', '', { placeholder: 'e.g. Receipts', ok: 'Create', label: 'Folder name' }) || '').trim();
      if (!name) return;
      if (!S.settings.folders.includes(name)) { S.settings.folders.push(name); await saveSettings(); }
      d.folder = name; await saveDoc(d); refreshView(); toast(`Moved to ${name}`, { type: 'ok' });
    } },
    d.folder && { icon: 'x', label: 'Remove from folder', fn: async () => { d.folder = ''; await saveDoc(d); refreshView(); } },
  ]);
}
async function duplicateDoc(d) {
  await busy.run('Duplicating…', async () => {
    const pages = []; for (const p of d.pages) pages.push(await copyPage(p));
    const nd = newDoc('Copy of ' + d.title, pages, { folder: d.folder });
    await saveDoc(nd);
  });
  refreshView(); toast('Duplicated', { type: 'ok' });
}
async function mergeInto(target, others) {
  await busy.run('Merging…', async () => {
    for (const o of others) for (const p of o.pages) target.pages.push(await copyPage(p));
    await saveDoc(target);
  });
  refreshView(); toast(`Merged · now ${target.pages.length} pages`, { type: 'ok' });
}
function pickDocsMulti(title, okLabel, fn) {
  const docs = sortedDocs(S.docs);
  if (docs.length < 2) { toast('You need at least two documents to merge.'); return; }
  const chosen = [];
  const s = openSheet({
    title,
    body: `<p class="sheet-msg">Pick documents in the order you want them.</p><div class="choice-list">${docs.map((d) => `<button class="choice" data-id="${d.id}"><span class="choice-ic"><img data-blob="${esc(d.pages[0] && d.pages[0].thumb)}" alt=""></span><span class="choice-txt"><b>${esc(d.title)}</b><small>${d.pages.length} pp</small></span><span class="mono order" style="margin-left:auto;font-weight:600;color:var(--accent)"></span></button>`).join('')}</div>`,
    actions: [{ label: 'Cancel' }, { label: okLabel, primary: true, id: 'mm-ok', fn: () => { if (chosen.length < 2) { toast('Pick at least two documents.'); return false; } fn(chosen.map(getDoc)); } }],
  });
  hydrateImages(s.el);
  s.el.querySelectorAll('.choice').forEach((b) => b.onclick = () => {
    const id = b.dataset.id, i = chosen.indexOf(id);
    if (i >= 0) chosen.splice(i, 1); else chosen.push(id);
    s.el.querySelectorAll('.choice').forEach((x) => { const k = chosen.indexOf(x.dataset.id); x.querySelector('.order').textContent = k >= 0 ? `#${k + 1}` : ''; x.style.borderColor = k >= 0 ? 'var(--accent)' : ''; });
  });
}

// ------------------------------- PDF import --------------------------------
function importPdf(opts = {}) {
  pickFiles('pdf', true).then((files) => { if (files.length) importPdfFiles(files, opts); });
}
async function importPdfFiles(files, opts = {}) {
    busy.show('Opening PDF…');
    try {
      const pages = [];
      let title = files[0].name.replace(/\.pdf$/i, '');
      for (const [fi, f] of files.entries()) {
        const pdf = await PDFIn.open(f);
        const n = pdf.numPages;
        if (n > 200) throw new Error('This PDF has more than 200 pages. Split it first.');
        for (let i = 1; i <= n; i++) {
          busy.progress(i / (n + 1), `Importing ${files.length > 1 ? `file ${fi + 1} of ${files.length}, ` : ''}page ${i} of ${n}…`);
          const { canvas, ocr } = await PDFIn.renderPage(pdf, i, 2000);
          const page = await buildPage({ origBlob: await canvasToBlob(canvas, 'image/jpeg', 0.92), quad: FULL_QUAD, filter: 'original', adj: null, rot: 0 });
          if (ocr) page.ocr = ocr;
          pages.push(page);
        }
        pdf.destroy();
      }
      if (files.length > 1) title = `Merged PDF (${files.length} files)`;
      let doc;
      if (opts.docId && getDoc(opts.docId)) { doc = getDoc(opts.docId); doc.pages.push(...pages); }
      else doc = newDoc(title, pages);
      await saveDoc(doc);
      busy.hide();
      openDoc(doc.id);
      toast(`Imported ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`, { type: 'ok' });
      if (opts.then) opts.then(doc);
    } catch (e) { busy.hide(); handleErr(e); }
}

// ------------------------------- Page viewer -------------------------------
const Viewer = { docId: null, idx: 0, zoom: false };
function openViewer(docId, idx) { Viewer.docId = docId; Viewer.idx = idx; Viewer.zoom = false; openOverlay('viewer', renderViewer); }
function refreshViewer() { const o = getOverlay('viewer'); if (o) o.refresh(o); }
function viewerPage() { const d = getDoc(Viewer.docId); return d && d.pages[Viewer.idx]; }
function renderViewer(o) {
  const d = getDoc(Viewer.docId);
  if (!d || !d.pages.length) { closeOverlay('viewer'); return; }
  Viewer.idx = clamp(Viewer.idx, 0, d.pages.length - 1);
  const n = d.pages.length, i = Viewer.idx;
  o.el.innerHTML = `<header class="ov-top">
      <button class="icon-btn" data-act="vw-close" aria-label="Back">${ic('left')}</button>
      <div class="ov-title"><b>${esc(d.title)}</b><span>Page ${i + 1} of ${n}</span></div>
      <button class="icon-btn" data-act="vw-more" aria-label="More page actions">${ic('more')}</button>
    </header>
    <div class="stage" style="touch-action:auto">
      <div class="ov-view ${Viewer.zoom ? 'zoom' : ''}" id="vw-view"><div class="stage-msg" style="position:static;transform:none">Loading…</div></div>
      ${i > 0 ? `<button class="navbtn l" data-act="vw-go" data-d="-1" aria-label="Previous page">${ic('left')}</button>` : ''}
      ${i < n - 1 ? `<button class="navbtn r" data-act="vw-go" data-d="1" aria-label="Next page">${ic('right')}</button>` : ''}
    </div>
    <div class="ov-tools" style="padding-bottom:calc(10px + var(--safe-b))">
      <button class="tbtn" data-act="vw-edit">${ic('crop')}<span>Crop & look</span></button>
      <button class="tbtn" data-act="vw-rot">${ic('rotr')}<span>Rotate</span></button>
      <button class="tbtn" data-act="vw-markup">${ic('pen')}<span>Mark up</span></button>
      <button class="tbtn" data-act="vw-sign">${ic('sign')}<span>Sign</span></button>
      <button class="tbtn" data-act="vw-text">${ic('ocr')}<span>Text</span></button>
      <button class="tbtn" data-act="vw-del">${ic('trash')}<span>Delete</span></button>
    </div>`;
  const p = d.pages[i];
  renderPage(p, { maxDim: 2000 }).then((c) => {
    const v = $('#vw-view'); if (!v || viewerPage() !== p) return;
    v.innerHTML = ''; c.setAttribute('role', 'img'); c.setAttribute('aria-label', `Page ${i + 1}`); v.appendChild(c);
  }).catch(handleErr);
  const v = o.el.querySelector('#vw-view');
  let sx = 0, sy = 0, t0 = 0;
  v.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; t0 = Date.now(); });
  v.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!Viewer.zoom && Math.abs(dx) > 60 && Math.abs(dy) < 60 && Date.now() - t0 < 600) { Viewer.idx = clamp(Viewer.idx + (dx < 0 ? 1 : -1), 0, n - 1); renderViewer(o); }
  });
  v.addEventListener('dblclick', () => { Viewer.zoom = !Viewer.zoom; v.classList.toggle('zoom', Viewer.zoom); });
}
async function rotatePage(doc, page, dir = 1) {
  const W = page.pw, H = page.ph;
  await busy.run('Rotating…', async () => {
    await buildPage({ origKey: page.orig, quad: page.quad, filter: page.filter, adj: page.adj, rot: ((page.rot || 0) + dir + 4) % 4, kind: page.kind }, page);
    page.marks = rotateMarks(page.marks || [], W, H, dir);
    if (page.ocr) page.ocr.words = [];
    await refreshThumb(page);
    await saveDoc(doc);
  });
}
async function deletePages(doc, ids) {
  const keep = [], gone = [];
  for (const p of doc.pages) (ids.has(p.id) ? gone : keep).push(p);
  if (!keep.length) {
    if (!(await confirmBox('Every page would be removed, so the whole document will be deleted.', { title: 'Delete document?', ok: 'Delete', danger: true }))) return false;
    await deleteDoc(doc.id); closeAllOverlays(); go('home'); toast('Document deleted');
    return true;
  }
  doc.pages = keep;
  for (const p of gone) await deletePageBlobs(p);
  await saveDoc(doc);
  return true;
}

// ------------------------------ Text (OCR) ---------------------------------
async function runOcr(doc, pages, lang) {
  lang = lang || S.settings.ocrLang;
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const p = pages[i];
    const blob = await Store.getBlob(p.proc);
    const data = await OCR.recognize(blob, lang, (f, m) => busy.progress((i + f) / total, total > 1 ? `${m} · page ${i + 1} of ${total}` : m));
    p.ocr = ocrResultToPage(data, p.pw, p.ph, lang);
  }
  await saveDoc(doc);
}
async function ensureOcr(doc, pages, why) {
  const missing = pages.filter((p) => !p.ocr || !p.ocr.text);
  if (!missing.length) return true;
  busy.show(why || 'Reading text…');
  try { await runOcr(doc, missing); } finally { busy.hide(); }
  return true;
}
async function docTextSheet(doc, pageIdx, auto = false) {
  const pages = pageIdx == null ? doc.pages : [doc.pages[pageIdx]];
  const single = pages.length === 1;
  const missing = pages.filter((p) => !p.ocr || !p.ocr.text);
  if (missing.length) {
    busy.show('Reading text…');
    try { await runOcr(doc, missing); } catch (e) { busy.hide(); throw e; }
    busy.hide();
    refreshView();
  }
  const text = single ? pages[0].ocr.text : pages.map((p, i) => `— Page ${doc.pages.indexOf(p) + 1} —\n${(p.ocr && p.ocr.text) || ''}`).join('\n\n');
  const src = single ? pages[0].ocr.src : '';
  const langLabel = (OCR_LANGS.find((l) => l.code === S.settings.ocrLang) || {}).label || '';
  const s = openSheet({
    title: single ? `Text · page ${doc.pages.indexOf(pages[0]) + 1}` : 'Text from all pages',
    wide: true,
    body: `<textarea class="input" id="ocr-text" rows="12" style="min-height:40vh;font-size:15px" aria-label="Recognized text">${esc(text)}</textarea>
      <p class="note">${src === 'ai' ? 'Transcribed by Claude.' : src === 'pdf' ? 'Text taken from the PDF.' : `Read on this device (${esc(langLabel)}). Check names and numbers.`}${single ? ' Edits are saved with the page and used for search.' : ''}</p>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-sm" id="ocr-copy">${ic('copy')}<span>Copy</span></button>
        <button class="btn btn-sm" id="ocr-txt">${ic('download')}<span>Save .txt</span></button>
        <button class="btn btn-sm" id="ocr-docx">${ic('word')}<span>Save Word</span></button>
        <button class="btn btn-sm" id="ocr-lang">${ic('globe')}<span>Language</span></button>
        ${Assist.ok ? `<button class="btn btn-sm" id="ocr-ai">${ic('sparkle')}<span>Read with Claude</span></button>` : ''}
      </div>`,
    actions: single ? [{ label: 'Close' }, { label: 'Save edits', primary: true, fn: async () => { const v = $('#ocr-text').value; if (v !== pages[0].ocr.text) { pages[0].ocr.text = v; pages[0].ocr.edited = true; await saveDoc(doc); toast('Text saved', { type: 'ok' }); } } }] : [{ label: 'Close' }],
  });
  const ta = s.el.querySelector('#ocr-text');
  s.el.querySelector('#ocr-copy').onclick = () => copyText(ta.value);
  s.el.querySelector('#ocr-txt').onclick = () => deliverFile(safeName(doc.title) + '.txt', new Blob([ta.value], { type: 'text/plain' }));
  s.el.querySelector('#ocr-docx').onclick = () => deliverFile(safeName(doc.title) + '.docx', docxBuild([{ text: ta.value }], doc.title));
  s.el.querySelector('#ocr-lang').onclick = () => {
    s.close();
    menuSheet('Read text in…', OCR_LANGS.map((l) => ({ label: l.label, desc: l.code === S.settings.ocrLang ? 'Current' : '', fn: async () => {
      S.settings.ocrLang = l.code; await saveSettings();
      busy.show('Reading text…');
      try { await runOcr(doc, pages, l.code); } catch (e) { busy.hide(); throw e; }
      busy.hide(); refreshView(); docTextSheet(doc, pageIdx);
    } })));
  };
  const aiB = s.el.querySelector('#ocr-ai');
  if (aiB) aiB.onclick = () => { s.close(); openAI(doc, 'extract', pageIdx == null ? null : [pages[0].id]); };
}

// ------------------------------- Actions -----------------------------------
Object.assign(A, {
  'open-doc': (el) => openDoc(el.dataset.id),
  'doc-menu': (el) => docMenu(getDoc(el.dataset.id)),
  'doc-back': () => go('home'),
  'doc-more': () => docMenu(getDoc(S.docId)),
  'doc-rename': () => renameDoc(getDoc(S.docId)),
  'doc-star': async () => { const d = getDoc(S.docId); d.starred = !d.starred; await saveDoc(d, false); Cloud.touch(d); render(); },
  'doc-add': () => addPagesMenu(getDoc(S.docId)),
  'doc-export': () => openExport(getDoc(S.docId)),
  'doc-text': () => docTextSheet(getDoc(S.docId), null),
  'doc-ai': () => openAI(getDoc(S.docId)),
  'doc-sign': () => signFlow(getDoc(S.docId)),
  'doc-select': () => { S.select = new Set(); S.reorder = false; render(); },
  'pg-tap': (el) => {
    const d = getDoc(S.docId), i = +el.dataset.i;
    if (S.select) { const id = d.pages[i].id; if (S.select.has(id)) S.select.delete(id); else S.select.add(id); const st = $('#view').scrollTop; render(); $('#view').scrollTop = st; return; }
    openViewer(d.id, i);
  },
  'pg-move': async (el) => {
    const d = getDoc(S.docId), i = +el.dataset.i, j = i + (+el.dataset.d);
    if (j < 0 || j >= d.pages.length) return;
    [d.pages[i], d.pages[j]] = [d.pages[j], d.pages[i]];
    await saveDoc(d); const st = $('#view').scrollTop; render(); $('#view').scrollTop = st;
  },
  'ro-done': () => { S.reorder = false; render(); },
  'sel-all': () => { const d = getDoc(S.docId); S.select = S.select.size === d.pages.length ? new Set() : new Set(d.pages.map((p) => p.id)); render(); },
  'sel-done': () => { S.select = null; render(); },
  'sel-export': () => { const d = getDoc(S.docId); openExport(d, { pageIds: d.pages.filter((p) => S.select.has(p.id)).map((p) => p.id) }); },
  'sel-delete': async () => {
    const d = getDoc(S.docId), n = S.select.size;
    if (!(await confirmBox(`Delete ${n} ${n === 1 ? 'page' : 'pages'}?`, { title: 'Delete pages?', ok: 'Delete', danger: true }))) return;
    if (await deletePages(d, S.select)) { S.select = null; if (getDoc(d.id)) render(); }
  },
  'sel-extract': () => {
    const d = getDoc(S.docId), chosen = d.pages.filter((p) => S.select.has(p.id));
    const make = async (move) => {
      const pages = [];
      await busy.run('Creating document…', async () => {
        for (const p of chosen) pages.push(await copyPage(p));
        const nd = newDoc(`${d.title} (pages ${chosen.map((p) => d.pages.indexOf(p) + 1).join(', ')})`.slice(0, 120), pages, { folder: d.folder });
        await saveDoc(nd);
        if (move) { d.pages = d.pages.filter((p) => !S.select.has(p.id)); for (const p of chosen) await deletePageBlobs(p); await saveDoc(d); }
        S.select = null;
        openDoc(nd.id);
      });
      toast(move ? 'Pages moved to a new document' : 'Pages copied to a new document', { type: 'ok' });
    };
    menuSheet(`Extract ${chosen.length} ${chosen.length === 1 ? 'page' : 'pages'}`, [
      { icon: 'copy', label: 'Copy to a new document', desc: 'Keeps them here too', fn: () => make(false) },
      chosen.length < d.pages.length && { icon: 'scissors', label: 'Move to a new document', desc: 'Splits this document', fn: () => make(true) },
    ]);
  },
  'vw-close': () => closeOverlay('viewer'),
  'vw-go': (el) => { Viewer.idx += +el.dataset.d; refreshViewer(); },
  'vw-edit': () => { const d = getDoc(Viewer.docId); Sess.editPage(d, viewerPage()).catch(handleErr); },
  'vw-rot': async () => { const d = getDoc(Viewer.docId); await rotatePage(d, viewerPage(), 1); refreshViewer(); refreshView(); },
  'vw-markup': () => openMarkup(Viewer.docId, viewerPage().id),
  'vw-sign': () => chooseSignature().then((sig) => sig && openMarkup(Viewer.docId, viewerPage().id, { signature: sig })),
  'vw-text': () => docTextSheet(getDoc(Viewer.docId), Viewer.idx),
  'vw-del': async () => {
    const d = getDoc(Viewer.docId), p = viewerPage();
    if (d.pages.length > 1 && !(await confirmBox(`Delete page ${Viewer.idx + 1}?`, { title: 'Delete page?', ok: 'Delete', danger: true }))) return;
    if (await deletePages(d, new Set([p.id]))) { if (getDoc(d.id)) { refreshViewer(); refreshView(); } }
  },
  'vw-more': () => {
    const d = getDoc(Viewer.docId), p = viewerPage();
    menuSheet(`Page ${Viewer.idx + 1}`, [
      { icon: 'rotl', label: 'Rotate left', fn: async () => { await rotatePage(d, p, -1); refreshViewer(); refreshView(); } },
      { icon: 'camera', label: 'Retake this page', fn: () => pickFiles('camera', false).then(async (f) => {
        if (!f.length) return;
        const item = await busy.run('Finding the page…', () => makeItem(f[0]));
        Sess.s = { mode: 'edit', items: [item], idx: 0, step: 'crop', docId: d.id, pageId: p.id, adjOpen: false };
        item.origKey = null;
        Sess.open();
      }).catch(handleErr) },
      { icon: 'copy', label: 'Duplicate page', fn: async () => { const np = await copyPage(p); d.pages.splice(Viewer.idx + 1, 0, np); await saveDoc(d); Viewer.idx++; refreshViewer(); refreshView(); } },
      { icon: 'image', label: 'Save as JPG', fn: async () => { const c = await renderPage(p, { maxDim: 3000 }); deliverFile(`${safeName(d.title)}-p${Viewer.idx + 1}.jpg`, await canvasToBlob(c, 'image/jpeg', 0.92)); } },
      { icon: 'x', label: 'Clear mark-up', disabled: !(p.marks && p.marks.length), fn: async () => { for (const m of p.marks) if (m.blob) await Store.delBlob(m.blob); p.marks = []; await refreshThumb(p); await saveDoc(d); refreshViewer(); refreshView(); } },
    ]);
  },
});
