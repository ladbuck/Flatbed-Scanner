// ---------------------------------------------------------------------------
// Mark-up editor: pen, highlighter, text, white-out/redact boxes, signatures
// ---------------------------------------------------------------------------
const MK_COLORS = {
  pen: ['#14171a', '#1f3fd6', '#d22d2d', '#178a4c'],
  hl: ['#ffd93b', '#7df08a', '#ff8ad8', '#8fd3ff'],
  text: ['#14171a', '#1f3fd6', '#d22d2d'],
  box: ['#ffffff', '#14171a'],
};
const MK_SIZES = { pen: [0.0025, 0.0045, 0.008], hl: [0.014, 0.024, 0.04], text: [0.024, 0.034, 0.05] };
const MK = { docId: null, pageId: null, marks: [], hist: [], tool: 'pen', color: {}, size: { pen: 1, hl: 1, text: 1 }, sel: -1, bg: null, base: null, view: null, imgs: new Map() };

async function openMarkup(docId, pageId, opts = {}) {
  const d = getDoc(docId), p = d && d.pages.find((x) => x.id === pageId);
  if (!p) return;
  const base = await busy.run('Opening page…', () => renderPage(p, { maxDim: 2200, marks: false }));
  Object.assign(MK, { docId, pageId, marks: structuredClone(p.marks || []), hist: [], sel: -1, base, tool: opts.signature ? 'move' : (opts.tool || 'pen') });
  for (const k of Object.keys(MK_COLORS)) if (!MK.color[k]) MK.color[k] = MK_COLORS[k][k === 'pen' ? 1 : 0];
  MK.imgs = await preloadMarkImages(MK.marks);
  const o = openOverlay('markup', renderMarkup, () => { MK.base = null; MK.bg = null; });
  o.onResize = () => layoutMarkup();
  if (opts.signature) await placeSignature(opts.signature);
}
function mkPage() { const d = getDoc(MK.docId); return d && d.pages.find((x) => x.id === MK.pageId); }
function renderMarkup(o) {
  const d = getDoc(MK.docId), p = mkPage();
  const T = (id, icon, label) => `<button class="tbtn ${MK.tool === id ? 'on' : ''}" data-act="mk-tool" data-t="${id}">${ic(icon)}<span>${label}</span></button>`;
  o.el.innerHTML = `<header class="ov-top">
      <button class="icon-btn" data-act="mk-cancel" aria-label="Cancel">${ic('x')}</button>
      <div class="ov-title"><b>Mark up</b><span>Page ${d.pages.indexOf(p) + 1} of ${d.pages.length}</span></div>
      <button class="ov-done" data-act="mk-done">${ic('check')}<span>Done</span></button>
    </header>
    <div class="stage" id="mk-stage"></div>
    <div class="mk-props" id="mk-props"></div>
    <div class="ov-tools" style="padding-bottom:calc(10px + var(--safe-b))">
      ${T('move', 'cursor', 'Select')}${T('pen', 'pen', 'Pen')}${T('hl', 'marker', 'Highlight')}${T('text', 'type', 'Text')}${T('box', 'box', 'Cover')}
      <button class="tbtn" data-act="mk-sign">${ic('sign')}<span>Signature</span></button>
      <button class="tbtn" data-act="mk-undo" ${MK.hist.length ? '' : 'disabled'}>${ic('undo')}<span>Undo</span></button>
    </div>`;
  renderProps();
  requestAnimationFrame(layoutMarkup);
}
function renderProps() {
  const el = $('#mk-props'); if (!el) return;
  const t = MK.tool;
  const sel = MK.sel >= 0 ? MK.marks[MK.sel] : null;
  let h = '';
  const colorKey = sel ? (sel.t === 'ink' ? (sel.hl ? 'hl' : 'pen') : sel.t === 'text' ? 'text' : sel.t === 'rect' ? 'box' : null) : (t === 'move' ? null : t);
  if (colorKey) {
    const cur = sel ? sel.c : MK.color[colorKey];
    h += `<div class="swatches" role="group" aria-label="Colour">${MK_COLORS[colorKey].map((c) => `<button class="swatch ${c === cur ? 'on' : ''}" style="background:${c}" data-act="mk-color" data-c="${c}" data-k="${colorKey}" aria-label="Colour ${c}"></button>`).join('')}</div>`;
  }
  if (!sel && MK_SIZES[t]) {
    h += `<div class="row" role="group" aria-label="Size">${[0, 1, 2].map((i) => `<button class="sz ${MK.size[t] === i ? 'on' : ''}" data-act="mk-size" data-i="${i}" aria-label="Size ${i + 1}"><i style="width:${6 + i * 5}px;height:${6 + i * 5}px"></i></button>`).join('')}</div>`;
  }
  if (sel) {
    if (sel.t === 'text') h += `<button class="btn btn-sm" data-act="mk-edittext">${ic('edit')}<span>Edit text</span></button>`;
    h += `<button class="btn btn-sm" data-act="mk-delete">${ic('trash')}<span>Remove</span></button>`;
  }
  if (!h) h = `<span class="note" style="color:#9aa1a9">${t === 'move' ? 'Tap an item to select it, then drag to move or use the corner to resize.' : ''}</span>`;
  if (t === 'text' && !sel) h += '<span class="note" style="color:#9aa1a9">Tap the page where the text should go.</span>';
  if (t === 'box' && !sel) h += '<span class="note" style="color:#9aa1a9">Drag over anything you want to hide.</span>';
  el.innerHTML = h;
  const ub = $('[data-act="mk-undo"]'); if (ub) ub.disabled = !MK.hist.length;
}
function layoutMarkup() {
  const stage = $('#mk-stage'); if (!stage || !MK.base) return;
  stage.innerHTML = '';
  const r = stage.getBoundingClientRect(), dpr = DPR(), b = MK.base;
  const sc = Math.min((r.width - 24) / b.width, (r.height - 24) / b.height);
  const dw = b.width * sc, dh = b.height * sc, ox = (r.width - dw) / 2, oy = (r.height - dh) / 2;
  const cv = makeCanvas(dw * dpr, dh * dpr); cv.className = 'base';
  cv.style.cssText = `left:${ox}px;top:${oy}px;width:${dw}px;height:${dh}px;touch-action:none`;
  stage.appendChild(cv);
  MK.bg = makeCanvas(cv.width, cv.height);
  const bx = MK.bg.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(b, 0, 0, cv.width, cv.height);
  MK.view = { cv, ox, oy, dw, dh, dpr };
  bindMarkupPointer(cv);
  mkDraw();
}
function mkDraw() {
  const v = MK.view; if (!v) return;
  const ctx = v.cv.getContext('2d'), W = v.cv.width, H = v.cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(MK.bg, 0, 0);
  drawMarksSync(ctx, MK.marks, W, H, MK.imgs);
  if (MK.sel >= 0 && MK.marks[MK.sel]) {
    const bx = markBox(MK.marks[MK.sel], W, H), pad = 6 * v.dpr;
    ctx.save(); ctx.strokeStyle = '#2a44f0'; ctx.lineWidth = 2 * v.dpr; ctx.setLineDash([6 * v.dpr, 4 * v.dpr]);
    ctx.strokeRect(bx.x - pad, bx.y - pad, bx.w + pad * 2, bx.h + pad * 2);
    ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.arc(bx.x + bx.w + pad, bx.y + bx.h + pad, 9 * v.dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
function mkSnapshot() { MK.hist.push(JSON.stringify(MK.marks)); if (MK.hist.length > 60) MK.hist.shift(); }
function mkHit(x, y) {
  const v = MK.view, W = v.cv.width, H = v.cv.height, px = x * W, py = y * H;
  for (let i = MK.marks.length - 1; i >= 0; i--) {
    const m = MK.marks[i];
    if (m.t === 'ink') {
      const tol = Math.max(m.w * W, 14 * v.dpr);
      for (let k = 0; k < m.p.length - 2; k += 2) {
        const ax = m.p[k] * W, ay = m.p[k + 1] * H, bx = m.p[k + 2] * W, by = m.p[k + 3] * H;
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2, t = l2 ? clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2, 0, 1) : 0;
        if (Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) < tol) return i;
      }
      if (m.p.length === 2 && Math.hypot(px - m.p[0] * W, py - m.p[1] * H) < tol) return i;
    } else {
      const b = markBox(m, W, H), pad = 8 * v.dpr;
      if (px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad) return i;
    }
  }
  return -1;
}
function bindMarkupPointer(cv) {
  let act = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  cv.onpointerdown = async (e) => {
    e.preventDefault();
    const [x, y] = pos(e), v = MK.view, W = v.cv.width, H = v.cv.height, t = MK.tool;
    cv.setPointerCapture(e.pointerId);
    if (MK.sel >= 0) {
      const m = MK.marks[MK.sel], b = markBox(m, W, H), pad = 6 * v.dpr;
      if (Math.hypot(x * W - (b.x + b.w + pad), y * H - (b.y + b.h + pad)) < 22 * v.dpr && m.t !== 'ink') {
        mkSnapshot(); act = { k: 'resize', m, x0: x, y0: y, orig: structuredClone(m), b }; return;
      }
    }
    if (t === 'move' || (MK.sel >= 0 && mkHit(x, y) === MK.sel)) {
      const i = mkHit(x, y);
      MK.sel = i; renderProps(); mkDraw();
      if (i >= 0) { mkSnapshot(); act = { k: 'drag', m: MK.marks[i], x0: x, y0: y, orig: structuredClone(MK.marks[i]), moved: false }; }
      return;
    }
    MK.sel = -1;
    if (t === 'pen' || t === 'hl') {
      mkSnapshot();
      const m = { t: 'ink', c: MK.color[t], w: MK_SIZES[t][MK.size[t]], a: t === 'hl' ? 0.42 : 1, hl: t === 'hl', p: [r4(x), r4(y)] };
      MK.marks.push(m); act = { k: 'ink', m }; mkDraw();
    } else if (t === 'box') {
      mkSnapshot();
      const m = { t: 'rect', x, y, w: 0, h: 0, c: MK.color.box };
      MK.marks.push(m); act = { k: 'box', m, x0: x, y0: y }; mkDraw();
    } else if (t === 'text') {
      act = null;
      const v2 = await promptBox('Add text', '', { placeholder: 'Type here', ok: 'Add', multiline: true });
      if (!v2 || !v2.trim()) return;
      mkSnapshot();
      MK.marks.push({ t: 'text', x: r4(x), y: r4(y), s: MK_SIZES.text[MK.size.text], c: MK.color.text, v: v2.trim(), rot: 0 });
      MK.sel = MK.marks.length - 1; MK.tool = 'move';
      renderMarkup(getOverlay('markup'));
    }
  };
  cv.onpointermove = (e) => {
    if (!act) return;
    const [x, y] = pos(e);
    if (act.k === 'ink') {
      const p = act.m.p, lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) > 0.0025) { p.push(r4(x), r4(y)); mkDraw(); }
    } else if (act.k === 'box') {
      Object.assign(act.m, { x: Math.min(x, act.x0), y: Math.min(y, act.y0), w: Math.abs(x - act.x0), h: Math.abs(y - act.y0) }); mkDraw();
    } else if (act.k === 'drag') {
      const dx = x - act.x0, dy = y - act.y0, o = act.orig, m = act.m;
      if (Math.abs(dx) + Math.abs(dy) > 0.004) act.moved = true;
      if (m.t === 'ink') { for (let i = 0; i < m.p.length; i += 2) { m.p[i] = r4(o.p[i] + dx); m.p[i + 1] = r4(o.p[i + 1] + dy); } }
      else { m.x = o.x + dx; m.y = o.y + dy; }
      mkDraw();
    } else if (act.k === 'resize') {
      const m = act.m, o = act.orig, v = MK.view, W = v.cv.width, H = v.cv.height;
      const nx = x * W, ny = y * H, b = act.b;
      const f = Math.max(0.15, Math.max((nx - b.x) / Math.max(1, b.w), (ny - b.y) / Math.max(1, b.h)));
      if (m.t === 'img') { m.w = o.w * f; m.h = o.h * f; }
      else if (m.t === 'rect') { m.w = Math.max(0.005, x - o.x); m.h = Math.max(0.005, y - o.y); }
      else if (m.t === 'text') { m.s = clamp(o.s * f, 0.008, 0.3); }
      mkDraw();
    }
  };
  cv.onpointerup = cv.onpointercancel = () => {
    if (!act) return;
    if (act.k === 'box' && (act.m.w < 0.008 || act.m.h < 0.005)) { MK.marks.pop(); MK.hist.pop(); }
    if (act.k === 'drag' && !act.moved) MK.hist.pop();
    act = null; renderProps(); mkDraw();
  };
}
async function placeSignature(sig) {
  const b = await Store.getBlob(sig.key); if (!b) return;
  const key = await Store.putBlob(b);
  const im = await markImage(key); MK.imgs.set(key, im);
  const W = MK.base.width, H = MK.base.height;
  const w = 0.34, h = (w * W * (sig.h / sig.w)) / H;
  mkSnapshot();
  MK.marks.push({ t: 'img', x: 0.5 - w / 2, y: clamp(0.72 - h / 2, 0, 1 - h), w, h, blob: key, rot: 0, sig: true });
  MK.sel = MK.marks.length - 1; MK.tool = 'move';
  const o = getOverlay('markup'); if (o) renderMarkup(o);
  toast('Drag the signature into place. Use the corner dot to resize.');
}
async function markupDone() {
  const d = getDoc(MK.docId), p = mkPage();
  if (!p) { closeOverlay('markup'); return; }
  const used = new Set(MK.marks.filter((m) => m.blob).map((m) => m.blob));
  for (const m of p.marks || []) if (m.blob && !used.has(m.blob)) await Store.delBlob(m.blob);
  p.marks = MK.marks.map((m) => (m.t === 'text' || m.t === 'rect' || m.t === 'img') ? { ...m, x: r4(m.x), y: r4(m.y), ...(m.w != null ? { w: r4(m.w) } : {}), ...(m.h != null ? { h: r4(m.h) } : {}) } : m);
  await busy.run('Saving…', async () => { await refreshThumb(p); await saveDoc(d); });
  MK.hist = [];
  closeOverlay('markup');
  refreshViewer(); refreshView();
  toast('Mark-up saved', { type: 'ok' });
}

Object.assign(A, {
  'mk-tool': (el) => { MK.tool = el.dataset.t; MK.sel = -1; renderMarkup(getOverlay('markup')); },
  'mk-color': (el) => {
    const c = el.dataset.c, k = el.dataset.k, sel = MK.sel >= 0 ? MK.marks[MK.sel] : null;
    if (sel) { mkSnapshot(); sel.c = c; } else MK.color[k] = c;
    renderProps(); mkDraw();
  },
  'mk-size': (el) => { MK.size[MK.tool] = +el.dataset.i; renderProps(); },
  'mk-undo': async () => {
    if (!MK.hist.length) return;
    MK.marks = JSON.parse(MK.hist.pop()); MK.sel = -1;
    MK.imgs = await preloadMarkImages(MK.marks);
    renderProps(); mkDraw();
  },
  'mk-delete': () => { if (MK.sel < 0) return; mkSnapshot(); MK.marks.splice(MK.sel, 1); MK.sel = -1; renderProps(); mkDraw(); },
  'mk-edittext': async () => {
    const m = MK.marks[MK.sel]; if (!m) return;
    const v = await promptBox('Edit text', m.v, { ok: 'Save', multiline: true });
    if (v == null || !v.trim()) return;
    mkSnapshot(); m.v = v.trim(); mkDraw();
  },
  'mk-sign': () => chooseSignature().then((sig) => sig && placeSignature(sig)).catch(handleErr),
  'mk-cancel': async () => {
    if (MK.hist.length && !(await confirmBox('Your changes to this page will be lost.', { title: 'Discard mark-up?', ok: 'Discard', danger: true }))) return;
    const p = mkPage(), keep = new Set(((p && p.marks) || []).filter((m) => m.blob).map((m) => m.blob));
    for (const m of MK.marks) if (m.blob && !keep.has(m.blob)) await Store.delBlob(m.blob);
    closeOverlay('markup');
  },
  'mk-done': () => markupDone(),
});
