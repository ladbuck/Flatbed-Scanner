// ---------------------------------------------------------------------------
// Local storage: IndexedDB with an in-memory fallback (some embedded browsers
// block IndexedDB). Holds documents, image blobs and small key/values.
// ---------------------------------------------------------------------------
const Store = {
  db: null,
  mem: null, // {docs: Map, blobs: Map, kv: Map} when IndexedDB is unavailable
  persistent: false,

  async init() {
    try {
      if (!('indexedDB' in window)) throw new Error('no idb');
      this.db = await withTimeout(new Promise((res, rej) => {
        const r = indexedDB.open('flatbed-scanner', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      }), 4000, 'IndexedDB timed out');
      // Probe a write: some sandboxes open the database but refuse writes.
      await this._tx('kv', 'readwrite', (s) => s.put(Date.now(), '_probe'));
      this.persistent = true;
    } catch (e) {
      console.warn('IndexedDB unavailable, using memory store', e);
      this.db = null;
      this.mem = { docs: new Map(), blobs: new Map(), kv: new Map() };
    }
  },
  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode);
      const s = tx.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
    });
  },
  async allDocs() {
    if (this.mem) return Array.from(this.mem.docs.values()).map((d) => structuredClone(d));
    return (await this._tx('docs', 'readonly', (s) => s.getAll())) || [];
  },
  async putDoc(doc) {
    if (this.mem) { this.mem.docs.set(doc.id, structuredClone(doc)); return; }
    await this._tx('docs', 'readwrite', (s) => s.put(doc));
  },
  async delDoc(id) {
    if (this.mem) { this.mem.docs.delete(id); return; }
    await this._tx('docs', 'readwrite', (s) => s.delete(id));
  },
  async putBlob(blob, key) {
    key = key || 'b' + uid();
    if (this.mem) { this.mem.blobs.set(key, blob); return key; }
    await this._tx('blobs', 'readwrite', (s) => s.put(blob, key));
    return key;
  },
  async getBlob(key) {
    if (!key) return null;
    if (this.mem) return this.mem.blobs.get(key) || null;
    return (await this._tx('blobs', 'readonly', (s) => s.get(key))) || null;
  },
  async delBlob(key) {
    if (!key) return;
    blobUrlRevoke(key);
    if (this.mem) { this.mem.blobs.delete(key); return; }
    await this._tx('blobs', 'readwrite', (s) => s.delete(key));
  },
  async getKV(key, def) {
    try {
      if (this.mem) return this.mem.kv.has(key) ? structuredClone(this.mem.kv.get(key)) : def;
      const v = await this._tx('kv', 'readonly', (s) => s.get(key));
      return v === undefined ? def : v;
    } catch (e) { return def; }
  },
  async setKV(key, val) {
    if (this.mem) { this.mem.kv.set(key, structuredClone(val)); return; }
    await this._tx('kv', 'readwrite', (s) => s.put(val, key));
  },
  async usage() {
    try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    return null;
  },
};

// Object URLs for stored blobs, cached by key.
const blobUrls = new Map();
async function blobUrl(key) {
  if (!key) return '';
  if (blobUrls.has(key)) return blobUrls.get(key);
  const b = await Store.getBlob(key);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  blobUrls.set(key, u);
  return u;
}
function blobUrlRevoke(key) { const u = blobUrls.get(key); if (u) { URL.revokeObjectURL(u); blobUrls.delete(key); } }
// Fill <img data-blob="key"> elements inside root.
function hydrateImages(root = document) {
  root.querySelectorAll('img[data-blob]').forEach(async (img) => {
    const key = img.dataset.blob;
    const u = await blobUrl(key);
    if (u && img.dataset.blob === key) img.src = u;
  });
}
