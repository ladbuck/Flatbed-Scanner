// ---------------------------------------------------------------------------
// Image processing. Every ip* function is pure and self-contained so the same
// source can run inside a Web Worker (built from Function.toString) or on the
// main thread as a fallback. Images are {data: Uint8ClampedArray, width, height}.
// ---------------------------------------------------------------------------

function ipNew(w, h) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function ipGray(img) {
  var d = img.data, n = img.width * img.height, g = new Float32Array(n);
  for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return g;
}

// Separable box blur on a Float32Array (edge-clamped). Returns a new array.
function ipBoxBlur(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  var tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1, x, y, acc, o;
  for (y = 0; y < h; y++) {
    o = y * w; acc = 0;
    for (x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (x = 0; x < w; x++) {
      tmp[o + x] = acc / d;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (x = 0; x < w; x++) {
    acc = 0;
    for (y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Downscale with area averaging so detection works on a small, clean image.
function ipResize(img, maxDim) {
  var w = img.width, h = img.height, s = Math.min(1, maxDim / Math.max(w, h));
  if (s >= 1) return img;
  var nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
  var out = ipNew(nw, nh), d = img.data, od = out.data, fx = w / nw, fy = h / nh;
  for (var y = 0; y < nh; y++) {
    var y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (var x = 0; x < nw; x++) {
      var x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      var r = 0, g = 0, b = 0, c = 0;
      for (var yy = y0; yy < y1; yy++) {
        var row = yy * w;
        for (var xx = x0; xx < x1; xx++) {
          var k = (row + xx) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; c++;
        }
      }
      var o = (y * nw + x) * 4;
      od[o] = r / c; od[o + 1] = g / c; od[o + 2] = b / c; od[o + 3] = 255;
    }
  }
  return out;
}

function ipOtsu(vals, n) {
  var hist = new Float64Array(256), i, t;
  for (i = 0; i < n; i++) hist[Math.max(0, Math.min(255, vals[i] | 0))]++;
  var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
  var sumB = 0, wB = 0, best = -1, thr = 128;
  for (t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    var wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function ipConvexHull(pts) {
  pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  var lower = [], upper = [], i;
  for (i = 0; i < pts.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
    lower.push(pts[i]);
  }
  for (i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function ipPolyArea(p) {
  var a = 0;
  for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return Math.abs(a) / 2;
}

// Largest-area quadrilateral whose corners are hull vertices.
function ipMaxQuad(hull) {
  var n = hull.length;
  if (n < 4) return null;
  if (n > 90) {
    var step = n / 90, sub = [];
    for (var s = 0; s < 90; s++) sub.push(hull[Math.floor(s * step)]);
    hull = sub; n = hull.length;
  }
  function tri(a, b, c) { return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; }
  var best = -1, bq = null;
  for (var i = 0; i < n; i++) {
    for (var k = i + 2; k < n; k++) {
      var bj = -1, bja = -1, bl = -1, bla = -1;
      for (var j = i + 1; j < k; j++) { var a1 = tri(hull[i], hull[j], hull[k]); if (a1 > bja) { bja = a1; bj = j; } }
      for (var l = k + 1; l < n + i; l++) { var a2 = tri(hull[i], hull[k], hull[l % n]); if (a2 > bla) { bla = a2; bl = l % n; } }
      if (bj < 0 || bl < 0) continue;
      if (bja + bla > best) { best = bja + bla; bq = [hull[i], hull[bj], hull[k], hull[bl]]; }
    }
  }
  return bq;
}

// Order 4 points as TL, TR, BR, BL (screen coordinates, y down).
function ipOrderQuad(q) {
  var cx = 0, cy = 0, i;
  for (i = 0; i < 4; i++) { cx += q[i][0] / 4; cy += q[i][1] / 4; }
  var s = q.slice().sort(function (a, b) { return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx); });
  var start = 0, bestv = Infinity;
  for (i = 0; i < 4; i++) { var v = s[i][0] + s[i][1]; if (v < bestv) { bestv = v; start = i; } }
  return [s[start], s[(start + 1) % 4], s[(start + 2) % 4], s[(start + 3) % 4]];
}

// Best quadrilateral from a binary mask, or null. Returns {score, quad} in mask pixels.
function ipQuadFromMask(mask, w, h, weight) {
  var n = w * h, i;
  // Morphological opening (erode then dilate) breaks thin bridges to the background.
  var r2 = Math.max(1, Math.round(Math.max(w, h) / 120));
  var er = ipBoxBlur(mask, w, h, r2), m2 = new Float32Array(n);
  for (i = 0; i < n; i++) m2[i] = er[i] > 0.98 ? 1 : 0;
  var di = ipBoxBlur(m2, w, h, r2), m3 = new Uint8Array(n);
  for (i = 0; i < n; i++) m3[i] = di[i] > 0.02 ? 1 : 0;
  var lab = new Int32Array(n), cur = 0, stack = new Int32Array(n), comps = [];
  for (i = 0; i < n; i++) {
    if (!m3[i] || lab[i]) continue;
    cur++; var sp = 0, area = 0, sx = 0, sy = 0; stack[sp++] = i; lab[i] = cur;
    while (sp) {
      var p = stack[--sp], px = p % w, py = (p - px) / w; area++; sx += px; sy += py;
      if (px > 0 && m3[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1; }
      if (px < w - 1 && m3[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1; }
      if (py > 0 && m3[p - w] && !lab[p - w]) { lab[p - w] = cur; stack[sp++] = p - w; }
      if (py < h - 1 && m3[p + w] && !lab[p + w]) { lab[p + w] = cur; stack[sp++] = p + w; }
    }
    comps.push({ id: cur, area: area, cx: sx / area / w, cy: sy / area / h });
  }
  comps.sort(function (a, b) {
    var da = Math.hypot(a.cx - 0.5, a.cy - 0.5), db = Math.hypot(b.cx - 0.5, b.cy - 0.5);
    return b.area * (1 - 0.6 * db) - a.area * (1 - 0.6 * da);
  });
  for (var c = 0; c < Math.min(3, comps.length); c++) {
    var comp = comps[c], ratio = comp.area / n;
    if (ratio < 0.06 || ratio > 0.985) continue;
    var pts = [];
    for (var y = 0; y < h; y++) {
      var lx = -1, rx = -1, row = y * w;
      for (var x = 0; x < w; x++) if (lab[row + x] === comp.id) { if (lx < 0) lx = x; rx = x; }
      if (lx >= 0) { pts.push([lx, y]); if (rx !== lx) pts.push([rx + 1, y]); }
    }
    if (pts.length < 8) continue;
    var hull = ipConvexHull(pts), quad = ipMaxQuad(hull);
    if (!quad) continue;
    var qa = ipPolyArea(quad), ha = ipPolyArea(hull);
    var fit = qa / Math.max(1, ha), cover = qa / n;
    if (fit < 0.88 || cover < 0.06 || cover > 0.985) continue;
    // Reject shapes whose corners hug the frame: that is the whole photo.
    var hug = 0;
    for (var q = 0; q < 4; q++) if ((quad[q][0] <= 2 || quad[q][0] >= w - 3) && (quad[q][1] <= 2 || quad[q][1] >= h - 3)) hug++;
    if (hug >= 3) continue;
    return { score: fit * fit * Math.sqrt(cover) * weight, quad: quad };
  }
  return null;
}

// ----------------------------- Page detection ------------------------------
// Candidates come from straight edges (a Hough transform guided by gradient
// direction) and from bright / background-difference masks. Every candidate is
// scored by colour contrast across its four sides, so the page outline wins
// over text rows, table rules and shadows.

function ipPlanes(img) {
  var w = img.width, h = img.height, n = w * h, d = img.data, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (var i = 0; i < n; i++) { r[i] = d[i * 4]; g[i] = d[i * 4 + 1]; b[i] = d[i * 4 + 2]; }
  return { r: ipBoxBlur(r, w, h, 1), g: ipBoxBlur(g, w, h, 1), b: ipBoxBlur(b, w, h, 1), w: w, h: h };
}

// Mean contrast across a side a->b (quad is clockwise, so the inside is on the right).
function ipSideScore(P, ax, ay, bx, by, off) {
  var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < 2) return 0;
  var nx = -dy / L, ny = dx / L, N = 28, s = 0, cnt = 0, w = P.w, h = P.h, vert = Math.abs(dy) > Math.abs(dx) * 1.5;
  for (var k = 0; k < N; k++) {
    var t = 0.05 + 0.9 * (k + 0.5) / N, px = ax + dx * t, py = ay + dy * t;
    // Compare wide bands on each side: thin rules and rows of text average out,
    // while a real page edge separates paper from background.
    var ox = px - nx * off * 0.85, oy = py - ny * off * 0.85;
    if (ox < 0 || oy < 0 || ox > w - 1 || oy > h - 1) { s += P.border || 0.55; cnt++; continue; }
    var ir = 0, ig = 0, ib = 0, orr = 0, og = 0, ob = 0, ni = 0, no = 0;
    for (var m = 1, mEnd = P.narrow ? 2 : 5; m <= mEnd; m++) {
      var f = off * 0.85 * m;
      var ax2 = Math.round(px + nx * f), ay2 = Math.round(py + ny * f), cx3 = Math.round(px - nx * f), cy3 = Math.round(py - ny * f);
      if (ax2 >= 0 && ay2 >= 0 && ax2 < w && ay2 < h) { var a = ay2 * w + ax2; ir += P.r[a]; ig += P.g[a]; ib += P.b[a]; ni++; }
      if (cx3 >= 0 && cy3 >= 0 && cx3 < w && cy3 < h) { var c = cy3 * w + cx3; orr += P.r[c]; og += P.g[c]; ob += P.b[c]; no++; }
    }
    if (ni < (P.narrow ? 1 : 2) || no < 1) continue;
    var dr = ir / ni - orr / no, dg = ig / ni - og / no, db = ib / ni - ob / no;
    var con = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / (P.cap || 70));
    var sv = con;
    // A book's gutter is a wide, soft dark crease rather than a step. Credit it on
    // near-vertical sides only, where text rows can't imitate it.
    if (vert && sv < 0.8) {
      var I0 = 0, I4 = 0, I10 = 0, okv = true;
      for (var v = -1; v <= 1 && okv; v++) {
        var c0x = Math.round(px + nx * v), c0y = Math.round(py + ny * v);
        if (c0x < 0 || c0y < 0 || c0x > w - 1 || c0y > h - 1) { okv = false; break; }
        var c0 = c0y * w + c0x; I0 += (P.r[c0] + P.g[c0] + P.b[c0]) / 9;
      }
      for (var sgn = -1; sgn <= 1 && okv; sgn += 2) {
        var a4x = Math.round(px + nx * 4 * sgn), a4y = Math.round(py + ny * 4 * sgn), a10x = Math.round(px + nx * 11 * sgn), a10y = Math.round(py + ny * 11 * sgn);
        if (a10x < 0 || a10y < 0 || a10x > w - 1 || a10y > h - 1) { okv = false; break; }
        var i4 = a4y * w + a4x, i10 = a10y * w + a10x;
        I4 += (P.r[i4] + P.g[i4] + P.b[i4]) / 6; I10 += (P.r[i10] + P.g[i10] + P.b[i10]) / 6;
      }
      if (okv) {
        var depth = I10 - I0;
        if (depth > 16 && (I10 - I4) > 0.3 * depth) sv = Math.max(sv, 0.95 * Math.min(1, depth / 40));
      }
    }
    s += sv; cnt++;
  }
  return cnt > N / 3 ? s / cnt : 0;
}

// Quad = [[x,y] x4] clockwise from top-left. Returns null if implausible for a page.
function ipQuadGeom(q, w, h) {
  var i, mw = w * 0.04, mh = h * 0.04, minSide = Math.min(w, h) * 0.2;
  for (i = 0; i < 4; i++) if (!(q[i][0] >= -mw && q[i][0] <= w - 1 + mw && q[i][1] >= -mh && q[i][1] <= h - 1 + mh)) return null;
  var area = 0;
  for (i = 0; i < 4; i++) {
    var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    area += a[0] * b[1] - b[0] * a[1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minSide) return null;
    var ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
    var cr = ux * vy - uy * vx;
    if (cr > 0) return null; // not convex / not clockwise
    var ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))) * 180 / Math.PI;
    if (ang < 42 || ang > 138) return null;
  }
  area /= 2;
  if (area < 0.12 * w * h) return null;
  // Opposite sides of a photographed page converge only a little.
  for (i = 0; i < 2; i++) {
    var p0 = q[i], p1 = q[i + 1], p2 = q[(i + 3) % 4], p3 = q[(i + 2) % 4];
    var a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), a2 = Math.atan2(p3[1] - p2[1], p3[0] - p2[0]);
    var dA = Math.abs(a1 - a2) * 180 / Math.PI; if (dA > 180) dA = 360 - dA;
    if (dA > 28) return null;
  }
  return area;
}
function ipQuadScore(P, q) {
  var area = ipQuadGeom(q, P.w, P.h);
  if (area == null) return -1;
  var g = 1, border = 0;
  for (var i = 0; i < 4; i++) {
    var a = q[i], b = q[(i + 1) % 4], s = ipSideScore(P, a[0], a[1], b[0], b[1], 3.5);
    if (Math.abs(s - (P.border || 0.55)) < 1e-9) border++;
    g *= Math.max(0.02, s);
  }
  if (border === 4) return 0.3;
  var af = P.areaW == null ? 0.3 : P.areaW;
  return Math.pow(g, 0.25) * (1 - af + af * Math.min(1, area / (0.6 * P.w * P.h)));
}

function ipLineX(L, y) { return Math.abs(L.c) < 1e-6 ? NaN : (L.r - y * L.s) / L.c; }
function ipLineY(L, x) { return Math.abs(L.s) < 1e-6 ? NaN : (L.r - x * L.c) / L.s; }
function ipMeet(A, B) {
  var det = A.c * B.s - A.s * B.c;
  if (Math.abs(det) < 1e-6) return null;
  return [(A.r * B.s - B.r * A.s) / det, (B.r * A.c - A.r * B.c) / det];
}
// Part of a line inside the image, as two points.
function ipClipLine(L, w, h) {
  var pts = [], x, y;
  if (Math.abs(L.s) > 1e-6) { y = ipLineY(L, 0); if (y >= 0 && y <= h - 1) pts.push([0, y]); y = ipLineY(L, w - 1); if (y >= 0 && y <= h - 1) pts.push([w - 1, y]); }
  if (Math.abs(L.c) > 1e-6) { x = ipLineX(L, 0); if (x >= 0 && x <= w - 1) pts.push([x, 0]); x = ipLineX(L, h - 1); if (x >= 0 && x <= w - 1) pts.push([x, h - 1]); }
  if (pts.length < 2) return null;
  var a = pts[0], b = pts[1], best = 0;
  for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
    var d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > best) { best = d; a = pts[i]; b = pts[j]; }
  }
  return best > 4 ? [a, b] : null;
}
function ipMkLine(tDeg, r) { var t = tDeg * Math.PI / 180; return { t: tDeg, c: Math.cos(t), s: Math.sin(t), r: r }; }

function ipHoughLines(P) {
  var w = P.w, h = P.h, n = w * h, x, y, i;
  var gxA = new Float32Array(n), gyA = new Float32Array(n), mag = new Float32Array(n), planes = [P.r, P.g, P.b], maxM = 0;
  for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
    i = y * w + x; var best = -1, bgx = 0, bgy = 0;
    for (var c = 0; c < 3; c++) {
      var p = planes[c];
      var gx = (p[i - w + 1] + 2 * p[i + 1] + p[i + w + 1]) - (p[i - w - 1] + 2 * p[i - 1] + p[i + w - 1]);
      var gy = (p[i + w - 1] + 2 * p[i + w] + p[i + w + 1]) - (p[i - w - 1] + 2 * p[i - w] + p[i - w + 1]);
      var m = gx * gx + gy * gy;
      if (m > best) { best = m; bgx = gx; bgy = gy; }
    }
    gxA[i] = bgx; gyA[i] = bgy; mag[i] = Math.sqrt(best); if (mag[i] > maxM) maxM = mag[i];
  }
  P.gx = gxA; P.gy = gyA;
  var hist = new Int32Array(256), sc = 255 / Math.max(1, maxM);
  for (i = 0; i < n; i++) hist[Math.min(255, (mag[i] * sc) | 0)]++;
  var acc0 = 0, cut = 255;
  for (var k = 255; k >= 0; k--) { acc0 += hist[k]; if (acc0 > n * 0.22) { cut = k; break; } }
  var thr = Math.max(14, cut / sc);
  var diag = Math.ceil(Math.hypot(w, h)), nR = 2 * diag + 1, NT = 180, acc = new Float32Array(NT * nR);
  var cs = new Float32Array(NT), sn = new Float32Array(NT);
  for (var t = 0; t < NT; t++) { cs[t] = Math.cos(t * Math.PI / 180); sn[t] = Math.sin(t * Math.PI / 180); }
  for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
    i = y * w + x; if (mag[i] < thr) continue;
    var phi = Math.atan2(gyA[i], gxA[i]) * 180 / Math.PI, t0 = Math.round(((phi % 180) + 180) % 180);
    for (var dt = -4; dt <= 4; dt++) {
      var tt = (t0 + dt + 360) % 180, rr = Math.round(x * cs[tt] + y * sn[tt]) + diag;
      acc[tt * nR + rr] += 1;
    }
  }
  var minV = 0.14 * Math.min(w, h), peaks = [];
  for (t = 0; t < NT; t++) for (var r = 3; r < nR - 3; r++) {
    var v = acc[t * nR + r]; if (v < minV) continue;
    var isMax = true;
    for (var a2 = -2; a2 <= 2 && isMax; a2++) for (var b2 = -3; b2 <= 3; b2++) {
      if (!a2 && !b2) continue;
      var t2 = (t + a2 + NT) % NT;
      if (acc[t2 * nR + r + b2] > v) { isMax = false; break; }
    }
    if (isMax) peaks.push({ t: t, r: r - diag, v: v });
  }
  peaks.sort(function (p1, p2) { return p2.v - p1.v; });
  var kept = [];
  for (i = 0; i < peaks.length && kept.length < 28; i++) {
    var pk = peaks[i], dup = false;
    for (var j = 0; j < kept.length && !dup; j++) {
      var q = kept[j], d1 = Math.abs(q.t - pk.t), rr2 = pk.r;
      if (d1 > 90) { d1 = 180 - d1; rr2 = -pk.r; }
      if (d1 < 7 && Math.abs(q.r - rr2) < 12) dup = true;
    }
    if (!dup) kept.push(pk);
  }
  return kept.map(function (pk) { return ipMkLine(pk.t, pk.r); });
}

// Near-vertical soft dark creases (a book's gutter), found with a small Hough
// transform over a "valley" map instead of gradients.
function ipGutterLines(P) {
  var w = P.w, h = P.h, x, y, i, R = 9, vm = new Float32Array(w * h), lum = new Float32Array(w * h);
  for (i = 0; i < w * h; i++) lum[i] = (P.r[i] + P.g[i] + P.b[i]) / 3;
  for (y = 0; y < h; y++) for (x = R; x < w - R; x++) {
    i = y * w + x;
    var l = lum[i - R], r = lum[i + R], c = lum[i], l4 = lum[i - 4], r4v = lum[i + 4];
    var depth = Math.min(l, r) - c;
    if (depth > 14 && Math.min(l, r) - Math.min(l4, r4v) > 0.3 * depth) vm[i] = depth;
  }
  var diag = Math.ceil(Math.hypot(w, h)), nR = 2 * diag + 1, T0 = -20, NT = 41, acc = new Float32Array(NT * nR);
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    if (!vm[y * w + x]) continue;
    for (var k = 0; k < NT; k++) {
      var t = (T0 + k) * Math.PI / 180, rr = Math.round(x * Math.cos(t) + y * Math.sin(t)) + diag;
      acc[k * nR + rr] += 1;
    }
  }
  var found = [];
  for (var n2 = 0; n2 < 3; n2++) {
    var best = 0, bk = -1, br = -1;
    for (i = 0; i < acc.length; i++) if (acc[i] > best) { best = acc[i]; bk = (i / nR) | 0; br = i % nR; }
    if (best < 0.3 * h) break;
    var tdeg = T0 + bk;
    found.push(ipMkLine((tdeg + 180) % 180, tdeg < 0 ? -(br - diag) : br - diag));
    for (var dk = -6; dk <= 6; dk++) for (var dr = -10; dr <= 10; dr++) {
      var kk = bk + dk, r2 = br + dr; if (kk >= 0 && kk < NT && r2 >= 0 && r2 < nR) acc[kk * nR + r2] = 0;
    }
  }
  return found;
}

// Nudge each side along its normal to sit exactly on the strongest contrast.
function ipRefineQuad(P, q) {
  var lines = [], i;
  P.narrow = true;
  for (i = 0; i < 4; i++) {
    var a = q[i], b = q[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    var nx = -dy / L, ny = dx / L, best = -1, ba = 0, bb = 0;
    // Coarse search over a wide range, then fine steps around the best fit.
    var tryAt = function (da, db) {
      var s = ipSideScore(P, a[0] + nx * da, a[1] + ny * da, b[0] + nx * db, b[1] + ny * db, 1.8) - 0.0015 * (Math.abs(da) + Math.abs(db));
      if (s > best) { best = s; ba = da; bb = db; }
    };
    var lim = Math.max(6, Math.round(L * 0.04));
    for (var da = -lim; da <= lim; da += 2) for (var db = -lim; db <= lim; db += 2) tryAt(da, db);
    var ca = ba, cb = bb;
    for (var fa = -2; fa <= 2; fa++) for (var fb = -2; fb <= 2; fb++) tryAt(ca + fa, cb + fb);
    lines.push([[a[0] + nx * ba, a[1] + ny * ba], [b[0] + nx * bb, b[1] + ny * bb]]);
  }
  P.narrow = false;
  var out = [];
  for (i = 0; i < 4; i++) {
    var L1 = lines[(i + 3) % 4], L2 = lines[i];
    var x1 = L1[0][0], y1 = L1[0][1], x2 = L1[1][0], y2 = L1[1][1], x3 = L2[0][0], y3 = L2[0][1], x4 = L2[1][0], y4 = L2[1][1];
    var den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-6) { P.narrow = false; return q; }
    var px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
    var py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
    out.push([px, py]);
  }
  return ipQuadScore(P, out) >= ipQuadScore(P, q) - 0.03 ? out : q;
}

// Find the document outline. Returns normalized [x0,y0,...,x3,y3] (TL,TR,BR,BL) or null.
function ipDetectQuad(src) {
  var img = ipResize(src, 400), w = img.width, h = img.height, n = w * h, d = img.data, i, j;
  var P = ipPlanes(img), cands = [];
  // 1) Straight edges, plus the frame edges for pages that run off the photo.
  var lines = ipHoughLines(P), H = [], V = [];
  // Rank lines by how much they look like a page edge across their visible length.
  for (i = 0; i < lines.length; i++) {
    var Li = lines[i], seg = ipClipLine(Li, w, h);
    Li.q = seg ? ipSideScore(P, seg[0][0], seg[0][1], seg[1][0], seg[1][1], 3.5) : 0;
    (Li.t >= 45 && Li.t < 135 ? H : V).push(Li);
  }
  // Keep the strongest lines by votes, plus the best-looking edges by contrast.
  var pick = function (arr) {
    var out = arr.slice(0, 8), rest = arr.slice(8).sort(function (l1, l2) { return l2.q - l1.q; });
    return out.concat(rest.slice(0, 4));
  };
  H = pick(H).concat([ipMkLine(90, 0), ipMkLine(90, h - 1)]);
  V = pick(V).concat(ipGutterLines(P), [ipMkLine(0, 0), ipMkLine(0, w - 1)]);
  for (var a = 0; a < H.length; a++) for (var b = a + 1; b < H.length; b++) {
    var ya = ipLineY(H[a], w / 2), yb = ipLineY(H[b], w / 2);
    if (!(Math.abs(ya - yb) > 0.25 * h)) continue;
    var top = ya < yb ? H[a] : H[b], bot = ya < yb ? H[b] : H[a];
    for (var c = 0; c < V.length; c++) for (var e = c + 1; e < V.length; e++) {
      var xc = ipLineX(V[c], h / 2), xe = ipLineX(V[e], h / 2);
      if (!(Math.abs(xc - xe) > 0.25 * w)) continue;
      var lft = xc < xe ? V[c] : V[e], rgt = xc < xe ? V[e] : V[c];
      var q = [ipMeet(top, lft), ipMeet(top, rgt), ipMeet(bot, rgt), ipMeet(bot, lft)];
      if (q[0] && q[1] && q[2] && q[3]) cands.push(q);
    }
  }
  // 2) Region masks: bright paper, colour different from the surroundings, dark paper.
  var f = new Float32Array(n);
  for (i = 0; i < n; i++) {
    j = i * 4; var r0 = d[j], g0 = d[j + 1], b0 = d[j + 2];
    f[i] = 0.299 * r0 + 0.587 * g0 + 0.114 * b0 - 0.6 * (Math.max(r0, g0, b0) - Math.min(r0, g0, b0));
  }
  var bl = ipBoxBlur(f, w, h, 2), thr = ipOtsu(bl, n), bright = new Float32Array(n), dark = new Float32Array(n);
  for (i = 0; i < n; i++) { bright[i] = bl[i] > thr ? 1 : 0; dark[i] = 1 - bright[i]; }
  var ring = Math.max(2, Math.round(Math.min(w, h) * 0.03)), rs = [], gs = [], bs = [];
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
    j = (y * w + x) * 4; rs.push(d[j]); gs.push(d[j + 1]); bs.push(d[j + 2]);
  }
  function med(arr) { arr.sort(function (p1, p2) { return p1 - p2; }); return arr[arr.length >> 1]; }
  var br = med(rs), bgc = med(gs), bb2 = med(bs), dist = new Float32Array(n);
  for (i = 0; i < n; i++) { j = i * 4; dist[i] = Math.min(255, Math.hypot(d[j] - br, d[j + 1] - bgc, d[j + 2] - bb2)); }
  var dbl = ipBoxBlur(dist, w, h, 2), dthr = Math.max(28, ipOtsu(dbl, n)), diff = new Float32Array(n);
  for (i = 0; i < n; i++) diff[i] = dbl[i] > dthr ? 1 : 0;
  [bright, diff, dark].forEach(function (m) {
    var res = ipQuadFromMask(m, w, h, 1);
    if (res) cands.push(ipOrderQuad(res.quad));
  });
  // 3) Score everything the same way, refine the winner.
  var best = null, bestS = -1;
  for (i = 0; i < cands.length; i++) { var sc = ipQuadScore(P, cands[i]); if (sc > bestS) { bestS = sc; best = cands[i]; } }
  if (!best || bestS < 0.5) return null;
  best = ipRefineQuad(P, best);
  var out = [];
  for (i = 0; i < 4; i++) { out.push(Math.max(0, Math.min(1, best[i][0] / (w - 1)))); out.push(Math.max(0, Math.min(1, best[i][1] / (h - 1)))); }
  return out;
}

// Homography that maps src points to dst points (4 each, [[x,y],...]).
function ipHomography(src, dst) {
  var A = [], b = [], i;
  for (i = 0; i < 4; i++) {
    var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (var col = 0; col < 8; col++) {
    var piv = col;
    for (i = col + 1; i < 8; i++) if (Math.abs(A[i][col]) > Math.abs(A[piv][col])) piv = i;
    var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp; var tb = b[col]; b[col] = b[piv]; b[piv] = tb;
    var pv = A[col][col] || 1e-12;
    for (i = col + 1; i < 8; i++) {
      var fct = A[i][col] / pv;
      for (var k = col; k < 8; k++) A[i][k] -= fct * A[col][k];
      b[i] -= fct * b[col];
    }
  }
  var hvec = new Array(8);
  for (i = 7; i >= 0; i--) {
    var s = b[i];
    for (var k2 = i + 1; k2 < 8; k2++) s -= A[i][k2] * hvec[k2];
    hvec[i] = s / (A[i][i] || 1e-12);
  }
  return [hvec[0], hvec[1], hvec[2], hvec[3], hvec[4], hvec[5], hvec[6], hvec[7], 1];
}

// True width/height ratio of the photographed rectangle (Zhang & He, whiteboard
// rectification), assuming square pixels and a centred principal point.
function ipAspect(qp, W, H) {
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  var u0 = W / 2, v0 = H / 2, maxD = Math.max(W, H);
  var m1 = [qp[0][0], qp[0][1], 1], m2 = [qp[1][0], qp[1][1], 1], m3 = [qp[3][0], qp[3][1], 1], m4 = [qp[2][0], qp[2][1], 1];
  var c14 = cross(m1, m4);
  var k2 = dot(c14, m3) / dot(cross(m2, m4), m3), k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  var f = NaN, den = n2[2] * n3[2];
  if (Math.abs(den) > 1e-12) {
    var f2 = ((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + den * u0 * u0) +
              (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + den * v0 * v0)) / den;
    f = Math.sqrt(Math.abs(f2));
  }
  if (!(f >= 0.3 * maxD && f <= 3 * maxD)) f = 0.8 * maxD;
  function nn(n) { var a = (n[0] - u0 * n[2]) / f, b = (n[1] - v0 * n[2]) / f; return a * a + b * b + n[2] * n[2]; }
  var r = Math.sqrt(nn(n2) / nn(n3));
  return isFinite(r) && r > 0 ? r : NaN;
}

// Output size for a quad (pixel coords) capped at maxDim and maxPx.
function ipQuadSize(qp, maxDim, W, H, maxPx) {
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  var w = Math.max(dist(qp[0], qp[1]), dist(qp[3], qp[2]));
  var h = Math.max(dist(qp[0], qp[3]), dist(qp[1], qp[2]));
  if (W && H) {
    var r = ipAspect(qp, W, H), simple = w / h;
    if (isFinite(r) && r / simple < 1.6 && simple / r < 1.6) {
      if (w / r >= h) h = w / r; else w = h * r;
    }
  }
  var s = Math.min(1, maxDim / Math.max(w, h));
  if (maxPx && w * h * s * s > maxPx) s = Math.sqrt(maxPx / (w * h));
  return [Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))];
}

// Perspective warp; quad is normalized [x0,y0..x3,y3] relative to img.
function ipWarp(img, quad, maxDim, maxPx) {
  var W = img.width, H = img.height;
  var qp = [[quad[0] * W, quad[1] * H], [quad[2] * W, quad[3] * H], [quad[4] * W, quad[5] * H], [quad[6] * W, quad[7] * H]];
  var full = quad[0] <= 0 && quad[1] <= 0 && quad[2] >= 1 && quad[3] <= 0 && quad[4] >= 1 && quad[5] >= 1 && quad[6] <= 0 && quad[7] >= 1;
  if (full && Math.max(W, H) <= maxDim && (!maxPx || W * H <= maxPx)) {
    return { data: new Uint8ClampedArray(img.data), width: W, height: H };
  }
  var sz = ipQuadSize(qp, maxDim, W, H, maxPx), ow = sz[0], oh = sz[1];
  var M = ipHomography([[0, 0], [ow, 0], [ow, oh], [0, oh]], qp);
  var out = ipNew(ow, oh), od = out.data, sd = img.data;
  var Wm = W - 1, Hm = H - 1;
  for (var y = 0; y < oh; y++) {
    var yy = y + 0.5;
    var ax = M[1] * yy + M[2], ay = M[4] * yy + M[5], az = M[7] * yy + 1;
    var o = y * ow * 4;
    for (var x = 0; x < ow; x++, o += 4) {
      var xx = x + 0.5, z = M[6] * xx + az;
      var sx = (M[0] * xx + ax) / z - 0.5, sy = (M[3] * xx + ay) / z - 0.5;
      if (sx < 0) sx = 0; else if (sx > Wm) sx = Wm;
      if (sy < 0) sy = 0; else if (sy > Hm) sy = Hm;
      var x0 = sx | 0, y0 = sy | 0, x1 = x0 < Wm ? x0 + 1 : x0, y1 = y0 < Hm ? y0 + 1 : y0;
      var fx = sx - x0, fy = sy - y0;
      var i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
    }
  }
  return out;
}

// Estimate the paper's brightness everywhere (illumination map) from a gray image.
function ipBackground(L, w, h) {
  var bs = Math.max(2, Math.round(Math.max(w, h) / 90));
  var sw = Math.ceil(w / bs), sh = Math.ceil(h / bs), small = new Float32Array(sw * sh), x, y;
  for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
    var m = 0, y1 = Math.min(h, (y + 1) * bs), x1 = Math.min(w, (x + 1) * bs);
    for (var yy = y * bs; yy < y1; yy++) { var row = yy * w; for (var xx = x * bs; xx < x1; xx++) if (L[row + xx] > m) m = L[row + xx]; }
    small[y * sw + x] = m;
  }
  // Dilate (max filter, radius 1) to swallow headings and thick strokes.
  var dil = new Float32Array(sw * sh);
  for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
    var mm = 0;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var X = Math.min(sw - 1, Math.max(0, x + dx)), Y = Math.min(sh - 1, Math.max(0, y + dy));
      if (small[Y * sw + X] > mm) mm = small[Y * sw + X];
    }
    dil[y * sw + x] = mm;
  }
  // Paper is whatever can be reached from clearly bright blocks through gentle
  // brightness changes (soft shadows). Sharp steps mark content such as photos
  // or filled boxes; those blocks are filled in from the surrounding paper.
  var i, k, srt = Array.prototype.slice.call(dil).sort(function (a, b) { return a - b; });
  var paper = srt[Math.floor(srt.length * 0.9)] || 255, step = paper * 0.06;
  var val = new Float32Array(sw * sh), known = new Uint8Array(sw * sh), queue = new Int32Array(sw * sh), qh = 0, qt = 0, unknown = 0;
  for (i = 0; i < val.length; i++) if (dil[i] >= paper * 0.85) { known[i] = 1; val[i] = dil[i]; queue[qt++] = i; }
  while (qh < qt) {
    var cIdx = queue[qh++], cx2 = cIdx % sw, cy2 = (cIdx - cx2) / sw;
    var nbs = [cx2 > 0 ? cIdx - 1 : -1, cx2 < sw - 1 ? cIdx + 1 : -1, cy2 > 0 ? cIdx - sw : -1, cy2 < sh - 1 ? cIdx + sw : -1];
    for (k = 0; k < 4; k++) {
      var nb = nbs[k];
      if (nb < 0 || known[nb]) continue;
      if (Math.abs(dil[nb] - dil[cIdx]) <= step && dil[nb] > paper * 0.25) { known[nb] = 1; val[nb] = dil[nb]; queue[qt++] = nb; }
    }
  }
  for (i = 0; i < val.length; i++) if (!known[i]) unknown++;
  if (unknown === val.length) { for (i = 0; i < val.length; i++) { val[i] = 255; known[i] = 1; } unknown = 0; }
  for (var it = 0; it < 400 && unknown > 0; it++) {
    var nk = known.slice(), nv = val.slice();
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      k = y * sw + x; if (known[k]) continue;
      var s = 0, c = 0;
      if (x > 0 && known[k - 1]) { s += val[k - 1]; c++; }
      if (x < sw - 1 && known[k + 1]) { s += val[k + 1]; c++; }
      if (y > 0 && known[k - sw]) { s += val[k - sw]; c++; }
      if (y < sh - 1 && known[k + sw]) { s += val[k + sw]; c++; }
      if (c) { nv[k] = s / c; nk[k] = 1; unknown--; }
    }
    known = nk; val = nv;
  }
  var sm = ipBoxBlur(ipBoxBlur(val, sw, sh, 2), sw, sh, 1), bg = new Float32Array(w * h);
  for (y = 0; y < h; y++) {
    var gy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / bs - 0.5)), y0 = gy | 0, fy = gy - y0, y1b = Math.min(sh - 1, y0 + 1);
    for (x = 0; x < w; x++) {
      var gx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / bs - 0.5)), x0 = gx | 0, fx = gx - x0, x1b = Math.min(sw - 1, x0 + 1);
      bg[y * w + x] = (sm[y0 * sw + x0] * (1 - fx) + sm[y0 * sw + x1b] * fx) * (1 - fy) + (sm[y1b * sw + x0] * (1 - fx) + sm[y1b * sw + x1b] * fx) * fy;
    }
  }
  return bg;
}

// Scan looks: original, magic, noshadow, gray, bw, lighten.
function ipFilter(img, filter) {
  if (!filter || filter === 'original') return img;
  var w = img.width, h = img.height, n = w * h, d = img.data, out = ipNew(w, h), od = out.data, i, j;
  var L = ipGray(img);
  var bg = ipBackground(L, w, h);
  if (filter === 'bw') {
    var Ln = new Float32Array(n);
    for (i = 0; i < n; i++) Ln[i] = Math.min(255, L[i] * 250 / Math.max(1, bg[i]));
    var rad = Math.max(6, Math.round(Math.max(w, h) / 70));
    var mean = ipBoxBlur(Ln, w, h, rad);
    for (i = 0, j = 0; i < n; i++, j += 4) {
      var v = (Ln[i] < mean[i] - 14 || Ln[i] < 105) ? 0 : 255;
      od[j] = od[j + 1] = od[j + 2] = v; od[j + 3] = 255;
    }
    return out;
  }
  var target = filter === 'lighten' ? 255 : 248;
  var lo = filter === 'magic' ? 38 : filter === 'gray' ? 30 : filter === 'lighten' ? 14 : 12;
  var hi = filter === 'lighten' ? 225 : 242;
  var sat = filter === 'magic' ? 1.28 : filter === 'lighten' ? 1.05 : 1;
  var gamma = filter === 'lighten' ? 0.85 : filter === 'magic' ? 1.08 : 1;
  var lut = new Uint8ClampedArray(256);
  for (i = 0; i < 256; i++) {
    var t = Math.max(0, Math.min(1, (i - lo) / (hi - lo)));
    lut[i] = Math.round(255 * Math.pow(t, gamma));
  }
  for (i = 0, j = 0; i < n; i++, j += 4) {
    var gain = target / Math.max(1, bg[i]);
    if (gain > 2.4) gain = 2.4;
    var r = d[j] * gain, g = d[j + 1] * gain, b = d[j + 2] * gain;
    if (filter === 'gray') {
      var gv = lut[Math.min(255, (0.299 * r + 0.587 * g + 0.114 * b) | 0)];
      od[j] = od[j + 1] = od[j + 2] = gv;
    } else {
      r = lut[Math.min(255, r | 0)]; g = lut[Math.min(255, g | 0)]; b = lut[Math.min(255, b | 0)];
      if (sat !== 1) {
        var yv = 0.299 * r + 0.587 * g + 0.114 * b;
        r = yv + (r - yv) * sat; g = yv + (g - yv) * sat; b = yv + (b - yv) * sat;
      }
      od[j] = r; od[j + 1] = g; od[j + 2] = b;
    }
    od[j + 3] = 255;
  }
  // A light unsharp mask restores the crispness that straightening softens.
  return ipAdjust(out, { s: 22 });
}

// Brightness (-100..100), contrast (-100..100), sharpen (0..100).
function ipAdjust(img, adj) {
  if (!adj) return img;
  var b = adj.b || 0, c = adj.c || 0, s = adj.s || 0;
  if (!b && !c && !s) return img;
  var w = img.width, h = img.height, n = w * h, d = img.data, i, j, ch;
  var out = { data: new Uint8ClampedArray(d), width: w, height: h }, od = out.data;
  if (s > 0) {
    var amt = s / 100 * 1.6;
    for (ch = 0; ch < 3; ch++) {
      var plane = new Float32Array(n);
      for (i = 0, j = ch; i < n; i++, j += 4) plane[i] = d[j];
      var bl = ipBoxBlur(plane, w, h, 1);
      for (i = 0, j = ch; i < n; i++, j += 4) od[j] = plane[i] + (plane[i] - bl[i]) * amt;
    }
  }
  if (b || c) {
    var cc = c * 1.27, f = (259 * (cc + 255)) / (255 * (259 - cc)), lut = new Uint8ClampedArray(256);
    for (i = 0; i < 256; i++) lut[i] = f * (i - 128) + 128 + b * 1.2;
    for (j = 0; j < od.length; j += 4) { od[j] = lut[od[j]]; od[j + 1] = lut[od[j + 1]]; od[j + 2] = lut[od[j + 2]]; }
  }
  return out;
}

// Rotate by quarter turns clockwise.
function ipRotate(img, q) {
  q = ((q % 4) + 4) % 4;
  if (!q) return img;
  var w = img.width, h = img.height, d = img.data;
  var nw = q % 2 ? h : w, nh = q % 2 ? w : h, out = ipNew(nw, nh), od = out.data;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var nx, ny;
    if (q === 1) { nx = h - 1 - y; ny = x; } else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
    var si = (y * w + x) * 4, di = (ny * nw + nx) * 4;
    od[di] = d[si]; od[di + 1] = d[si + 1]; od[di + 2] = d[si + 2]; od[di + 3] = d[si + 3];
  }
  return out;
}

// Full pipeline used for saving and previews.
function ipProcess(p) {
  var img = p.img;
  if (p.quad) img = ipWarp(img, p.quad, p.maxDim || 2400, p.maxPx);
  else {
    var lim = p.maxDim || 1e9, px = img.width * img.height;
    if (p.maxPx && px > p.maxPx) lim = Math.min(lim, Math.floor(Math.max(img.width, img.height) * Math.sqrt(p.maxPx / px)));
    if (Math.max(img.width, img.height) > lim) img = ipResize(img, lim);
  }
  if (p.filter) img = ipFilter(img, p.filter);
  if (p.adj) img = ipAdjust(img, p.adj);
  if (p.rot) img = ipRotate(img, p.rot);
  return img;
}

// Make a transparent ink cut-out from a photo of a signature or stamp.
function ipInkCutout(img, color) {
  var w = img.width, h = img.height, n = w * h, d = img.data, L = ipGray(img), bg = ipBackground(L, w, h);
  var out = ipNew(w, h), od = out.data, minx = w, miny = h, maxx = -1, maxy = -1;
  for (var i = 0, j = 0; i < n; i++, j += 4) {
    var rel = L[i] / Math.max(1, bg[i]);
    var a = Math.max(0, Math.min(1, (0.78 - rel) / 0.28));
    if (a > 0.05) {
      var x = i % w, y = (i - x) / w;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    if (color) { od[j] = color[0]; od[j + 1] = color[1]; od[j + 2] = color[2]; }
    else { od[j] = d[j] * 0.7; od[j + 1] = d[j + 1] * 0.7; od[j + 2] = d[j + 2] * 0.7; }
    od[j + 3] = a * 255;
  }
  return { img: out, box: maxx < 0 ? null : [minx, miny, maxx, maxy] };
}

// Pack a pure black/white image as 1-bit rows (1 = white), MSB first.
function ipPack1Bit(img) {
  var w = img.width, h = img.height, d = img.data, rowBytes = Math.ceil(w / 8), out = new Uint8Array(rowBytes * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var k = (y * w + x) * 4;
      if (d[k] + d[k + 1] + d[k + 2] > 382) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

var IP_FUNCS = [ipNew, ipGray, ipBoxBlur, ipResize, ipOtsu, ipConvexHull, ipPolyArea, ipMaxQuad, ipOrderQuad,
  ipQuadFromMask, ipPlanes, ipSideScore, ipQuadGeom, ipQuadScore, ipLineX, ipLineY, ipMeet, ipClipLine, ipMkLine, ipHoughLines, ipGutterLines, ipRefineQuad, ipDetectQuad, ipHomography, ipAspect, ipQuadSize, ipWarp, ipBackground, ipFilter, ipAdjust, ipRotate, ipProcess, ipInkCutout, ipPack1Bit];
