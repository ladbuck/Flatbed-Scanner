// ---------------------------------------------------------------------------
// OCR (Tesseract, bundled language data), PDF import (pdf.js), QR decoding.
// ---------------------------------------------------------------------------
const OCR_LANGS = [
  { code: 'eng', label: 'English' },
  { code: 'nep', label: 'Nepali · नेपाली' },
  { code: 'hin', label: 'Hindi · हिन्दी' },
  { code: 'eng+nep', label: 'English + Nepali' },
  { code: 'eng+hin', label: 'English + Hindi' },
];

function b64ToBytes(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const OCR = {
  worker: null, lang: null, loading: null, onLog: null,
  async ensure(lang, onProgress) {
    if (this.worker && this.lang === lang) return this.worker;
    if (this.loading) { try { await this.loading; } catch (e) { /* retry below */ } if (this.worker && this.lang === lang) return this.worker; }
    this.loading = (async () => {
      if (this.worker) { try { await this.worker.terminate(); } catch (e) { /* ignore */ } this.worker = null; this.lang = null; }
      await loadScript(absUrl('lib/tesseract/tesseract.min.js'));
      if (onProgress) onProgress(0.04, 'Loading text recognition…');
      const langs = [];
      for (const c of lang.split('+')) {
        const r = await fetch(absUrl(`lib/ocr/${c}.traineddata.b64.txt`));
        if (!r.ok) throw new Error('Could not load text recognition data');
        langs.push({ code: c, data: b64ToBytes((await r.text()).trim()) });
      }
      if (onProgress) onProgress(0.15, 'Starting text recognition…');
      this.worker = await withTimeout(window.Tesseract.createWorker(langs, 1, {
        workerPath: absUrl('lib/tesseract/worker.min.js'),
        corePath: absUrl('lib/tesseract/'),
        cacheMethod: 'none',
        workerBlobURL: true,
        logger: (m) => { if (this.onLog) this.onLog(m); },
        errorHandler: (e) => console.warn('OCR worker', e),
      }), 120000, 'OCR start timed out');
      this.lang = lang;
    })();
    try { await this.loading; }
    catch (e) {
      console.warn('OCR start failed', e);
      this.worker = null; this.lang = null;
      throw new Error(navigator.onLine === false
        ? 'Text recognition needs an internet connection the first time you use it. Connect once, then it works offline.'
        : 'Text recognition could not start. Check your connection and try again.');
    } finally { this.loading = null; }
    return this.worker;
  },
  async recognize(blob, lang, onProgress) {
    const w = await this.ensure(lang, onProgress);
    this.onLog = (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(0.2 + 0.8 * (m.progress || 0), 'Reading text…'); };
    try {
      const { data } = await w.recognize(blob, {}, { text: true, blocks: true });
      return data;
    } finally { this.onLog = null; }
  },
};

const r4 = (v) => Math.round(v * 10000) / 10000;
function ocrResultToPage(data, w, h, lang) {
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    if (!wd.text || !wd.text.trim() || wd.confidence < 15) continue;
    const bb = wd.bbox;
    words.push({ s: wd.text, x: r4(bb.x0 / w), y: r4(bb.y0 / h), w: r4((bb.x1 - bb.x0) / w), h: r4((bb.y1 - bb.y0) / h) });
  }
  const text = String(data.text || '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, words, lang, src: 'ocr', at: Date.now() };
}

// ------------------------------- PDF import --------------------------------
const PDFIn = {
  async lib() {
    await loadScript(absUrl('lib/pdfjs/pdf.min.js'));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = absUrl('lib/pdfjs/pdf.worker.min.js');
    return window.pdfjsLib;
  },
  async open(file) {
    const lib = await this.lib();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = lib.getDocument({ data, isEvalSupported: false });
    let asked = 0;
    task.onPassword = (update, reason) => {
      asked++;
      busy.hide();
      promptBox(reason === 2 ? 'Wrong password. Try again.' : `“${file.name}” is password protected`, '', { type: 'password', ok: 'Open', label: 'PDF password' })
        .then((pw) => { busy.show('Opening PDF…'); if (pw === null) task.destroy(); else update(pw); });
    };
    try { return await task.promise; }
    catch (e) {
      if (asked && /destroy|cancel/i.test(String(e && e.message))) throw new Error('Cancelled');
      throw new Error('This PDF could not be opened.');
    }
  },
  async renderPage(pdf, n, maxDim = 99999, maxPx = 16e6, dpi = 300) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(dpi / 72, maxDim / Math.max(base.width, base.height), Math.sqrt(maxPx / (base.width * base.height)));
    const vp = page.getViewport({ scale });
    const c = makeCanvas(vp.width, vp.height), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    let ocr = null;
    try {
      const tc = await page.getTextContent();
      const words = []; let text = '';
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        text += it.str + (it.hasEOL ? '\n' : (it.str ? ' ' : ''));
        if (!it.str.trim()) continue;
        const tx = it.transform, x = tx[4], y = tx[5], hgt = Math.hypot(tx[2], tx[3]) || it.height || 10;
        const r = vp.convertToViewportRectangle([x, y - hgt * 0.2, x + it.width, y + hgt * 0.85]);
        const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]);
        words.push({ s: it.str, x: r4(x0 / c.width), y: r4(y0 / c.height), w: r4((x1 - x0) / c.width), h: r4((y1 - y0) / c.height) });
      }
      text = text.replace(/[ \t]+\n/g, '\n').trim();
      if (text.length > 3) ocr = { text, words, lang: 'pdf', src: 'pdf', at: Date.now() };
    } catch (e) { /* scanned PDF without text */ }
    page.cleanup();
    return { canvas: c, ocr };
  },
};

// --------------------------------- QR --------------------------------------
async function decodeCodes(file) {
  const c = await blobToCanvas(file, 1600);
  if ('BarcodeDetector' in window) {
    try {
      const bd = new window.BarcodeDetector();
      const r = await bd.detect(c);
      if (r && r.length) return r.map((x) => ({ text: x.rawValue, format: x.format }));
    } catch (e) { /* fall back to jsQR */ }
  }
  await loadScript(absUrl('lib/jsQR.js'));
  for (const dim of [1600, 1000, 600]) {
    const cc = scaleCanvas(c, dim), id = getImageData(cc);
    const res = window.jsQR(id.data, id.width, id.height, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) return [{ text: res.data, format: 'qr_code' }];
  }
  return [];
}
