// ---------------------------------------------------------------------------
// File writers: PDF (with AES-256 password protection and an invisible OCR
// text layer), ZIP (stored) and DOCX. No third-party code.
// ---------------------------------------------------------------------------

const TE = new TextEncoder();

function u8concat(...parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const pdfNum = (v) => { const s = (Math.round(v * 100) / 100).toFixed(2); return s.replace(/\.?0+$/, '') || '0'; };

// UTF-16BE with BOM, for PDF text strings (titles etc).
function pdfTextBytes(str) {
  const out = [0xfe, 0xff];
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out.push(c >> 8, c & 255); }
  return new Uint8Array(out);
}

// Map a JS string to WinAnsi codes; returns null if any character can't be encoded.
const WINANSI_EXTRA = { 0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02c6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155, 0x0153: 156, 0x017e: 158, 0x0178: 159 };
function winAnsi(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out.push(c);
    else if (WINANSI_EXTRA[c]) out.push(WINANSI_EXTRA[c]);
    else return null;
  }
  return out;
}
const HELV_W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
function helvWidth(codes) { let w = 0; for (const c of codes) w += (c >= 32 && c <= 126) ? HELV_W[c - 32] : 556; return w; }
function pdfLiteral(codes) {
  let s = '(';
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

// Standard security handler, revision 6 (AES-256), ISO 32000-2 algorithm 2.B.
async function pdfMakeCrypt(userPassword, ownerPassword) {
  const S = crypto.subtle;
  const prep = (pw) => TE.encode(String(pw || '').normalize('NFKC')).slice(0, 127);
  const upw = prep(userPassword);
  const opw = ownerPassword ? prep(ownerPassword) : rnd(24);
  const fileKey = rnd(32);
  const sha = async (alg, data) => new Uint8Array(await S.digest(alg, data));
  const aesCbc = async (keyBytes, iv, data) => {
    const k = await S.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
    return new Uint8Array(await S.encrypt({ name: 'AES-CBC', iv }, k, data));
  };
  const hash2B = async (pw, salt, udata) => {
    let k = await sha('SHA-256', u8concat(pw, salt, udata));
    let i = 0, e = null;
    while (i < 64 || e[e.length - 1] > i - 32) {
      const comb = u8concat(pw, k, udata);
      const k1 = new Uint8Array(comb.length * 64);
      for (let j = 0; j < 64; j++) k1.set(comb, j * comb.length);
      e = (await aesCbc(k.slice(0, 16), k.slice(16, 32), k1)).slice(0, k1.length);
      let s = 0; for (let j = 0; j < 16; j++) s += e[j];
      const m = s % 3;
      k = await sha(m === 0 ? 'SHA-256' : m === 1 ? 'SHA-384' : 'SHA-512', e);
      i++;
    }
    return k.slice(0, 32);
  };
  const empty = new Uint8Array(0), zero = new Uint8Array(16);
  const uvs = rnd(8), uks = rnd(8), ovs = rnd(8), oks = rnd(8);
  const U = u8concat(await hash2B(upw, uvs, empty), uvs, uks);
  const UE = (await aesCbc(await hash2B(upw, uks, empty), zero, fileKey)).slice(0, 32);
  const O = u8concat(await hash2B(opw, ovs, U), ovs, oks);
  const OE = (await aesCbc(await hash2B(opw, oks, U), zero, fileKey)).slice(0, 32);
  const P = -4, pv = P >>> 0;
  const perms = new Uint8Array(16);
  perms[0] = pv & 255; perms[1] = (pv >>> 8) & 255; perms[2] = (pv >>> 16) & 255; perms[3] = (pv >>> 24) & 255;
  perms[4] = perms[5] = perms[6] = perms[7] = 0xff;
  perms[8] = 0x54; perms[9] = 0x61; perms[10] = 0x64; perms[11] = 0x62; perms.set(rnd(4), 12);
  const Perms = (await aesCbc(fileKey, zero, perms)).slice(0, 16);
  const fk = await S.importKey('raw', fileKey, { name: 'AES-CBC' }, false, ['encrypt']);
  return {
    dict: `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /P ${P} /Perms <${hex(Perms)}> /EncryptMetadata true >>`,
    async encrypt(data) {
      const iv = rnd(16);
      return u8concat(iv, new Uint8Array(await S.encrypt({ name: 'AES-CBC', iv }, fk, data)));
    },
  };
}

/**
 * pages: [{ w, h (points), image: {kind:'jpeg'|'bw1', data:Uint8Array, pxW, pxH},
 *           box: {x, y, w, h} (points, origin bottom-left), words: [{s, x, y, w, h}] (points) }]
 * opts: { title, password, ownerPassword }
 */
async function pdfBuild(pages, opts = {}) {
  const crypt = opts.password ? await pdfMakeCrypt(opts.password, opts.ownerPassword) : null;
  const chunks = []; let pos = 0; const offsets = [];
  const push = (u8) => { chunks.push(u8); pos += u8.length; };
  const str = (s) => push(TE.encode(s));
  const encS = async (u8) => (crypt ? crypt.encrypt(u8) : u8);
  const textStr = async (s) => '<' + hex(await encS(pdfTextBytes(s))) + '>';

  let next = 1; const alloc = () => next++;
  const catalogId = alloc(), pagesId = alloc(), infoId = alloc();
  const anyWords = pages.some((p) => p.words && p.words.length);
  const fontId = anyWords ? alloc() : 0;
  const encId = crypt ? alloc() : 0;
  const pageRefs = pages.map(() => ({ page: alloc(), content: alloc(), image: alloc() }));

  const obj = async (id, dict, stream) => {
    offsets[id] = pos;
    if (stream) {
      const data = await encS(stream);
      str(`${id} 0 obj\n${dict.replace('%LEN%', String(data.length))}\nstream\n`);
      push(data);
      str('\nendstream\nendobj\n');
    } else {
      str(`${id} 0 obj\n${dict}\nendobj\n`);
    }
  };

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const ext = crypt ? ' /Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >>' : '';
  await obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R${ext} >>`);
  await obj(pagesId, `<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs.map((r) => r.page + ' 0 R').join(' ')}] >>`);
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const date = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  await obj(infoId, `<< /Title ${await textStr(opts.title || 'Scan')} /Producer ${await textStr('Flatbed Scanner')} /Creator ${await textStr('Flatbed Scanner')} /CreationDate ${await textStr(date)} >>`);
  if (fontId) await obj(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i], r = pageRefs[i], im = pg.image, b = pg.box;
    let cs = `q\n${pdfNum(b.w)} 0 0 ${pdfNum(b.h)} ${pdfNum(b.x)} ${pdfNum(b.y)} cm\n/Im0 Do\nQ\n`;
    if (pg.words && pg.words.length) {
      cs += 'BT\n3 Tr\n';
      for (const wd of pg.words) {
        const codes = winAnsi(wd.s);
        if (!codes || !codes.length || wd.w <= 0 || wd.h <= 0) continue;
        const fs = Math.max(1, wd.h * 0.9);
        const natural = helvWidth(codes) * fs / 1000;
        const tz = natural > 0 ? Math.max(1, Math.min(1000, 100 * wd.w / natural)) : 100;
        cs += `/F1 ${pdfNum(fs)} Tf ${pdfNum(tz)} Tz 1 0 0 1 ${pdfNum(wd.x)} ${pdfNum(wd.y + wd.h * 0.22)} Tm ${pdfLiteral(codes)} Tj\n`;
      }
      cs += 'ET\n';
    }
    const res = `/XObject << /Im0 ${r.image} 0 R >>` + (fontId ? ` /Font << /F1 ${fontId} 0 R >>` : '');
    await obj(r.page, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pdfNum(pg.w)} ${pdfNum(pg.h)}] /Resources << ${res} >> /Contents ${r.content} 0 R >>`);
    await obj(r.content, '<< /Length %LEN% >>', TE.encode(cs));
    if (im.kind === 'bw1') {
      await obj(r.image, `<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode /Length %LEN% >>`, im.data);
    } else {
      await obj(r.image, `<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %LEN% >>`, im.data);
    }
  }
  if (crypt) { offsets[encId] = pos; str(`${encId} 0 obj\n${crypt.dict}\nendobj\n`); }

  const xref = pos, size = next;
  let x = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  const id = hex(rnd(16));
  x += `trailer\n<< /Size ${size} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<${id}> <${id}>]${crypt ? ` /Encrypt ${encId} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  str(x);
  return new Blob(chunks, { type: 'application/pdf' });
}

// zlib deflate via the platform (FlateDecode-compatible). Returns null if unsupported.
async function deflateBytes(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const out = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(out).arrayBuffer());
  } catch (e) { return null; }
}

// ---------------------------------- ZIP ----------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipBuild(files) {
  const parts = [], central = []; let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = TE.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
}

// ---------------------------------- DOCX ----------------------------------
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** sections: [{ heading?, text?, image?: {data:Uint8Array, pxW, pxH} }] */
function docxBuild(sections, title) {
  const rels = [], media = [];
  let body = '';
  if (title) body += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r></w:p>`;
  sections.forEach((s, i) => {
    if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (s.heading) body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(s.heading)}</w:t></w:r></w:p>`;
    if (s.image) {
      const n = media.length + 1, rid = 'rIdImg' + n;
      media.push({ name: `word/media/image${n}.jpg`, data: s.image.data });
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.jpg"/>`);
      const maxW = 5731510, maxH = 8229600; // 6.27in x 9in in EMU
      let cx = maxW, cy = Math.round(maxW * s.image.pxH / s.image.pxW);
      if (cy > maxH) { cy = maxH; cx = Math.round(maxH * s.image.pxW / s.image.pxH); }
      body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Page ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    if (s.text) {
      for (const line of String(s.text).replace(/\r/g, '').split('\n')) {
        body += line.trim() ? `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r></w:p>` : '<w:p/>';
      }
    }
  });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`;
  return zipBuild([
    { name: '[Content_Types].xml', data: TE.encode(ct) },
    { name: '_rels/.rels', data: TE.encode(rootRels) },
    { name: 'word/document.xml', data: TE.encode(doc) },
    { name: 'word/styles.xml', data: TE.encode(styles) },
    { name: 'word/_rels/document.xml.rels', data: TE.encode(docRels) },
    ...media,
  ]);
}
