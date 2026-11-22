// ---------------------------------------------------------------------------
// Global actions, QR, drag-and-drop/paste import, and start-up
// ---------------------------------------------------------------------------
async function qrFromFile(file) {
  const res = await busy.run('Looking for a code…', () => decodeCodes(file));
  if (!res.length) { toast('No QR code or barcode found. Try a closer, sharper photo.', { type: 'err' }); return; }
  const r = res[0], isUrl = /^https?:\/\/\S+$/i.test(r.text.trim());
  const fmt = String(r.format || 'qr_code').replace(/_/g, ' ').toUpperCase();
  openSheet({
    title: 'Code found',
    body: `<p class="note mono">${esc(fmt)}</p><div class="textout" style="min-height:0">${esc(r.text)}</div>
      ${isUrl ? `<a class="btn btn-primary" href="${esc(r.text.trim())}" target="_blank" rel="noopener noreferrer">${ic('globe')}<span>Open link</span></a><p class="note">Check the address above before you open it.</p>` : ''}`,
    actions: [{ label: 'Close' }, { label: 'Copy', icon: 'copy', fn: () => copyText(r.text) }],
  });
}
function codeMenu() {
  menuSheet('Scan a QR code or barcode', [
    { icon: 'camera', label: 'Take a photo', fn: () => pickFiles('camera', false).then((f) => f.length && qrFromFile(f[0])).catch(handleErr) },
    { icon: 'image', label: 'Choose a photo', fn: () => pickFiles('gallery', false).then((f) => f.length && qrFromFile(f[0])).catch(handleErr) },
  ]);
}
function importFiles(files) {
  const imgs = files.filter((f) => /^image\//.test(f.type));
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (imgs.length) Sess.begin(S.tab === 'doc' ? 'add' : 'doc', imgs, { docId: S.docId }).catch(handleErr);
  else if (pdfs.length) importPdfFiles(pdfs, { docId: S.tab === 'doc' ? S.docId : null });
}
function needDoc(fn, filter, title = 'Choose a document') { pickDoc(title, fn, filter); }
function needAI(fn) { if (!Assist.ok) { toast(Assist.checked ? 'Ask Claude isn’t available in this view.' : 'Still connecting to Claude. Try again in a moment.'); return; } fn(); }

Object.assign(A, {
  tab: (el) => go(el.dataset.tab),
  scan: () => startScan('doc', 'camera'),
  'q-scan': () => startScan('doc', 'camera'),
  'q-import': () => startScan('doc', 'gallery'),
  'q-pdf': () => importPdf(),
  'q-id': () => sourceMenu('ID card · front side first', 'id'),
  'q-ocr': () => sourceMenu('Image to text', 'ocr'),
  'q-qr': () => codeMenu(),
  'cloud-info': () => cloudInfo(),
  folder: (el) => { S.folder = el.dataset.f; render(); },
  'folder-new': async () => {
    const name = (await promptBox('New folder', '', { placeholder: 'e.g. Receipts', ok: 'Create', label: 'Folder name' }) || '').trim();
    if (!name) return;
    if (!S.settings.folders.includes(name)) { S.settings.folders.push(name); await saveSettings(); }
    S.folder = name; render();
  },
  sort: () => menuSheet('Sort by', [['updated', 'Last edited'], ['created', 'Date created'], ['name', 'Name']].map(([v, l]) => ({ icon: S.settings.sort === v ? 'check' : 'sort', label: l, fn: async () => { S.settings.sort = v; await saveSettings(); render(); } }))),
  layout: async () => { S.settings.layout = S.settings.layout === 'grid' ? 'list' : 'grid'; await saveSettings(); render(); },
  wipe: async () => {
    if (!S.docs.length) { toast('There are no scans to delete.'); return; }
    if (!(await confirmBox(`All ${S.docs.length} documents and your saved signatures will be deleted${Cloud.ready ? ', including the backup copies' : ''}. This can’t be undone.`, { title: 'Delete all scans?', ok: 'Delete everything', danger: true }))) return;
    await busy.run('Deleting…', async () => {
      for (const d of S.docs.slice()) await deleteDoc(d.id);
      const sigs = await Store.getKV('sigs', []);
      for (const sg of sigs) { await Cloud.sigDeleted(sg); await Store.delBlob(sg.key); }
      await Store.setKV('sigs', []);
    });
    S.folder = 'all'; render(); toast('All scans deleted');
  },
  // Tools
  't-book': () => sourceMenu('Book scan · photograph both pages', 'book'),
  't-pdf2word': () => importPdf({ then: (doc) => openExport(doc, { fmt: 'docx' }) }),
  't-img2pdf': () => { const p = pickFiles('gallery', true); p.then((f) => f.length && Sess.begin('doc', f, { after: 'export' })).catch(handleErr); },
  't-long': () => needDoc((d) => openExport(d, { fmt: 'long' })),
  't-sign': () => needDoc((d) => signFlow(d), null, 'Sign which document?'),
  't-annotate': () => needDoc((d) => {
    if (d.pages.length === 1) { openMarkup(d.id, d.pages[0].id).catch(handleErr); return; }
    menuSheet('Mark up which page?', d.pages.map((p, i) => ({ thumb: p.thumb, label: `Page ${i + 1}`, fn: () => openMarkup(d.id, p.id).catch(handleErr) })));
  }),
  't-merge': () => menuSheet('Merge', [
    { icon: 'layers', label: 'Merge documents', desc: 'Combine scans already in your library', fn: () => pickDocsMulti('Merge documents', 'Merge', async (docs) => {
      const pages = [];
      await busy.run('Merging…', async () => { for (const d of docs) for (const p of d.pages) pages.push(await copyPage(p)); });
      const nd = newDoc(`Merged · ${docs.map((d) => d.title).join(' + ')}`.slice(0, 120), pages);
      await saveDoc(nd); openDoc(nd.id); toast(`Merged into ${pages.length} pages`, { type: 'ok' });
    }) },
    { icon: 'pdf', label: 'Merge PDF files', desc: 'Pick two or more PDFs', fn: () => importPdf() },
  ]),
  't-split': () => needDoc((d) => { openDoc(d.id); S.select = new Set(); render(); toast('Tap the pages to pull out, then press Extract.'); }, (d) => d.pages.length > 1, 'Split which document?'),
  't-protect': () => needDoc((d) => openExport(d, { fmt: 'pdf', password: true }), null, 'Protect which document?'),
  't-watermark': () => needDoc((d) => openExport(d, { watermark: true }), null, 'Watermark which document?'),
  't-ai-sum': () => needAI(() => needDoc((d) => openAI(d, 'summary'), null, 'Summarize which document?')),
  't-ai-tr': () => needAI(() => needDoc((d) => openAI(d, 'translate'), null, 'Translate which document?')),
  't-ai-ask': () => needAI(() => needDoc((d) => openAI(d, 'ask'), null, 'Ask about which document?')),
  't-ai-hand': () => needAI(() => needDoc((d) => openAI(d, 'extract'), null, 'Transcribe which document?')),
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { const r = fn(el, e); if (r && typeof r.catch === 'function') r.catch(handleErr); } catch (err) { handleErr(err); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && !sheetStack.length && OV.stack.length) {
    const top = OV.stack[OV.stack.length - 1].name;
    if (top === 'viewer') closeOverlay('viewer');
  }
});
function setupDropAndPaste() {
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    e.preventDefault();
    if (OV.stack.length) return;
    importFiles(files);
  });
  window.addEventListener('paste', (e) => {
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
    if (files.length && !OV.stack.length) { e.preventDefault(); importFiles(files); }
  });
}

async function boot() {
  await Store.init();
  const saved = await Store.getKV('settings', null);
  if (saved) S.settings = { ...DEFAULT_SETTINGS, ...saved, folders: saved.folders || [] };
  applyTheme();
  $('#tabbar').innerHTML = tabbarHTML();
  S.docs = await Store.allDocs();
  if (!S.docs.length && !(await Store.getKV('seeded', false))) {
    try { await makeSampleDoc(); } catch (e) { console.warn('sample', e); }
    await Store.setKV('seeded', true);
  }
  render();
  setupDropAndPaste();
  getDownloads();
  Assist.init().catch(() => {});
  Cloud.init().catch(() => {});
}
boot().catch(handleErr);
