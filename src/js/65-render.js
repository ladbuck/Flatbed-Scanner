// ---------------------------------------------------------------------------
// Page compositing: processed scan + mark-up (+ optional watermark)
// Marks use coordinates normalised to the page (0..1).
//  ink  {t, c, w, a, hl, p:[x,y,...]}   text {t, x, y, s, c, v, rot}
//  rect {t, x, y, w, h, c}              img  {t, x, y, w, h, blob, rot}
// ---------------------------------------------------------------------------
const markImgs = new Map();
function markImage(key) {
  if (!key) return Promise.resolve(null);
  if (!markImgs.has(key)) {
    markImgs.set(key, Store.getBlob(key).then((b) => (b ? blobToImage(b) : null)).catch(() => null));
  }
  return markImgs.get(key);
}
async function preloadMarkImages(marks) {
  const out = new Map();
  for (const m of marks || []) if (m.t === 'img') out.set(m.blob, await markImage(m.blob));
  return out;
}
const MARK_FONT = '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", Arial, sans-serif';
function markFont(m, W) { return `500 ${Math.max(6, m.s * W)}px ${MARK_FONT}`; }
let _mctx = null;
function measureCtx() { if (!_mctx) _mctx = makeCanvas(4, 4).getContext('2d'); return _mctx; }
function markBox(m, W, H) {
  if (m.t === 'rect' || m.t === 'img') return { x: m.x * W, y: m.y * H, w: m.w * W, h: m.h * H };
  if (m.t === 'text') {
    const c = measureCtx(); c.font = markFont(m, W);
    const lines = String(m.v).split('\n');
    const tw = Math.max(4, ...lines.map((l) => c.measureText(l).width)), th = lines.length * m.s * W * 1.25;
    const r = ((m.rot || 0) % 4 + 4) % 4, ax = m.x * W, ay = m.y * H;
    if (r === 0) return { x: ax, y: ay, w: tw, h: th };
    if (r === 1) return { x: ax - th, y: ay, w: th, h: tw };
    if (r === 2) return { x: ax - tw, y: ay - th, w: tw, h: th };
    return { x: ax, y: ay - tw, w: th, h: tw };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m.p.length; i += 2) { const x = m.p[i] * W, y = m.p[i + 1] * H; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const lw = m.w * W / 2;
  return { x: x0 - lw, y: y0 - lw, w: x1 - x0 + lw * 2, h: y1 - y0 + lw * 2 };
}
function drawInk(ctx, m, W, H) {
  const p = m.p; if (!p || p.length < 2) return;
  ctx.save();
  ctx.globalAlpha = m.a == null ? 1 : m.a;
  if (m.hl) ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = m.c; ctx.lineWidth = Math.max(1, m.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(p[0] * W, p[1] * H);
  if (p.length === 2) ctx.lineTo(p[0] * W + 0.01, p[1] * H);
  for (let i = 2; i < p.length - 2; i += 2) {
    const xc = (p[i] + p[i + 2]) / 2 * W, yc = (p[i + 1] + p[i + 3]) / 2 * H;
    ctx.quadraticCurveTo(p[i] * W, p[i + 1] * H, xc, yc);
  }
  if (p.length >= 4) ctx.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
  ctx.stroke(); ctx.restore();
}
function drawText(ctx, m, W, H) {
  ctx.save();
  ctx.font = markFont(m, W); ctx.fillStyle = m.c; ctx.textBaseline = 'top';
  ctx.translate(m.x * W, m.y * H); ctx.rotate(((m.rot || 0) % 4) * Math.PI / 2);
  String(m.v).split('\n').forEach((l, i) => ctx.fillText(l, 0, i * m.s * W * 1.25 + m.s * W * 0.08));
  ctx.restore();
}
function drawRotImage(ctx, im, m, W, H) {
  const x = m.x * W, y = m.y * H, w = m.w * W, h = m.h * H, r = ((m.rot || 0) % 4 + 4) % 4;
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(r * Math.PI / 2);
  const dw = r % 2 ? h : w, dh = r % 2 ? w : h;
  ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh); ctx.restore();
}
function drawMarksSync(ctx, marks, W, H, imgs) {
  for (const m of marks || []) {
    if (m.t === 'ink') drawInk(ctx, m, W, H);
    else if (m.t === 'rect') { ctx.fillStyle = m.c; ctx.fillRect(m.x * W, m.y * H, m.w * W, m.h * H); }
    else if (m.t === 'text') drawText(ctx, m, W, H);
    else if (m.t === 'img') { const im = imgs && imgs.get(m.blob); if (im) drawRotImage(ctx, im, m, W, H); }
  }
}
async function drawMarks(ctx, marks, W, H) { drawMarksSync(ctx, marks, W, H, await preloadMarkImages(marks)); }

function drawWatermark(ctx, wm, W, H) {
  if (!wm || !wm.text) return;
  ctx.save();
  ctx.globalAlpha = wm.opacity == null ? 0.18 : wm.opacity;
  ctx.fillStyle = wm.color || '#d0302a';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (wm.mode === 'center') {
    let fs = W * 0.12; ctx.font = `800 ${fs}px "Schibsted Grotesk", Arial, sans-serif`;
    const tw = ctx.measureText(wm.text).width, maxW = Math.hypot(W, H) * 0.8;
    if (tw > maxW) { fs *= maxW / tw; ctx.font = `800 ${fs}px "Schibsted Grotesk", Arial, sans-serif`; }
    ctx.translate(W / 2, H / 2); ctx.rotate(-Math.atan2(H, W)); ctx.fillText(wm.text, 0, 0);
  } else {
    const fs = Math.max(12, W * 0.045);
    ctx.font = `700 ${fs}px "Schibsted Grotesk", Arial, sans-serif`;
    const tw = ctx.measureText(wm.text).width + fs * 2.2, th = fs * 3.4, R = Math.hypot(W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 6);
    let row = 0;
    for (let y = -R; y < R; y += th, row++) for (let x = -R + (row % 2 ? tw / 2 : 0); x < R; x += tw) ctx.fillText(wm.text, x, y);
  }
  ctx.restore();
}

// Render a page to a canvas. procCanvas lets callers reuse a freshly built image.
async function renderPage(page, { maxDim = 99999, marks = true, watermark = null, procCanvas = null } = {}) {
  let c;
  if (procCanvas) {
    const s = Math.min(1, maxDim / Math.max(procCanvas.width, procCanvas.height));
    c = makeCanvas(procCanvas.width * s, procCanvas.height * s);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(procCanvas, 0, 0, c.width, c.height);
  } else {
    const b = await Store.getBlob(page.proc);
    if (!b) { c = makeCanvas(600, 800); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 800); return c; }
    c = await blobToCanvas(b, maxDim);
  }
  const ctx = c.getContext('2d');
  if (marks && page.marks && page.marks.length) await drawMarks(ctx, page.marks, c.width, c.height);
  if (watermark) drawWatermark(ctx, watermark, c.width, c.height);
  return c;
}

// Quarter-turn mark coordinates with the page (dir 1 = clockwise). W,H = old page size.
function rotateMarks(marks, W, H, dir = 1) {
  const turns = ((dir % 4) + 4) % 4;
  let out = marks.map((m) => structuredClone(m)), w = W, h = H;
  for (let t = 0; t < turns; t++) {
    out = out.map((m) => {
      if (m.t === 'ink') { const p = []; for (let i = 0; i < m.p.length; i += 2) p.push(1 - m.p[i + 1], m.p[i]); return { ...m, p, w: m.w * w / h }; }
      if (m.t === 'text') return { ...m, x: 1 - m.y, y: m.x, s: m.s * w / h, rot: ((m.rot || 0) + 1) % 4 };
      const n = { ...m, x: 1 - m.y - m.h, y: m.x, w: m.h, h: m.w };
      if (m.t === 'img') n.rot = ((m.rot || 0) + 1) % 4;
      return n;
    });
    [w, h] = [h, w];
  }
  return out;
}
