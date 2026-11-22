// ---------------------------------------------------------------------------
// Overlays (full-screen studio views) and the scan session:
// capture -> crop corners -> choose a look -> save
// ---------------------------------------------------------------------------
const OV = { stack: [] };
function openOverlay(name, refresh, cleanup) {
  closeOverlay(name);
  const el = document.createElement('div');
  el.className = 'ov ov-' + name;
  $('#overlay-root').appendChild(el);
  const o = { name, el, refresh, cleanup };
  OV.stack.push(o);
  refresh(o);
  return o;
}
function getOverlay(name) { return OV.stack.find((o) => o.name === name); }
function closeOverlay(name) {
  const i = OV.stack.findIndex((o) => o.name === name);
  if (i < 0) return;
  const [o] = OV.stack.splice(i, 1);
  if (o.cleanup) o.cleanup();
  o.el.remove();
}
function closeAllOverlays() { while (OV.stack.length) closeOverlay(OV.stack[OV.stack.length - 1].name); }
function refreshOverlay() { const o = OV.stack[OV.stack.length - 1]; if (o && o.name === 'viewer') o.refresh(o); }
window.addEventListener('resize', debounce(() => { const o = OV.stack[OV.stack.length - 1]; if (o && o.onResize) o.onResize(); }, 150));
const DPR = () => Math.min(2.5, window.devicePixelRatio || 1);

function quadConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = [q[i * 2], q[i * 2 + 1]], b = [q[((i + 1) % 4) * 2], q[((i + 1) % 4) * 2 + 1]], c = [q[((i + 2) % 4) * 2], q[((i + 2) % 4) * 2 + 1]];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) return false;
    const s = Math.sign(cr);
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}

// Pull detected corners slightly inward so no background shows at the edges.
function insetQuad(q, f) {
  let cx = 0, cy = 0;
  for (let i = 0; i < 4; i++) { cx += q[i * 2] / 4; cy += q[i * 2 + 1] / 4; }
  return q.map((v, i) => clamp(v + ((i % 2 ? cy : cx) - v) * f * 2.5, 0, 1));
}
async function makeItem(file, from) {
  const c = await blobToCanvas(file, STORE_MAX);
  const origBlob = from ? file : await canvasToBlob(c, 'image/jpeg', 0.9);
  const item = {
    id: uid(), origBlob, ow: c.width, oh: c.height,
    disp: scaleCanvas(c, 1400), prev: getImageData(scaleCanvas(c, 1000)),
    quad: FULL_QUAD.slice(), detected: false, filter: S.settings.filter, adj: { b: 0, c: 0, s: 0 }, rot: 0,
  };
  if (from) {
    Object.assign(item, { origKey: from.orig, quad: (from.quad || FULL_QUAD).slice(), filter: from.filter || 'original', adj: { b: 0, c: 0, s: 0, ...(from.adj || {}) }, rot: from.rot || 0, kind: from.kind });
  } else if (S.settings.autoCrop) {
    try {
      const q = await IP.run('detect', { img: getImageData(scaleCanvas(c, 480)) });
      if (q && quadConvex(q)) { item.quad = insetQuad(q, 0.004); item.detected = true; }
    } catch (e) { console.warn('detect failed', e); }
  }
  return item;
}

const Sess = {
  s: null,
  async begin(mode, files, opts = {}) {
    const fresh = !this.s;
    if (fresh) this.s = { mode, items: [], idx: 0, step: 'crop', docId: opts.docId || null, pageId: opts.pageId || null, adjOpen: false, after: opts.after || null };
    let list = files;
    if (this.s.mode === 'id') list = list.slice(0, Math.max(0, 2 - this.s.items.length));
    if (!list.length) return;
    busy.show(list.length > 1 ? `Opening ${list.length} photos…` : 'Finding the page…');
    const start = this.s.items.length;
    try {
      for (let i = 0; i < list.length; i++) {
        if (list.length > 1) busy.progress(i / list.length, `Finding edges · photo ${i + 1} of ${list.length}`);
        const it = await makeItem(list[i]);
        if (this.s.mode === 'id' && S.settings.filter !== 'original') it.filter = 'noshadow';
        this.s.items.push(it);
      }
    } catch (e) { if (fresh && !this.s.items.length) this.s = null; throw e; }
    finally { busy.hide(); }
    this.s.idx = start;
    this.s.step = 'crop';
    this.open();
  },
  async editPage(doc, page) {
    const blob = await Store.getBlob(page.orig);
    if (!blob) throw new Error('The original photo for this page is missing.');
    busy.show('Opening page…');
    try {
      this.s = { mode: 'edit', items: [await makeItem(blob, page)], idx: 0, step: 'crop', docId: doc.id, pageId: page.id, adjOpen: false };
    } finally { busy.hide(); }
    this.open();
  },
  open() {
    const o = getOverlay('session');
    if (o) { o.refresh(o); return; }
    openOverlay('session', renderSess, () => { this.s = null; });
  },
  close() { closeOverlay('session'); },
};

const MODE_TITLE = { doc: 'New scan', ocr: 'Image to text', id: 'ID card', book: 'Book scan', add: 'Add pages', edit: 'Edit page' };

function renderSess(o) {
  const s = Sess.s; if (!s) return;
  const it = s.items[s.idx];
  const crop = s.step === 'crop';
  makeStripThumbs();
  const canAdd = s.mode !== 'edit' && !(s.mode === 'id' && s.items.length >= 2);
  const side = s.mode === 'id' ? (s.idx === 0 ? 'Front side · ' : 'Back side · ') : '';
  const strip = (s.items.length > 1 || canAdd) ? `<div class="strip" aria-label="Pages">${s.items.map((x, i) => `<button class="strip-item ${i === s.idx ? 'on' : ''}" data-act="sess-pick" data-i="${i}" aria-label="Page ${i + 1}"><img src="${x.thumbUrl || ''}" alt=""><span>${i + 1}</span></button>`).join('')}
      ${canAdd ? `<button class="strip-add" data-act="sess-more" aria-label="Add photos">${ic('plus')}</button>` : ''}</div>` : '';
  let tools, bar;
  if (crop) {
    tools = `<div class="ov-tools">
      <button class="tbtn" data-act="sess-detect">${ic('scan')}<span>Find edges</span></button>
      <button class="tbtn" data-act="sess-full">${ic('crop')}<span>Whole photo</span></button>
      ${s.mode !== 'edit' ? `<button class="tbtn" data-act="sess-retake">${ic('camera')}<span>Retake</span></button>` : ''}
    </div>`;
    const needBack = s.mode === 'id' && s.items.length < 2;
    bar = `<footer class="ov-bar"><span class="grow note" style="color:#9aa1a9">${s.mode === 'book' ? 'The dashed line is where the spread will be split.' : ''}</span>
      <button class="btn btn-primary" id="sess-next" data-act="sess-next">${needBack ? 'Scan back side' : 'Next'}${ic(needBack ? 'camera' : 'right')}</button></footer>`;
  } else {
    tools = s.adjOpen ? `<div class="adj">
        ${ic('sun')}<input type="range" min="-100" max="100" value="${it.adj.b}" data-adj="b" aria-label="Brightness"><output>${it.adj.b}</output>
        ${ic('contrast')}<input type="range" min="-100" max="100" value="${it.adj.c}" data-adj="c" aria-label="Contrast"><output>${it.adj.c}</output>
        ${ic('sharpen')}<input type="range" min="0" max="100" value="${it.adj.s}" data-adj="s" aria-label="Sharpen"><output>${it.adj.s}</output>
      </div>` : `<div class="filters" id="sess-filters">${FILTERS.map((f) => `<button class="fchip ${it.filter === f.id ? 'on' : ''}" data-act="sess-filter" data-f="${f.id}"><span class="fthumb"><img alt="" data-f="${f.id}"></span><span>${f.label}</span></button>`).join('')}</div>`;
    tools += `<div class="ov-tools">
      <button class="tbtn" data-act="sess-crop">${ic('crop')}<span>Crop</span></button>
      <button class="tbtn" data-act="sess-rot" data-d="-1">${ic('rotl')}<span>Rotate</span></button>
      <button class="tbtn ${s.adjOpen ? 'on' : ''}" data-act="sess-adj">${ic('sliders')}<span>Adjust</span></button>
      ${s.items.length > 1 ? `<button class="tbtn" data-act="sess-all">${ic('layers')}<span>Use on all</span></button>` : ''}
    </div>`;
    bar = `<footer class="ov-bar"><span class="grow note" style="color:#9aa1a9">${s.items.length} ${s.items.length === 1 ? 'page' : 'pages'}${s.mode === 'book' ? ` → ${s.items.length * 2} after split` : ''}</span>
      <button class="btn btn-primary" data-act="sess-save">${ic('check')}<span>${s.mode === 'edit' ? 'Save changes' : 'Save'}</span></button></footer>`;
  }
  o.el.innerHTML = `<header class="ov-top">
      <button class="icon-btn" data-act="sess-cancel" aria-label="Discard">${ic('x')}</button>
      <div class="ov-title"><b>${MODE_TITLE[s.mode]}</b><span>${side}${crop ? 'Adjust corners' : 'Choose a look'} · ${s.idx + 1}/${s.items.length}</span></div>
      ${s.mode === 'edit' || s.items.length < 2 ? '<span style="width:42px"></span>' : `<button class="icon-btn" data-act="sess-del" aria-label="Remove this photo">${ic('trash')}</button>`}
    </header>
    <div class="stage" id="sess-stage"></div>${strip}${tools}${bar}`;
  o.onResize = () => (crop ? setupCrop() : drawPreview());
  requestAnimationFrame(() => {
    if (!Sess.s) return;
    if (crop) setupCrop(); else setupEnhance().catch(handleErr);
  });
  if (!crop && s.adjOpen) {
    o.el.querySelectorAll('[data-adj]').forEach((inp) => {
      inp.addEventListener('input', () => { it.adj[inp.dataset.adj] = +inp.value; inp.nextElementSibling.textContent = inp.value; schedulePreview(); });
    });
  }
}
function makeStripThumbs() {
  for (const x of Sess.s.items) if (!x.thumbUrl) x.thumbUrl = scaleCanvas(x.disp, 120).toDataURL('image/jpeg', 0.7);
}

// ---------------------------- Crop corners ---------------------------------
function setupCrop() {
  const s = Sess.s; if (!s) return;
  const it = s.items[s.idx], stage = $('#sess-stage'); if (!stage) return;
  stage.innerHTML = '';
  const r = stage.getBoundingClientRect(), pad = 24, img = it.disp, dpr = DPR();
  const sc = Math.min((r.width - pad * 2) / img.width, (r.height - pad * 2) / img.height);
  const dw = img.width * sc, dh = img.height * sc, ox = (r.width - dw) / 2, oy = (r.height - dh) / 2;
  const cv = makeCanvas(dw * dpr, dh * dpr); cv.className = 'base';
  cv.style.cssText = `left:${ox}px;top:${oy}px;width:${dw}px;height:${dh}px`;
  const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, cv.width, cv.height);
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  const loupe = makeCanvas(112 * dpr, 112 * dpr); loupe.className = 'loupe'; loupe.hidden = true;
  const msg = document.createElement('div'); msg.className = 'stage-msg';
  stage.append(cv, svg, loupe, msg);
  const P = () => [0, 1, 2, 3].map((i) => [ox + it.quad[i * 2] * dw, oy + it.quad[i * 2 + 1] * dh]);
  function draw() {
    const p = P();
    let h = `<path d="M0 0H${r.width}V${r.height}H0Z M${p.map((q) => q.join(' ')).join(' L')} Z" fill="rgba(0,0,0,.55)" fill-rule="evenodd"/>`;
    h += `<polygon points="${p.map((q) => q.join(',')).join(' ')}" fill="rgba(141,155,255,.10)" stroke="#8d9bff" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (s.mode === 'book') {
      const a = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], b = [(p[3][0] + p[2][0]) / 2, (p[3][1] + p[2][1]) / 2];
      h += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#ffd93b" stroke-width="2" stroke-dasharray="8 7"/>`;
    }
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      h += `<rect x="${mx - 15}" y="${my - 4.5}" width="30" height="9" rx="4.5" fill="#fff" stroke="#8d9bff" stroke-width="2" transform="rotate(${ang} ${mx} ${my})"/>`;
    }
    for (const q of p) h += `<circle cx="${q[0]}" cy="${q[1]}" r="13" fill="rgba(141,155,255,.28)" stroke="#fff" stroke-width="3"/>`;
    svg.innerHTML = h;
    const ok = quadConvex(it.quad);
    msg.textContent = ok ? (it.detected ? 'Page found · drag a corner or edge to adjust' : 'Drag the corners onto the page edges') : 'Corners are crossed. Drag them back into place.';
    msg.classList.toggle('warn', !ok);
    const nb = $('#sess-next'); if (nb) nb.disabled = !ok;
  }
  function showLoupe(i, px, py) {
    loupe.hidden = false;
    const lc = loupe.getContext('2d'), L = loupe.width, z = 2.4;
    const srcSize = 112 / (sc * z);
    const sx = it.quad[i * 2] * img.width, sy = it.quad[i * 2 + 1] * img.height;
    lc.fillStyle = '#000'; lc.fillRect(0, 0, L, L);
    lc.drawImage(img, sx - srcSize / 2, sy - srcSize / 2, srcSize, srcSize, 0, 0, L, L);
    lc.strokeStyle = '#8d9bff'; lc.lineWidth = 2 * DPR();
    lc.beginPath(); lc.moveTo(L / 2, L * 0.3); lc.lineTo(L / 2, L * 0.7); lc.moveTo(L * 0.3, L / 2); lc.lineTo(L * 0.7, L / 2); lc.stroke();
    const left = px < r.width / 2 && py < 160 ? r.width - 124 : 12;
    loupe.style.left = left + 'px'; loupe.style.top = '44px';
  }
  let drag = null;
  stage.onpointerdown = (e) => {
    const sr = stage.getBoundingClientRect(), x = e.clientX - sr.left, y = e.clientY - sr.top, p = P();
    let best = -1, bd = 36;
    p.forEach((q, i) => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) drag = { t: 'c', i: best };
    else {
      for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4], d = Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y);
        if (d < 30 && d < bd) { bd = d; drag = { t: 'e', i }; }
      }
    }
    if (!drag) return;
    drag.sx = x; drag.sy = y; drag.q0 = it.quad.slice();
    stage.setPointerCapture(e.pointerId); e.preventDefault();
  };
  stage.onpointermove = (e) => {
    if (!drag) return;
    const sr = stage.getBoundingClientRect(), x = e.clientX - sr.left, y = e.clientY - sr.top;
    let dx = (x - drag.sx) / dw, dy = (y - drag.sy) / dh;
    const q = drag.q0.slice();
    if (drag.t === 'c') {
      q[drag.i * 2] = clamp(q[drag.i * 2] + dx, 0, 1); q[drag.i * 2 + 1] = clamp(q[drag.i * 2 + 1] + dy, 0, 1);
    } else {
      const a = drag.i, b = (drag.i + 1) % 4;
      dx = clamp(dx, -Math.min(q[a * 2], q[b * 2]), 1 - Math.max(q[a * 2], q[b * 2]));
      dy = clamp(dy, -Math.min(q[a * 2 + 1], q[b * 2 + 1]), 1 - Math.max(q[a * 2 + 1], q[b * 2 + 1]));
      q[a * 2] += dx; q[a * 2 + 1] += dy; q[b * 2] += dx; q[b * 2 + 1] += dy;
    }
    it.quad = q; it.detected = false;
    draw();
    if (drag.t === 'c') showLoupe(drag.i, x, y);
  };
  stage.onpointerup = stage.onpointercancel = () => { drag = null; loupe.hidden = true; };
  draw();
}

// ----------------------------- Enhance step ---------------------------------
async function ensureWarped(it) {
  const key = it.quad.join(',');
  if (it.warped && it.warpKey === key) return;
  it.warped = await IP.run('process', { img: it.prev, quad: isFullQuad(it.quad) ? null : it.quad, maxDim: 1000 });
  it.warpKey = key; it.chips = null;
}
async function setupEnhance() {
  const s = Sess.s; if (!s) return;
  const it = s.items[s.idx];
  const stage = $('#sess-stage'); if (!stage) return;
  if (!it.warped || it.warpKey !== it.quad.join(',')) {
    stage.innerHTML = '<div class="stage-msg">Straightening…</div>';
    await ensureWarped(it);
  }
  if (!Sess.s || Sess.s.items[Sess.s.idx] !== it) return;
  if (!it.chips) {
    const small = ipResize(it.warped, 150);
    it.chips = {};
    for (const f of FILTERS) it.chips[f.id] = imgDataToCanvas(ipFilter(small, f.id)).toDataURL('image/jpeg', 0.72);
  }
  $$('#sess-filters img[data-f]').forEach((im) => { im.src = it.chips[im.dataset.f]; });
  await drawPreview();
}
let prevSeq = 0, prevTimer = 0;
function schedulePreview() { clearTimeout(prevTimer); prevTimer = setTimeout(() => drawPreview().catch(handleErr), 90); }
async function drawPreview() {
  const s = Sess.s; if (!s || s.step !== 'enhance') return;
  const it = s.items[s.idx]; if (!it.warped) return;
  const seq = ++prevSeq;
  const res = await IP.run('filter', { img: it.warped, filter: it.filter, adj: it.adj });
  if (seq !== prevSeq || !Sess.s || Sess.s.items[Sess.s.idx] !== it) return;
  const stage = $('#sess-stage'); if (!stage) return;
  const src = imgDataToCanvas(res), r = stage.getBoundingClientRect(), dpr = DPR(), rot = ((it.rot % 4) + 4) % 4;
  const w = rot % 2 ? src.height : src.width, h = rot % 2 ? src.width : src.height;
  const sc = Math.min((r.width - 36) / w, (r.height - 36) / h), dw = w * sc, dh = h * sc;
  let cv = stage.querySelector('canvas.base');
  if (!cv) { stage.innerHTML = ''; cv = document.createElement('canvas'); cv.className = 'base'; stage.appendChild(cv); }
  cv.width = Math.round(dw * dpr); cv.height = Math.round(dh * dpr);
  cv.style.cssText = `left:${(r.width - dw) / 2}px;top:${(r.height - dh) / 2}px;width:${dw}px;height:${dh}px`;
  const x = cv.getContext('2d'), k = sc * dpr;
  x.save(); x.translate(cv.width / 2, cv.height / 2); x.rotate(rot * Math.PI / 2);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, -src.width * k / 2, -src.height * k / 2, src.width * k, src.height * k); x.restore();
}

// ------------------------------- Saving ------------------------------------
async function bookPages(it) {
  const oc = await blobToCanvas(it.origBlob, STORE_MAX);
  const warped = await IP.run('process', { img: getImageData(oc), quad: isFullQuad(it.quad) ? null : it.quad, rot: it.rot, maxDim: STORE_MAX });
  const wc = imgDataToCanvas(warped), half = Math.round(wc.width / 2), out = [];
  for (const [x0, w] of [[0, half], [half, wc.width - half]]) {
    const c = makeCanvas(w, wc.height); c.getContext('2d').drawImage(wc, x0, 0, w, wc.height, 0, 0, w, wc.height);
    out.push(await buildPage({ origBlob: await canvasToBlob(c, 'image/jpeg', 0.92), quad: FULL_QUAD, filter: it.filter, adj: it.adj, rot: 0 }));
  }
  return out;
}
async function idCardPage(items) {
  const W = 2480, H = 3508, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  let y = 460;
  for (const it of items) {
    const oc = await blobToCanvas(it.origBlob, STORE_MAX);
    const r = await IP.run('process', { img: getImageData(oc), quad: isFullQuad(it.quad) ? null : it.quad, filter: it.filter, adj: it.adj, rot: it.rot, maxDim: 1600 });
    const p = imgDataToCanvas(r), ar = p.height / p.width;
    // 85.6 × 54 mm card at 300 dpi
    let w = 1011, h = 1011 * ar;
    if (ar > 1) { h = 1011; w = h / ar; }
    x.drawImage(p, (W - w) / 2, y, w, h);
    y += h + 240;
  }
  return buildPage({ origBlob: await canvasToBlob(c, 'image/jpeg', 0.92), quad: FULL_QUAD, filter: 'original', adj: null, rot: 0, kind: 'id' });
}
async function sessSave() {
  const s = Sess.s; if (!s) return;
  const n = s.items.length;
  busy.show('Saving…');
  try {
    if (s.mode === 'edit') {
      const doc = getDoc(s.docId), page = doc && doc.pages.find((p) => p.id === s.pageId);
      if (!page) throw new Error('This page no longer exists.');
      const it = s.items[0];
      const geomChanged = it.quad.join() !== page.quad.join() || (it.rot || 0) !== (page.rot || 0);
      await buildPage({ origKey: it.origKey || null, origBlob: it.origBlob, quad: it.quad, filter: it.filter, adj: it.adj, rot: it.rot, kind: page.kind }, page);
      if (!it.origKey) page.ocr = null;
      else if (geomChanged && page.ocr) page.ocr.words = [];
      await saveDoc(doc);
      Sess.close(); busy.hide();
      refreshView(); refreshViewer();
      toast('Page updated', { type: 'ok' });
      return;
    }
    let pages = [];
    if (s.mode === 'id') {
      busy.progress(0.3, 'Placing both sides on one page…');
      pages = [await idCardPage(s.items)];
    } else {
      for (let i = 0; i < n; i++) {
        busy.progress(i / n, `Processing page ${i + 1} of ${n}…`);
        const it = s.items[i];
        if (s.mode === 'book') pages.push(...await bookPages(it));
        else pages.push(await buildPage({ origBlob: it.origBlob, quad: it.quad, filter: it.filter, adj: it.adj, rot: it.rot }));
      }
    }
    let doc;
    if (s.mode === 'add' && getDoc(s.docId)) {
      doc = getDoc(s.docId);
      doc.pages.push(...pages);
    } else {
      doc = newDoc(defaultTitle(s.mode === 'id' ? 'ID card' : s.mode === 'book' ? 'Book' : 'Scan'), pages);
    }
    await saveDoc(doc);
    const mode = s.mode, after = s.after;
    Sess.close();
    busy.hide();
    openDoc(doc.id);
    toast(mode === 'add' ? `Added ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'Saved', { type: 'ok' });
    if (mode === 'ocr') await docTextSheet(doc, null, true);
    else if (after === 'export') openExport(doc, { fmt: 'pdf' });
  } catch (e) { busy.hide(); throw e; }
}

// ------------------------------- Actions -----------------------------------
Object.assign(A, {
  'sess-cancel': async () => {
    const s = Sess.s; if (!s) return;
    if (s.mode !== 'edit' && s.items.length && !(await confirmBox(`Discard ${s.items.length === 1 ? 'this photo' : `${s.items.length} photos`}?`, { ok: 'Discard', danger: true, title: 'Discard scan?' }))) return;
    Sess.close();
  },
  'sess-pick': (el) => { Sess.s.idx = +el.dataset.i; Sess.open(); },
  'sess-more': () => {
    menuSheet('Add more pages', [
      { icon: 'camera', label: 'Take a photo', fn: () => pickFiles('camera').then((f) => f.length && Sess.begin(Sess.s.mode, f)).catch(handleErr) },
      { icon: 'image', label: 'Choose photos', fn: () => pickFiles('gallery').then((f) => f.length && Sess.begin(Sess.s.mode, f)).catch(handleErr) },
    ]);
  },
  'sess-del': () => {
    const s = Sess.s; s.items.splice(s.idx, 1);
    if (!s.items.length) { Sess.close(); return; }
    s.idx = Math.min(s.idx, s.items.length - 1); Sess.open();
  },
  'sess-retake': () => {
    const s = Sess.s, idx = s.idx;
    pickFiles('camera', false).then(async (f) => {
      if (!f.length) return;
      busy.show('Finding the page…');
      try { s.items[idx] = await makeItem(f[0]); } finally { busy.hide(); }
      Sess.open();
    }).catch(handleErr);
  },
  'sess-detect': async () => {
    const it = Sess.s.items[Sess.s.idx];
    const q = await IP.run('detect', { img: getImageData(scaleCanvas(it.disp, 480)) });
    if (q && quadConvex(q)) { it.quad = insetQuad(q, 0.004); it.detected = true; setupCrop(); }
    else toast('No clear page edge found. Drag the corners instead.');
  },
  'sess-full': () => { const it = Sess.s.items[Sess.s.idx]; it.quad = FULL_QUAD.slice(); it.detected = false; setupCrop(); },
  'sess-next': () => {
    const s = Sess.s;
    if (s.mode === 'id' && s.items.length < 2) {
      toast('Now photograph the back of the card');
      pickFiles('camera', false).then((f) => f.length && Sess.begin('id', f)).catch(handleErr);
      return;
    }
    s.step = 'enhance'; Sess.open();
  },
  'sess-crop': () => { Sess.s.step = 'crop'; Sess.open(); },
  'sess-filter': (el) => {
    const it = Sess.s.items[Sess.s.idx]; it.filter = el.dataset.f;
    $$('#sess-filters .fchip').forEach((b) => b.classList.toggle('on', b.dataset.f === it.filter));
    schedulePreview();
  },
  'sess-rot': (el) => { const it = Sess.s.items[Sess.s.idx]; it.rot = (((it.rot || 0) + (+el.dataset.d || 1)) % 4 + 4) % 4; drawPreview().catch(handleErr); },
  'sess-adj': () => { Sess.s.adjOpen = !Sess.s.adjOpen; Sess.open(); },
  'sess-all': () => {
    const s = Sess.s, it = s.items[s.idx];
    s.items.forEach((x) => { x.filter = it.filter; x.adj = { ...it.adj }; });
    toast(`“${FILTERS.find((f) => f.id === it.filter).label}” applied to all ${s.items.length} pages`, { type: 'ok' });
  },
  'sess-save': () => sessSave(),
});
