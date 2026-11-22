// ---------------------------------------------------------------------------
// Ask Claude: summarize, translate, transcribe (incl. handwriting), Q&A, naming.
// Runs on the viewer's own Claude account through the artifact `sample` capability.
// ---------------------------------------------------------------------------
const AI_LANGS = ['English', 'Nepali', 'Hindi', 'Spanish', 'French', 'German', 'Portuguese', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Arabic', 'Bengali', 'Urdu', 'Russian'];
const Assist = {
  sample: null, limits: null, checked: false,
  async init() {
    if (window.claude && typeof window.claude.use === 'function') {
      try { this.sample = await window.claude.use('sample'); } catch (e) { this.sample = null; }
      if (this.sample) { try { this.limits = await this.sample.limits(); } catch (e) { this.limits = null; } }
    }
    this.checked = true;
    updateAIVisibility();
  },
  get ok() { return !!this.sample; },
  get maxImages() { return (this.limits && this.limits.images && this.limits.images.maxCount) || 0; },
  errText(e) {
    switch (e && e.code) {
      case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed':
        this.sample = null; updateAIVisibility(); return 'Claude isn’t available for this app on your account.';
      case 'rate_limited': return e.reason === 'usage_limit' ? 'You’ve reached your Claude usage limit for now. Try again later.' : 'Too many requests at once. Wait a moment, then try again.';
      case 'session_expired': return 'Your Claude session expired. Sign in again, then retry.';
      case 'image_rejected': return 'Claude couldn’t read one of the page images.';
      case 'images_unavailable': return 'Page images can’t be sent here. Use Text first, then try again.';
      case 'prompt_too_large': return 'This document is too long to send at once. Select fewer pages.';
      case 'refused': return 'Claude declined this request.';
      case 'invalid_json': case 'empty_completion': return 'Claude didn’t return an answer. Try again.';
      case 'cancelled': return 'Stopped.';
      default: return (e && e.message && !e.code) ? e.message : 'Claude couldn’t finish. Try again.';
    }
  },
  async suggestName(doc) {
    const text = docText(doc).trim().slice(0, 3000);
    const opts = { modelTier: 'quick' };
    let prompt = 'Suggest a short, specific file name for this scanned document (2 to 6 words, no file extension; include a date or number only if it identifies the document) and pick the best folder from: Receipts, Bills, ID & Certificates, Work, School, Medical, Legal, Notes, Other. Reply with only JSON like {"title": "Electricity bill October 2026", "folder": "Bills"}.';
    if (text.length > 30) prompt += `\n\nText recognised from the document (may contain OCR errors):\n${text}`;
    else if (this.maxImages) { opts.images = [await canvasToBlob(await renderPage(doc.pages[0], { maxDim: 1400, marks: false }), 'image/jpeg', 0.8)]; prompt += '\n\nThe first page is attached as an image.'; }
    else throw new Error('Use Text on this document first, then try again.');
    const r = await this.sample.json(prompt, opts);
    if (!r || typeof r.title !== 'string') return null;
    return { title: r.title.trim().slice(0, 80), folder: typeof r.folder === 'string' ? r.folder.trim().slice(0, 40) : '' };
  },
};
function updateAIVisibility() {
  $$('.ai-only').forEach((el) => { el.hidden = !Assist.ok; });
  const n = $('#ai-note');
  if (n) { n.hidden = Assist.ok; n.textContent = Assist.checked ? 'These tools use your Claude account and aren’t available in this view.' : 'Checking whether Claude is available…'; }
}

const AI_MODES = [
  { id: 'summary', label: 'Summarize', icon: 'list' },
  { id: 'translate', label: 'Translate', icon: 'globe' },
  { id: 'extract', label: 'Transcribe', icon: 'sparkle' },
  { id: 'ask', label: 'Ask', icon: 'chat' },
];
function openAI(doc, mode = 'summary', pageIds = null) {
  if (!Assist.ok) { toast(Assist.checked ? 'Ask Claude isn’t available in this view.' : 'Still connecting to Claude. Try again in a moment.'); return; }
  const pages = pageIds ? doc.pages.filter((p) => pageIds.includes(p.id)) : doc.pages.slice();
  const st = { mode, lang: 'English', running: null, out: '', chat: [], status: '' };
  const s = openSheet({ title: 'Ask Claude', wide: true, onClose: () => { if (st.running) st.running.abort(); } });
  const body = s.body;
  function draw() {
    const scope = pages.length === doc.pages.length ? `All ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : `${pages.length} of ${doc.pages.length} pages`;
    const desc = {
      summary: 'A short overview with the key names, dates, amounts and deadlines.',
      translate: 'Translates the whole document, keeping its layout.',
      extract: 'Claude reads the page images directly. Good for handwriting and mixed languages.',
      ask: 'Ask anything about this document.',
    }[st.mode];
    body.innerHTML = `
      <div class="seg ai-tabs" role="group" aria-label="What should Claude do?">${AI_MODES.map((m) => `<button type="button" class="${m.id === st.mode ? 'on' : ''}" data-m="${m.id}">${ic(m.icon)}${m.label}</button>`).join('')}</div>
      <p class="note">${esc(desc)} <span class="mono">· ${esc(scope)}</span></p>
      ${st.mode === 'translate' || st.mode === 'summary' ? `<label class="field"><span class="field-label">${st.mode === 'translate' ? 'Translate into' : 'Write the summary in'}</span><select class="select" id="ai-lang">${AI_LANGS.map((l) => `<option ${l === st.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${st.mode === 'ask' ? `<div class="textout" id="ai-chat" style="min-height:80px">${st.chat.length ? st.chat.map((t) => `<p style="margin:0 0 10px"><b>${t.role === 'user' ? 'You' : 'Claude'}:</b> ${esc(t.content)}</p>`).join('') : '<span class="note">Try “When is the payment due?” or “List every amount on this page.”</span>'}</div>
        <div class="row"><input class="input grow" id="ai-q" placeholder="Ask about this document" autocomplete="off" enterkeyhint="send"><button class="btn btn-primary" id="ai-send" ${st.running ? 'disabled' : ''}>${ic('chat')}<span>Ask</span></button></div>`
      : `<div class="row"><button class="btn btn-primary" id="ai-run" ${st.running ? 'disabled' : ''}>${ic('sparkle')}<span>${{ summary: 'Summarize', translate: 'Translate', extract: 'Transcribe pages' }[st.mode]}</span></button>${st.running ? `<button class="btn" id="ai-stop">${ic('x')}<span>Stop</span></button>` : ''}<span class="note grow" id="ai-status">${esc(st.status)}</span></div>
        <div class="textout ${st.running && !st.out ? 'thinking' : ''}" id="ai-out" aria-live="polite">${esc(st.out || (st.running ? 'Thinking…' : ''))}</div>
        ${st.out && !st.running ? `<div class="row" style="flex-wrap:wrap">
          <button class="btn btn-sm" id="ai-copy">${ic('copy')}<span>Copy</span></button>
          <button class="btn btn-sm" id="ai-txt">${ic('download')}<span>Save .txt</span></button>
          <button class="btn btn-sm" id="ai-docx">${ic('word')}<span>Save Word</span></button>
          ${st.mode === 'extract' ? `<button class="btn btn-sm" id="ai-keep">${ic('check')}<span>Use as page text</span></button>` : ''}
        </div>` : ''}`}
      ${st.mode === 'ask' && st.running ? `<div class="row"><button class="btn btn-sm" id="ai-stop">${ic('x')}<span>Stop</span></button><span class="note">${esc(st.status)}</span></div>` : ''}`;
    body.querySelectorAll('.ai-tabs button').forEach((b) => b.onclick = () => { if (st.running) return; st.mode = b.dataset.m; st.out = ''; st.status = ''; draw(); });
    const on = (id, fn) => { const el = body.querySelector(id); if (el) el.onclick = fn; };
    const lang = body.querySelector('#ai-lang'); if (lang) lang.onchange = () => { st.lang = lang.value; };
    on('#ai-run', () => run());
    on('#ai-stop', () => st.running && st.running.abort());
    on('#ai-copy', () => copyText(st.out));
    on('#ai-txt', () => deliverFile(`${safeName(doc.title)} - ${st.mode}.txt`, new Blob([st.out], { type: 'text/plain' })));
    on('#ai-docx', () => deliverFile(`${safeName(doc.title)} - ${st.mode}.docx`, docxBuild([{ text: st.out }], `${doc.title} · ${AI_MODES.find((m) => m.id === st.mode).label}`)));
    on('#ai-keep', async () => { await keepTranscript(doc, pages, st.out); toast('Saved as page text', { type: 'ok' }); refreshView(); });
    const q = body.querySelector('#ai-q');
    if (q) { q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(q.value); } }); on('#ai-send', () => ask(q.value)); }
    const chat = body.querySelector('#ai-chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  }
  async function source(needImages) {
    const have = pages.filter((p) => p.ocr && p.ocr.text);
    if (!needImages && have.length === pages.length) return { text: pages.map((p) => `--- Page ${doc.pages.indexOf(p) + 1} ---\n${p.ocr.text}`).join('\n\n'), images: [] };
    const max = Assist.maxImages;
    if (max && pages.length <= max) {
      st.status = 'Preparing page images…'; draw();
      const images = [];
      for (const p of pages) images.push(await canvasToBlob(await renderPage(p, { maxDim: 1600, marks: false }), 'image/jpeg', 0.85));
      return { text: needImages ? '' : have.map((p) => `--- Page ${doc.pages.indexOf(p) + 1} ---\n${p.ocr.text}`).join('\n\n'), images };
    }
    if (needImages) throw new Error(max ? `Claude can look at up to ${max} pages at a time. Select fewer pages and try again.` : 'Page images can’t be sent here. Use Text on the document instead.');
    busy.show('Reading text first…');
    try { await runOcr(doc, pages.filter((p) => !p.ocr || !p.ocr.text)); } finally { busy.hide(); }
    return { text: pages.map((p) => `--- Page ${doc.pages.indexOf(p) + 1} ---\n${(p.ocr && p.ocr.text) || ''}`).join('\n\n'), images: [] };
  }
  function docBlock(src) {
    const nums = pages.map((p) => doc.pages.indexOf(p) + 1).join(', ');
    let t = `Document title: “${doc.title}”. Pages included: ${nums}.\n`;
    if (src.images.length) t += `The ${src.images.length} attached image(s) are the scanned pages, in order (pages ${nums}).\n`;
    if (src.text) t += `\nText recognised from the pages (it may contain OCR mistakes):\n<document>\n${src.text.slice(0, 120000)}\n</document>\n`;
    return t;
  }
  async function stream(input, opts, prefix = '', status = '') {
    const join = (t) => (prefix ? prefix + '\n\n' : '') + t;
    const ctl = new AbortController(); st.running = ctl; st.out = prefix; st.status = status; draw();
    try {
      const r = await Assist.sample(input, { ...opts, signal: ctl.signal, onText: ({ text }) => { st.out = join(text); const o = body.querySelector('#ai-out'); if (o) { o.textContent = st.out; o.classList.remove('thinking'); } } });
      st.out = join(r.text); st.status = r.truncated ? 'The answer was cut short. Try fewer pages.' : '';
      return r.text;
    } catch (e) {
      st.out = e && e.text ? join(e.text) : st.out; st.status = Assist.errText(e);
      return null;
    } finally { st.running = null; draw(); }
  }
  async function run() {
    const mode = st.mode;
    if (mode === 'extract') {
      const max = Assist.maxImages;
      if (!max) { st.status = 'Page images can’t be sent here. Use Text on the document instead.'; draw(); return; }
      let all = '';
      for (let i = 0; i < pages.length; i += max) {
        const ch = pages.slice(i, i + max), nums = ch.map((p) => doc.pages.indexOf(p) + 1);
        const status = pages.length > max ? `Reading pages ${nums[0]}–${nums[nums.length - 1]} of ${doc.pages.length}…` : '';
        st.running = { abort() {} }; st.status = 'Preparing page images…'; draw();
        const images = [];
        for (const p of ch) images.push(await canvasToBlob(await renderPage(p, { maxDim: 1600, marks: false }), 'image/jpeg', 0.85));
        const prompt = `Document title: “${doc.title}”. The ${images.length} attached image(s) are scanned pages ${nums.join(', ')}, in order.\nTranscribe every piece of text in the page images exactly as written, in the original language and script, including handwriting. Keep the reading order and line breaks. Write tables as rows with " | " between cells. Write [illegible] for anything you cannot read. Before each page write a line “--- Page N ---” using those page numbers. Output only the transcription.`;
        const t = await stream(prompt, { images }, all, status);
        if (t == null) return;
        all = st.out;
      }
      return;
    }
    let src;
    try { src = await source(mode === 'extract'); } catch (e) { st.status = e.message; draw(); return; }
    st.status = '';
    const block = docBlock(src);
    const prompts = {
      summary: `${block}\nSummarize this scanned document for the person who scanned it. Start with one sentence saying what the document is. Then give up to 7 short bullet points, each starting with “• ”, covering the facts that matter: names, dates, amounts, reference numbers, deadlines and anything the reader must do. Write in ${st.lang}. Plain text only, no headings or Markdown.`,
      translate: `${block}\nTranslate the whole document into ${st.lang}. Keep its structure: headings, lists, line breaks, and tables written as rows with " | " between cells. Keep names, numbers, amounts and dates exactly as they are. Output only the translation, starting each page with its “--- Page N ---” line.`,
      extract: `${block}\nTranscribe every piece of text in the attached page images exactly as written, in the original language and script, including handwriting. Keep the reading order and line breaks. Write tables as rows with " | " between cells. Write [illegible] for anything you cannot read. Before each page write a line “--- Page N ---” using the page numbers listed above. Output only the transcription.`,
    };
    await stream(prompts[mode], src.images.length ? { images: src.images } : {});
  }
  let docCtx = null;
  async function ask(q) {
    q = String(q || '').trim(); if (!q || st.running) return;
    if (!docCtx) {
      let src; try { src = await source(false); } catch (e) { st.status = e.message; draw(); return; }
      docCtx = src;
    }
    st.chat.push({ role: 'user', content: q });
    const rules = `${docBlock(docCtx)}\nAnswer questions about this scanned document. Base answers only on the document; if it doesn't say, say so. Quote exact figures and dates. Keep answers short and in the language of the question.`;
    const turns = [{ role: 'user', content: rules }, { role: 'assistant', content: 'Understood. What would you like to know about the document?' }, ...st.chat.slice(-12)];
    const ctl = new AbortController(); st.running = ctl; st.status = 'Thinking…'; draw();
    const live = { role: 'assistant', content: '…' }; st.chat.push(live); draw();
    try {
      const r = await Assist.sample(turns, { cache: false, signal: ctl.signal, images: docCtx.images.length ? docCtx.images : undefined, onText: ({ text }) => { live.content = text; const c = body.querySelector('#ai-chat'); if (c) { c.lastElementChild.innerHTML = `<b>Claude:</b> ${esc(text)}`; c.scrollTop = c.scrollHeight; } } });
      live.content = r.text; st.status = '';
    } catch (e) {
      live.content = (e && e.text) || ''; st.status = Assist.errText(e);
      if (!live.content) st.chat.pop();
    } finally { st.running = null; draw(); const qi = body.querySelector('#ai-q'); if (qi) qi.focus(); }
  }
  draw();
}
async function keepTranscript(doc, pages, text) {
  const parts = String(text).split(/^-{2,}\s*Page\s+(\d+)\s*-{2,}\s*$/mi);
  const byNum = {};
  if (parts.length > 1) for (let i = 1; i < parts.length; i += 2) byNum[+parts[i]] = parts[i + 1].trim();
  for (const p of pages) {
    const n = doc.pages.indexOf(p) + 1;
    const t = parts.length > 1 ? byNum[n] : (pages.length === 1 ? text.trim() : null);
    if (t != null) p.ocr = { text: t, words: [], lang: 'ai', src: 'ai', at: Date.now() };
  }
  await saveDoc(doc);
}
