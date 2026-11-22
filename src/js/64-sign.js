// ---------------------------------------------------------------------------
// Signatures: draw pad, import from photo, picker, and the sign flow
// ---------------------------------------------------------------------------
async function saveSignature(blob, w, h) {
  const key = await Store.putBlob(blob);
  const sig = { id: uid(), key, w, h, createdAt: Date.now() };
  const sigs = await Store.getKV('sigs', []);
  sigs.unshift(sig);
  await Store.setKV('sigs', sigs);
  Cloud.sigAdded(sig);
  return sig;
}
function trimCanvas(c, pad = 8) {
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    if (d[(y * c.width + xx) * 4 + 3] > 8) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function signaturePad() {
  return new Promise((resolve) => {
    let result = null, color = "#14171a";
    const strokes = [];
    const COLORS = ['#14171a', '#1f3fd6', '#c42a2a'], WEIGHTS = [1.6, 2.6, 4];
    const s = openSheet({
      title: 'Draw your signature',
      body: `<div class="sigpad-wrap"><canvas id="sigpad" aria-label="Signature drawing area"></canvas><div class="sigpad-line"></div><div class="sigpad-hint">Sign above the line</div></div>
        <div class="row" style="flex-wrap:wrap">
          <div class="swatches" id="sp-colors">${COLORS.map((c, i) => `<button class="swatch ${i === 0 ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Ink colour ${i + 1}"></button>`).join('')}</div>
          <span class="grow"></span>
          <div class="seg" id="sp-w">${['Fine', 'Medium', 'Bold'].map((l, i) => `<button class="${i === 1 ? 'on' : ''}" data-w="${i}">${l}</button>`).join('')}</div>
          <button class="btn btn-sm" id="sp-clear">${ic('undo')}<span>Clear</span></button>
        </div>`,
      actions: [{ label: 'Cancel' }, {
        label: 'Save signature', primary: true, fn: async () => {
          if (!strokes.length) { toast('Sign in the box first.'); return false; }
          const scale = 3, r = cv.getBoundingClientRect();
          const big = makeCanvas(r.width * scale, r.height * scale);
          paint(big.getContext('2d'), scale);
          const t = trimCanvas(big, 10);
          if (!t) return false;
          const fin = scaleCanvas(t, 1200);
          result = await saveSignature(await canvasToBlob(fin, 'image/png'), fin.width, fin.height);
        },
      }],
      onClose: () => resolve(result),
    });
    s.el.style.maxWidth = '640px';
    const cv = s.el.querySelector('#sigpad');
    let weightSel = 1;
    function paint(ctx, scale) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const st of strokes) {
        const p = st.p; ctx.strokeStyle = st.c; ctx.lineWidth = st.w * scale;
        ctx.beginPath(); ctx.moveTo(p[0] * scale, p[1] * scale);
        if (p.length === 2) ctx.lineTo(p[0] * scale + 0.1, p[1] * scale);
        for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i] * scale, p[i + 1] * scale, (p[i] + p[i + 2]) / 2 * scale, (p[i + 1] + p[i + 3]) / 2 * scale);
        if (p.length >= 4) ctx.lineTo(p[p.length - 2] * scale, p[p.length - 1] * scale);
        ctx.stroke();
      }
    }
    function fit() {
      const r = cv.getBoundingClientRect(), d = DPR();
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
      paint(cv.getContext('2d'), d);
    }
    requestAnimationFrame(fit);
    let cur = null;
    cv.onpointerdown = (e) => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      cur = { c: color, w: WEIGHTS[weightSel], p: [e.clientX - r.left, e.clientY - r.top] };
      strokes.push(cur); paint(cv.getContext('2d'), DPR());
    };
    cv.onpointermove = (e) => {
      if (!cur) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, p = cur.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 1.2) { p.push(x, y); paint(cv.getContext('2d'), DPR()); }
    };
    cv.onpointerup = cv.onpointercancel = () => { cur = null; };
    s.el.querySelector('#sp-clear').onclick = () => { strokes.length = 0; paint(cv.getContext('2d'), DPR()); };
    s.el.querySelectorAll('#sp-colors .swatch').forEach((b) => b.onclick = () => { color = b.dataset.c; s.el.querySelectorAll('#sp-colors .swatch').forEach((x) => x.classList.toggle('on', x === b)); });
    s.el.querySelectorAll('#sp-w button').forEach((b) => b.onclick = () => { weightSel = +b.dataset.w; s.el.querySelectorAll('#sp-w button').forEach((x) => x.classList.toggle('on', x === b)); });
  });
}

async function signatureFromPhoto(file) {
  return busy.run('Lifting the signature…', async () => {
    const c = await blobToCanvas(file, 1400);
    const res = await IP.run('cutout', { img: getImageData(c), color: null });
    if (!res.box) throw new Error('No ink found. Photograph the signature on plain white paper.');
    const full = imgDataToCanvas(res.img);
    const [x0, y0, x1, y1] = res.box, pad = 12;
    const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad), bw = Math.min(full.width, x1 + pad) - bx, bh = Math.min(full.height, y1 + pad) - by;
    const out = makeCanvas(bw, bh); out.getContext('2d').drawImage(full, bx, by, bw, bh, 0, 0, bw, bh);
    const fin = scaleCanvas(out, 1200);
    return saveSignature(await canvasToBlob(fin, 'image/png'), fin.width, fin.height);
  });
}
function signatureFromPhotoFlow(then) {
  menuSheet('Signature from a photo', [
    { icon: 'camera', label: 'Take a photo', desc: 'Sign on white paper first', fn: () => pickFiles('camera', false).then((f) => f.length && signatureFromPhoto(f[0])).then((sig) => { if (sig) { toast('Signature saved', { type: 'ok' }); if (then) then(sig); } }).catch(handleErr) },
    { icon: 'image', label: 'Choose a photo', fn: () => pickFiles('gallery', false).then((f) => f.length && signatureFromPhoto(f[0])).then((sig) => { if (sig) { toast('Signature saved', { type: 'ok' }); if (then) then(sig); } }).catch(handleErr) },
  ]);
}

// Resolve with a signature to place, or null.
async function chooseSignature() {
  const sigs = await Store.getKV('sigs', []);
  if (!sigs.length) return signaturePad();
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet({
      title: 'Choose a signature',
      body: `<div class="sig-list" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${sigs.map((g) => `<button class="sig-card" data-id="${g.id}" style="padding:6px"><div class="sig-img" style="height:84px"><img data-blob="${esc(g.key)}" alt="Signature"></div></button>`).join('')}</div>
        <div class="row" style="flex-wrap:wrap"><button class="btn btn-sm" id="cs-new">${ic('pen')}<span>Draw a new one</span></button><button class="btn btn-sm" id="cs-photo">${ic('camera')}<span>From a photo</span></button></div>`,
      onClose: () => resolve(result),
    });
    hydrateImages(s.el);
    s.el.querySelectorAll('.sig-card').forEach((b) => b.onclick = () => { result = sigs.find((g) => g.id === b.dataset.id); s.close(); });
    s.el.querySelector('#cs-new').onclick = () => { s.close(); signaturePad().then((sig) => resolve(sig)); };
    s.el.querySelector('#cs-photo').onclick = () => { s.close(); signatureFromPhotoFlow((sig) => resolve(sig)); };
  });
}
function signFlow(doc) {
  const go2 = (i) => chooseSignature().then((sig) => sig && openMarkup(doc.id, doc.pages[i].id, { signature: sig })).catch(handleErr);
  if (doc.pages.length === 1) { go2(0); return; }
  menuSheet('Sign which page?', doc.pages.map((p, i) => ({ thumb: p.thumb, label: `Page ${i + 1}`, desc: i === doc.pages.length - 1 ? 'Last page' : '', fn: () => go2(i) })));
}

Object.assign(A, {
  'sig-new': () => signaturePad().then((s) => { if (s) { toast('Signature saved', { type: 'ok' }); renderSigList(); } }),
  'sig-photo': () => signatureFromPhotoFlow(() => renderSigList()),
  'sig-del': async (el) => {
    if (!(await confirmBox('Pages you already signed keep their copy.', { title: 'Delete this signature?', ok: 'Delete', danger: true }))) return;
    let sigs = await Store.getKV('sigs', []);
    const sig = sigs.find((x) => x.id === el.dataset.id); if (!sig) return;
    sigs = sigs.filter((x) => x !== sig);
    await Store.setKV('sigs', sigs);
    await Cloud.sigDeleted(sig);
    await Store.delBlob(sig.key);
    renderSigList();
  },
});
