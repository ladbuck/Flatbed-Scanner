// ---------------------------------------------------------------------------
// Runs image processing in a Web Worker built from the ip* sources, falling
// back to the main thread if workers are unavailable.
// ---------------------------------------------------------------------------
const IP = {
  w: null, seq: 0, pending: new Map(), failed: false,
  start() {
    if (this.w || this.failed) return;
    try {
      const src = IP_FUNCS.map((f) => f.toString()).join('\n') + `
self.onmessage = function (e) {
  var m = e.data, res, tr = [];
  try {
    if (m.op === 'process') res = ipProcess(m.p);
    else if (m.op === 'detect') res = ipDetectQuad(m.p.img);
    else if (m.op === 'cutout') res = ipInkCutout(m.p.img, m.p.color);
    else if (m.op === 'pack1') res = ipPack1Bit(m.p.img);
    else if (m.op === 'filter') res = ipAdjust(ipFilter(m.p.img, m.p.filter), m.p.adj);
    if (res && res.data && res.data.buffer) tr.push(res.data.buffer);
    else if (res && res.img && res.img.data) tr.push(res.img.data.buffer);
    else if (res instanceof Uint8Array) tr.push(res.buffer);
    self.postMessage({ id: m.id, res: res }, tr);
  } catch (err) { self.postMessage({ id: m.id, err: String((err && err.message) || err) }); }
};`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.w = new Worker(url);
      this.w.onmessage = (e) => {
        const p = this.pending.get(e.data.id); if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.err) p.rej(new Error(e.data.err)); else p.res(e.data.res);
      };
      this.w.onerror = (e) => {
        console.warn('Image worker failed; processing on main thread', e && e.message);
        this.failed = true; try { this.w.terminate(); } catch (x) { /* ignore */ }
        this.w = null;
        const list = Array.from(this.pending.values()); this.pending.clear();
        list.forEach((p) => p.fallback());
      };
    } catch (e) { this.failed = true; this.w = null; }
  },
  local(op, p) {
    if (op === 'process') return ipProcess(p);
    if (op === 'detect') return ipDetectQuad(p.img);
    if (op === 'cutout') return ipInkCutout(p.img, p.color);
    if (op === 'pack1') return ipPack1Bit(p.img);
    if (op === 'filter') return ipAdjust(ipFilter(p.img, p.filter), p.adj);
    throw new Error('Unknown op ' + op);
  },
  run(op, p) {
    this.start();
    if (!this.w) return new Promise((res) => setTimeout(res, 0)).then(() => this.local(op, p));
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { res, rej, fallback: () => { try { res(this.local(op, p)); } catch (err) { rej(err); } } });
      // Copy (no transfer) so the main-thread fallback can still use the input.
      this.w.postMessage({ id, op, p });
    });
  },
};

// ------------------------------ Canvas helpers -----------------------------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try { await img.decode(); }
  catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('This image could not be opened. Try a JPG or PNG.');
  }
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return img;
}
async function blobToCanvas(blob, maxDim = 99999) {
  const img = await blobToImage(blob);
  const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxDim / Math.max(w, h));
  const c = makeCanvas(w * s, h * s), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function scaleCanvas(src, maxDim) {
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const c = makeCanvas(src.width * s, src.height * s), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const getImageData = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height);
function imgDataToCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}
function canvasToBlob(c, type = 'image/jpeg', q = 0.88) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image encoding failed'))), type, q));
}
async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }
