// ---------------------------------------------------------------------------
// Cloud backup & sync across devices, using the artifact's private per-user
// database (document metadata) and asset storage (page images).
// Local IndexedDB stays the working copy; the cloud is the durable copy.
// ---------------------------------------------------------------------------
const Cloud = {
  state: 'off', note: '', lastSync: 0,
  db: null, assets: null, uid: null, col: null, sigCol: null,
  map: {}, rev: {}, queue: Promise.resolve(), timers: {},

  setState(s, note = '') { this.state = s; this.note = note; renderCloudChip(); },
  get ready() { return !!this.col && S.settings.cloud !== false; },

  async init() {
    if (!IN_CLAUDE) { this.setState('unavailable', 'Your scans are saved in this browser on this device. Export important documents as PDFs to keep a copy somewhere else.'); return; }
    this.setState('connecting');
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) { this.setState('unavailable', 'Sign in to Claude to back up your scans.'); return; }
      const assets = await window.claude.use('assets');
      if (!assets) { this.setState('unavailable', 'Cloud backup is available to the app’s owner and editors. Your scans stay on this device.'); return; }
      const id = await user.id();
      if (!id) { this.setState('unavailable', 'Sign in to Claude to back up your scans.'); return; }
      this.db = db; this.assets = assets; this.uid = id;
      const lib = db.doc(`data/users/${id}/library`);
      this.col = lib.collection('docs');
      this.sigCol = lib.collection('sigs');
      this.map = await Store.getKV('assetMap', {});
      this.rev = {}; for (const k of Object.keys(this.map)) this.rev[this.map[k]] = k;
      this.setState('ready');
      if (S.settings.cloud !== false) this.syncAll().catch(() => {});
    } catch (e) {
      console.warn('Cloud init', e);
      this.setState('error', 'Cloud backup could not start.');
    }
  },

  enqueue(fn) {
    const run = this.queue.then(() => fn());
    this.queue = run.catch((e) => {
      console.warn('Cloud', e);
      const code = e && e.code;
      const msg = code === 'quota_or_state' || code === 'quota_exceeded' ? 'Cloud storage is full. Delete some documents to keep backing up.'
        : code === 'rate_limited' || code === 'resource_exhausted' ? 'Backing up too fast; will retry on the next change.'
        : 'Backup paused: ' + ((e && (e.message || e.code)) || 'unknown error');
      this.setState('error', msg);
    });
    return run;
  },
  async saveMap() { await Store.setKV('assetMap', this.map); },
  forgetAsset(id) { const k = this.rev[id]; if (k) { delete this.map[k]; delete this.rev[id]; } },

  async upKey(key, type) {
    if (!key) return null;
    if (this.map[key]) return this.map[key];
    const blob = await Store.getBlob(key);
    if (!blob) return null;
    const r = await this.assets.upload(blob, { type });
    this.map[key] = r.id; this.rev[r.id] = key;
    await this.saveMap();
    return r.id;
  },
  async downAsset(assetId) {
    if (!assetId) return null;
    const k = this.rev[assetId];
    if (k && await Store.getBlob(k)) return k;
    const r = await fetch('/_blob/' + assetId);
    if (!r.ok) throw new Error('A file is missing from cloud storage');
    const key = await Store.putBlob(await r.blob());
    this.map[key] = assetId; this.rev[assetId] = key;
    await this.saveMap();
    return key;
  },

  touch(doc) {
    if (!this.ready || doc.sample) return;
    clearTimeout(this.timers[doc.id]);
    this.timers[doc.id] = setTimeout(() => {
      delete this.timers[doc.id];
      this.enqueue(async () => {
        const live = S.docs.find((d) => d.id === doc.id);
        if (!live) return;
        this.setState('syncing');
        await this.pushDoc(live);
        this.lastSync = Date.now();
        this.setState('ready');
      });
    }, 1500);
  },

  async pushDoc(doc) {
    const ids = [], pages = [];
    for (const p of doc.pages) {
      const a = {
        orig: await this.upKey(p.orig, 'image/jpeg'),
        proc: await this.upKey(p.proc, 'image/jpeg'),
        thumb: await this.upKey(p.thumb, 'image/jpeg'),
      };
      const marks = [];
      for (const m of p.marks || []) {
        const mm = Object.assign({}, m);
        if (m.blob) { mm.asset = await this.upKey(m.blob, 'image/png'); delete mm.blob; }
        marks.push(mm);
      }
      if (marks.length || p.ocr) {
        const json = JSON.stringify({ marks, ocr: p.ocr || null });
        const h = await sha1hex(json);
        if (p.cloudExtra && p.cloudExtra.h === h) a.extra = p.cloudExtra.id;
        else {
          const r = await this.assets.upload(new Blob([json], { type: 'application/json' }), { type: 'application/json' });
          a.extra = r.id; p.cloudExtra = { h, id: r.id };
        }
      } else { delete p.cloudExtra; }
      for (const v of Object.values(a)) if (v) ids.push(v);
      for (const m of marks) if (m.asset) ids.push(m.asset);
      pages.push({ id: p.id, ow: p.ow, oh: p.oh, pw: p.pw, ph: p.ph, quad: p.quad, filter: p.filter, adj: p.adj || null, rot: p.rot || 0, kind: p.kind || null, a });
    }
    const body = { v: 1, title: doc.title, folder: doc.folder || '', starred: !!doc.starred, createdAt: doc.createdAt, updatedAt: doc.updatedAt, pages };
    await this.col.doc(doc.id).set(body);
    const keep = new Set(ids);
    for (const id of doc.cloudAssets || []) {
      if (keep.has(id)) continue;
      try { await this.assets.delete(id); } catch (e) { /* already gone */ }
      this.forgetAsset(id);
    }
    await this.saveMap();
    doc.cloudAssets = ids; doc.cloudAt = doc.updatedAt;
    await Store.putDoc(doc);
  },

  async pullDoc(id, body, local) {
    const pages = [], ids = [];
    for (const cp of body.pages || []) {
      const a = cp.a || {};
      const lp = local && local.pages.find((x) => x.id === cp.id);
      const p = { id: cp.id, ow: cp.ow, oh: cp.oh, pw: cp.pw, ph: cp.ph, quad: cp.quad, filter: cp.filter, adj: cp.adj || { b: 0, c: 0, s: 0 }, rot: cp.rot || 0, marks: [], ocr: null };
      if (cp.kind) p.kind = cp.kind;
      p.orig = await this.downAsset(a.orig);
      p.proc = await this.downAsset(a.proc);
      p.thumb = await this.downAsset(a.thumb);
      if (a.extra) {
        if (lp && lp.cloudExtra && lp.cloudExtra.id === a.extra) { p.marks = lp.marks; p.ocr = lp.ocr; p.cloudExtra = lp.cloudExtra; }
        else {
          const r = await fetch('/_blob/' + a.extra);
          if (r.ok) {
            const text = await r.text(), j = JSON.parse(text);
            for (const m of j.marks || []) { if (m.asset) { ids.push(m.asset); m.blob = await this.downAsset(m.asset); delete m.asset; } }
            p.marks = j.marks || []; p.ocr = j.ocr || null; p.cloudExtra = { id: a.extra, h: await sha1hex(text) };
          }
        }
      }
      for (const v of Object.values(a)) if (v) ids.push(v);
      if (p.proc) pages.push(p);
    }
    const doc = { id, title: body.title || 'Untitled', folder: body.folder || '', starred: !!body.starred, createdAt: body.createdAt || Date.now(), updatedAt: body.updatedAt || Date.now(), pages, cloudAssets: ids, cloudAt: body.updatedAt };
    if (local) {
      const used = new Set(docBlobKeys(doc));
      for (const k of docBlobKeys(local)) if (!used.has(k)) await Store.delBlob(k);
    }
    await Store.putDoc(doc);
    const i = S.docs.findIndex((d) => d.id === id);
    if (i >= 0) S.docs[i] = doc; else S.docs.push(doc);
  },

  async deleteRemote(id, assetIds) {
    await this.col.doc(id).set({ deleted: true, updatedAt: Date.now() });
    for (const a of assetIds || []) { try { await this.assets.delete(a); } catch (e) { /* ignore */ } this.forgetAsset(a); }
    await this.saveMap();
  },
  async docDeleted(doc) {
    if (doc.sample) return;
    if (this.ready) { this.enqueue(() => this.deleteRemote(doc.id, doc.cloudAssets)); return; }
    if (doc.cloudAt) { const t = await Store.getKV('tombstones', {}); t[doc.id] = { at: Date.now(), assets: doc.cloudAssets || [] }; await Store.setKV('tombstones', t); }
  },

  syncAll() {
    if (!this.ready) return Promise.resolve();
    return this.enqueue(async () => {
      this.setState('syncing');
      const snap = await withTimeout(this.col.get(), 20000, 'The cloud did not answer');
      const cloud = new Map();
      for (const d of snap.docs) if (d.exists) cloud.set(d.id, d.data());
      const tomb = await Store.getKV('tombstones', {});
      for (const id of Object.keys(tomb)) {
        const c = cloud.get(id);
        if (!c || !c.deleted) {
          const all = new Set([...(c && c.pages ? collectBodyAssets(c) : []), ...((tomb[id] && tomb[id].assets) || [])]);
          await this.deleteRemote(id, Array.from(all));
        }
        delete tomb[id];
        await Store.setKV('tombstones', tomb);
        cloud.set(id, { deleted: true });
      }
      for (const local of S.docs.slice()) {
        if (local.sample) continue;
        const c = cloud.get(local.id);
        if (!c) { await this.pushDoc(local); continue; }
        if (c.deleted) {
          if ((c.updatedAt || 0) >= local.updatedAt) await removeDocLocal(local.id, true);
          else await this.pushDoc(local);
          continue;
        }
        if (local.updatedAt > (c.updatedAt || 0)) await this.pushDoc(local);
        else if ((c.updatedAt || 0) > local.updatedAt) await this.pullDoc(local.id, c, local);
      }
      for (const [id, c] of cloud) {
        if (c.deleted || S.docs.find((d) => d.id === id)) continue;
        await this.pullDoc(id, c, null);
      }
      await this.syncSigs();
      this.lastSync = Date.now();
      this.setState('ready');
      refreshView();
    });
  },

  async syncSigs() {
    const snap = await withTimeout(this.sigCol.get(), 20000, 'The cloud did not answer');
    const cloud = new Map();
    for (const d of snap.docs) if (d.exists) cloud.set(d.id, d.data());
    let sigs = await Store.getKV('sigs', []);
    const tomb = await Store.getKV('sigTombstones', {});
    for (const id of Object.keys(tomb)) {
      const c = cloud.get(id);
      if (c && !c.deleted) { await this.sigCol.doc(id).set({ deleted: true, at: Date.now() }); if (c.asset) { try { await this.assets.delete(c.asset); } catch (e) { /* ignore */ } this.forgetAsset(c.asset); } }
      delete tomb[id]; cloud.set(id, { deleted: true });
    }
    await Store.setKV('sigTombstones', tomb);
    let changed = false;
    for (const s of sigs.slice()) {
      const c = cloud.get(s.id);
      if (!c) { const asset = await this.upKey(s.key, 'image/png'); await this.sigCol.doc(s.id).set({ asset, w: s.w, h: s.h, createdAt: s.createdAt }); }
      else if (c.deleted) { sigs = sigs.filter((x) => x.id !== s.id); await Store.delBlob(s.key); changed = true; }
    }
    for (const [id, c] of cloud) {
      if (c.deleted || sigs.find((x) => x.id === id) || !c.asset) continue;
      const key = await this.downAsset(c.asset);
      sigs.push({ id, key, w: c.w, h: c.h, createdAt: c.createdAt || Date.now() }); changed = true;
    }
    if (changed) await Store.setKV('sigs', sigs);
  },
  sigAdded(sig) {
    if (!this.ready) return;
    this.enqueue(async () => { const asset = await this.upKey(sig.key, 'image/png'); await this.sigCol.doc(sig.id).set({ asset, w: sig.w, h: sig.h, createdAt: sig.createdAt }); });
  },
  async sigDeleted(sig) {
    if (this.ready) {
      const asset = this.map[sig.key];
      this.enqueue(async () => { await this.sigCol.doc(sig.id).set({ deleted: true, at: Date.now() }); if (asset) { try { await this.assets.delete(asset); } catch (e) { /* ignore */ } this.forgetAsset(asset); await this.saveMap(); } });
    } else { const t = await Store.getKV('sigTombstones', {}); t[sig.id] = Date.now(); await Store.setKV('sigTombstones', t); }
  },
  async usage() {
    if (!this.assets) return null;
    try { const r = await this.assets.list(); return r.usage; } catch (e) { return null; }
  },
};

function collectBodyAssets(body) {
  const ids = [];
  for (const p of body.pages || []) for (const v of Object.values(p.a || {})) if (v) ids.push(v);
  return ids;
}
async function sha1hex(s) {
  const d = await crypto.subtle.digest('SHA-1', TE.encode(s));
  return hex(new Uint8Array(d));
}
