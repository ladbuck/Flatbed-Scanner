// ---------------------------------------------------------------------------
// Export sheet and file builders (PDF / JPG / PNG / Word / text / long image)
// ---------------------------------------------------------------------------
const EXPORT_FORMATS = [
  { id: 'pdf', label: 'PDF', icon: 'pdf' }, { id: 'jpg', label: 'JPG', icon: 'image' }, { id: 'png', label: 'PNG', icon: 'image' },
  { id: 'docx', label: 'Word', icon: 'word' }, { id: 'txt', label: 'Text', icon: 'type' }, { id: 'long', label: 'Long image', icon: 'longimg' },
];
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
const MARGINS = { none: 0, small: 17, wide: 42.5 };
// Quality is chosen only here, at export. "Original" uses the saved scans as they are.
const QUAL = {
  original: { maxDim: 99999, jpeg: 0.95, keep: true, label: 'Original', desc: 'Full resolution, no extra compression', rel: 1 },
  high: { maxDim: 3000, jpeg: 0.9, label: 'High', desc: 'Up to 3000 px, lightly compressed', rel: 0.62 },
  medium: { maxDim: 2000, jpeg: 0.8, label: 'Medium', desc: 'Up to 2000 px, good for printing and sharing', rel: 0.48 },
  small: { maxDim: 1400, jpeg: 0.65, label: 'Small', desc: 'Up to 1400 px, easy to email or send on chat apps', rel: 0.35 },
};
const WM_COLORS = ['#d0302a', '#14171a', '#2a44f0', '#808080'];

let _dl = null;
function getDownloads() {
  if (!_dl) _dl = (window.claude && typeof window.claude.use === 'function') ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);
  return _dl;
}
async function deliverFile(name, blob) {
  const dl = await getDownloads();
  if (dl) {
    try {
      await dl.save({ filename: name, data: blob });
      toast(`Saved ${name} · ${fmtBytes(blob.size)}`, { type: 'ok' });
      return true;
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') { toast('Save cancelled'); return false; }
      if (code === 'rate_limited') { toast('Another save is waiting for your OK.', { type: 'err' }); return false; }
      if (code === 'rejected_extension' || code === 'extension_not_enabled') { toast('This file type can’t be saved here. Try PDF or JPG.', { type: 'err' }); return false; }
      if (code === 'too_large') { toast('That file is too large here. Pick a smaller quality.', { type: 'err' }); return false; }
      console.warn('downloads.save failed', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`Downloading ${name} · ${fmtBytes(blob.size)}`, { type: 'ok' });
  return true;
}

function openExport(doc, opts = {}) {
  const pages = opts.pageIds ? doc.pages.filter((p) => opts.pageIds.includes(p.id)) : doc.pages.slice();
  const st = {
    fmt: opts.fmt || 'pdf', size: S.settings.pageSize, margin: S.settings.margin, quality: 'original',
    searchable: pages.every((p) => p.ocr && p.ocr.words && p.ocr.words.length), pw: !!opts.password, password: '', showPw: false,
    wm: !!opts.watermark, wmText: 'CONFIDENTIAL', wmMode: 'tile', wmOpacity: 0.18, wmColor: WM_COLORS[0],
    docxImages: true, name: safeName(doc.title) + (opts.pageIds ? ` (${pages.length} pp)` : ''),
  };
  const s = openSheet({
    title: `Export · ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`,
    actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, icon: 'download', id: 'ex-go', fn: () => {
      if (st.pw && st.password.length < 4) { toast('Use a password of at least 4 characters.', { type: 'err' }); return false; }
      if (st.wm && !st.wmText.trim()) { toast('Type the watermark text.', { type: 'err' }); return false; }
      runExport(doc, pages, { ...st }).catch(handleErr);
    } }],
  });
  const body = s.body;
  const seg = (k, opts2) => `<div class="seg" data-k="${k}">${opts2.map(([v, l]) => `<button type="button" class="${String(st[k]) === String(v) ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const toggle = (k, title, small) => `<div class="toggle-row"><div class="grow"><b>${title}</b>${small ? `<small>${small}</small>` : ''}</div><label class="switch"><input type="checkbox" data-t="${k}" ${st[k] ? 'checked' : ''} aria-label="${esc(title)}"><span></span></label></div>`;
  // Size estimates from the saved scans (exact for Original, approximate otherwise).
  let savedBytes = 0, maxSide = 0;
  Promise.all(pages.map((p) => Store.getBlob(p.proc))).then((bs) => {
    savedBytes = bs.reduce((n, b) => n + (b ? b.size : 0), 0);
    maxSide = Math.max(0, ...pages.map((p) => Math.max(p.pw || 0, p.ph || 0)));
    const el = body.querySelector('#ex-qnote'); if (el) el.textContent = qualityNote();
  });
  function qualityNote() {
    const Q = QUAL[st.quality];
    if (!savedBytes) return Q.desc;
    const side = Math.min(maxSide, Q.maxDim), scale = Math.min(1, Q.maxDim / Math.max(1, maxSide));
    const est = Q.keep ? savedBytes : savedBytes * scale * scale * Q.rel;
    return `${Q.desc}. Pages up to ${side} px · about ${fmtBytes(Math.round(est))} of images.`;
  }
  function summary() {
    const n = pages.length;
    return { pdf: `${n} ${n === 1 ? 'page' : 'pages'} → one PDF${st.pw ? ', password protected' : ''}`, jpg: n > 1 ? `${n} JPG images in one .zip` : 'One JPG image', png: n > 1 ? `${n} PNG images in one .zip` : 'One PNG image', docx: 'Word document with the recognised text' + (st.docxImages ? ' and page images' : ''), txt: 'Plain text from every page', long: `${n} ${n === 1 ? 'page' : 'pages'} stitched into one tall JPG (up to 2400 px wide)` }[st.fmt];
  }
  function draw() {
    const f = st.fmt, pdf = f === 'pdf', img = f === 'jpg' || f === 'png' || f === 'long';
    const needsText = f === 'docx' || f === 'txt' || (pdf && st.searchable);
    const missingText = pages.filter((p) => !p.ocr || !p.ocr.text).length;
    body.innerHTML = `
      <div class="seg" id="ex-fmt" role="group" aria-label="Format">${EXPORT_FORMATS.map((x) => `<button type="button" class="${x.id === f ? 'on' : ''}" data-f="${x.id}">${ic(x.icon)}${x.label}</button>`).join('')}</div>
      <label class="field"><span class="field-label">File name</span><input class="input" id="ex-name" value="${esc(st.name)}" autocomplete="off" maxlength="120"></label>
      ${pdf ? `<div class="opt-group"><span class="label">Page size</span>${seg('size', [['auto', 'Fit to image'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal']])}</div>
        <div class="opt-group"><span class="label">Margins</span>${seg('margin', [['none', 'None'], ['small', '6 mm'], ['wide', '15 mm']])}</div>` : ''}
      ${pdf || img || f === 'docx' ? `<div class="opt-group"><span class="label">Quality</span>${seg('quality', Object.keys(QUAL).map((k) => [k, QUAL[k].label]))}
        <p class="note" id="ex-qnote">${esc(qualityNote())}</p></div>` : ''}
      ${pdf ? toggle('searchable', 'Searchable text', 'Lets you select and search words in the PDF') : ''}
      ${pdf ? toggle('pw', 'Password protect', 'AES-256 encryption. Needed to open the file.') : ''}
      ${pdf && st.pw ? `<div class="sub"><label class="field"><span class="field-label">Password</span><div class="row"><input class="input grow" id="ex-pw" type="${st.showPw ? 'text' : 'password'}" value="${esc(st.password)}" autocomplete="new-password" placeholder="At least 4 characters"><button type="button" class="btn btn-sm" id="ex-show">${st.showPw ? 'Hide' : 'Show'}</button></div></label><p class="note">There is no way to recover a forgotten password. Note it somewhere safe.</p></div>` : ''}
      ${pdf || img ? toggle('wm', 'Add a watermark', 'Printed across every page') : ''}
      ${(pdf || img) && st.wm ? `<div class="sub">
          <label class="field"><span class="field-label">Watermark text</span><input class="input" id="ex-wm" value="${esc(st.wmText)}" maxlength="60"></label>
          <div class="row" style="flex-wrap:wrap">${seg('wmMode', [['tile', 'Tiled'], ['center', 'Centred']])}<span class="grow"></span>
            <div class="swatches">${WM_COLORS.map((c) => `<button type="button" class="swatch ${c === st.wmColor ? 'on' : ''}" style="background:${c}" data-wc="${c}" aria-label="Watermark colour ${c}"></button>`).join('')}</div></div>
          <label class="field"><span class="field-label">Opacity · <span id="ex-op">${Math.round(st.wmOpacity * 100)}%</span></span><input type="range" min="5" max="60" value="${Math.round(st.wmOpacity * 100)}" id="ex-wmo"></label>
        </div>` : ''}
      ${f === 'docx' ? toggle('docxImages', 'Include page images', 'Puts each scanned page above its text') : ''}
      <p class="note">${esc(summary())}</p>
      ${needsText && missingText ? `<p class="note">${missingText} ${missingText === 1 ? 'page needs' : 'pages need'} text recognition first. This runs on your device and can take a little while.</p>` : ''}`;
    body.querySelectorAll('#ex-fmt button').forEach((b) => b.onclick = () => { st.fmt = b.dataset.f; draw(); });
    body.querySelectorAll('.seg[data-k] button').forEach((b) => b.onclick = () => { st[b.parentElement.dataset.k] = b.dataset.v; draw(); });
    body.querySelectorAll('[data-t]').forEach((t) => t.onchange = () => { st[t.dataset.t] = t.checked; draw(); if (t.dataset.t === 'pw' && t.checked) setTimeout(() => { const p = $('#ex-pw'); if (p) p.focus(); }, 30); });
    body.querySelectorAll('[data-wc]').forEach((b) => b.onclick = () => { st.wmColor = b.dataset.wc; draw(); });
    const on = (id, ev, fn) => { const el = body.querySelector(id); if (el) el.addEventListener(ev, fn); };
    on('#ex-name', 'input', (e) => { st.name = e.target.value; });
    on('#ex-pw', 'input', (e) => { st.password = e.target.value; });
    on('#ex-show', 'click', () => { st.showPw = !st.showPw; draw(); });
    on('#ex-wm', 'input', (e) => { st.wmText = e.target.value; });
    on('#ex-wmo', 'input', (e) => { st.wmOpacity = +e.target.value / 100; $('#ex-op').textContent = e.target.value + '%'; });
  }
  draw();
}

async function runExport(doc, pages, st) {
  const name = safeName(st.name || doc.title);
  const wm = st.wm ? { text: st.wmText.trim(), mode: st.wmMode, opacity: st.wmOpacity, color: st.wmColor } : null;
  const Q = QUAL[st.quality] || QUAL.original;
  const needsText = st.fmt === 'docx' || st.fmt === 'txt' || (st.fmt === 'pdf' && st.searchable);
  busy.show('Preparing…');
  let blob, file;
  try {
    if (needsText) {
      const miss = pages.filter((p) => !p.ocr || !p.ocr.text || (st.fmt === 'pdf' && (!p.ocr.words || !p.ocr.words.length) && p.ocr.src === 'ocr' && !p.ocr.edited));
      if (miss.length) { busy.progress(0, 'Reading text…'); await runOcr(doc, miss); }
    }
    const prog = (f, m) => busy.progress(f, m);
    if (st.fmt === 'pdf') { blob = await buildPdfExport(doc, pages, st, Q, wm, prog); file = name + '.pdf'; }
    else if (st.fmt === 'jpg' || st.fmt === 'png') {
      const type = st.fmt === 'png' ? 'image/png' : 'image/jpeg', files = [];
      for (let i = 0; i < pages.length; i++) {
        prog(i / pages.length, `Rendering page ${i + 1} of ${pages.length}…`);
        const pg = pages[i], fname = `${name}-${String(i + 1).padStart(2, '0')}.${st.fmt}`;
        if (st.fmt === 'jpg' && Q.keep && !wm && !(pg.marks && pg.marks.length)) {
          files.push({ name: fname, data: await blobBytes(await Store.getBlob(pg.proc)) });
          continue;
        }
        const c = await renderPage(pg, { maxDim: Q.maxDim, watermark: wm });
        files.push({ name: fname, data: await blobBytes(await canvasToBlob(c, type, Q.jpeg)) });
      }
      if (files.length === 1) { blob = new Blob([files[0].data], { type }); file = `${name}.${st.fmt}`; }
      else { blob = zipBuild(files); file = `${name}.zip`; }
    } else if (st.fmt === 'long') {
      const canv = [];
      const longDim = Math.min(Q.maxDim, 2400);
      for (let i = 0; i < pages.length; i++) { prog(i / pages.length, `Rendering page ${i + 1} of ${pages.length}…`); canv.push(await renderPage(pages[i], { maxDim: longDim, watermark: wm })); }
      let W = Math.min(longDim, Math.max(...canv.map((c) => c.width)));
      const gap = 16;
      let H = canv.reduce((h, c) => h + Math.round(c.height * W / c.width), 0) + gap * (canv.length - 1);
      const lim = Math.min(1, 30000 / H, Math.sqrt(16e6 / (W * H)));
      if (lim < 1) { W = Math.floor(W * lim); H = canv.reduce((h, c) => h + Math.round(c.height * W / c.width), 0) + gap * (canv.length - 1); }
      const out = makeCanvas(W, H), x = out.getContext('2d');
      x.fillStyle = '#e6e8e4'; x.fillRect(0, 0, W, H);
      let y = 0;
      for (const c of canv) { const h = Math.round(c.height * W / c.width); x.drawImage(c, 0, y, W, h); y += h + gap; }
      blob = await canvasToBlob(out, 'image/jpeg', Q.jpeg); file = `${name}-long.jpg`;
    } else if (st.fmt === 'txt') {
      const text = pages.map((p) => `--- Page ${doc.pages.indexOf(p) + 1} ---\n${(p.ocr && p.ocr.text) || ''}`).join('\n\n');
      blob = new Blob([pages.length === 1 ? pages[0].ocr.text : text], { type: 'text/plain;charset=utf-8' }); file = name + '.txt';
    } else if (st.fmt === 'docx') {
      const sections = [];
      for (let i = 0; i < pages.length; i++) {
        prog(i / pages.length, `Adding page ${i + 1} of ${pages.length}…`);
        const p = pages[i], sec = { heading: pages.length > 1 ? `Page ${doc.pages.indexOf(p) + 1}` : '', text: (p.ocr && p.ocr.text) || '' };
        if (st.docxImages) {
          if (Q.keep && !(p.marks && p.marks.length) && p.pw) sec.image = { data: await blobBytes(await Store.getBlob(p.proc)), pxW: p.pw, pxH: p.ph };
          else { const c = await renderPage(p, { maxDim: Q.maxDim }); sec.image = { data: await blobBytes(await canvasToBlob(c, 'image/jpeg', Q.jpeg)), pxW: c.width, pxH: c.height }; }
        }
        sections.push(sec);
      }
      blob = docxBuild(sections, doc.title); file = name + '.docx';
    }
  } finally { busy.hide(); }
  await deliverFile(file, blob);
}

async function buildPdfExport(doc, pages, st, Q, wm, prog) {
  const m = MARGINS[st.margin] || 0, out = [];
  for (let i = 0; i < pages.length; i++) {
    prog(i / pages.length, `Preparing page ${i + 1} of ${pages.length}…`);
    const p = pages[i], plain = !(p.marks && p.marks.length) && !wm;
    let image = null;
    if (plain && p.filter === 'bw' && p.kind !== 'id') {
      const c = await blobToCanvas(await Store.getBlob(p.proc), Q.maxDim);
      const z = await deflateBytes(await IP.run('pack1', { img: getImageData(c) }));
      if (z) image = { kind: 'bw1', data: z, pxW: c.width, pxH: c.height };
    }
    if (!image && plain && Q.keep && p.pw && p.ph) {
      image = { kind: 'jpeg', data: await blobBytes(await Store.getBlob(p.proc)), pxW: p.pw, pxH: p.ph };
    }
    if (!image) {
      const c = await renderPage(p, { maxDim: Q.maxDim, watermark: wm });
      image = { kind: 'jpeg', data: await blobBytes(await canvasToBlob(c, 'image/jpeg', Q.jpeg)), pxW: c.width, pxH: c.height };
    }
    const ar = image.pxH / image.pxW;
    let W, H, box;
    if (st.size === 'auto') {
      const w = ar >= 1 ? 595.28 : 841.89, h = w * ar;
      W = w + 2 * m; H = h + 2 * m; box = { x: m, y: m, w, h };
    } else {
      let [PW, PH] = PAGE_SIZES[st.size] || PAGE_SIZES.a4;
      if (ar < 1) [PW, PH] = [PH, PW];
      const aw = PW - 2 * m, ah = PH - 2 * m;
      let w, h;
      if (ar > ah / aw) { h = ah; w = ah / ar; } else { w = aw; h = aw * ar; }
      W = PW; H = PH; box = { x: (PW - w) / 2, y: (PH - h) / 2, w, h };
    }
    const words = [];
    if (st.searchable && p.ocr && p.ocr.words) {
      for (const wd of p.ocr.words) words.push({ s: wd.s, x: box.x + wd.x * box.w, y: box.y + (1 - wd.y - wd.h) * box.h, w: wd.w * box.w, h: wd.h * box.h });
    }
    out.push({ w: W, h: H, image, box, words });
  }
  prog(0.98, st.pw ? 'Encrypting…' : 'Writing PDF…');
  return pdfBuild(out, { title: doc.title, password: st.pw ? st.password : null });
}
