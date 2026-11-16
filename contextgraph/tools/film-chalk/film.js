// Chalkboard film. Everything is a hand-wobbled chalk stroke revealed along its length; renderAt(t) is deterministic.
const W = 1920, H = 1080;
const C = CUES;
const cv = document.getElementById('c'), X = cv.getContext('2d');
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const chalkC = mk(), tmpC = mk(), boardC = mk(), noiseC = document.createElement('canvas');
const K = chalkC.getContext('2d'), T = tmpC.getContext('2d'), B = boardC.getContext('2d');
const cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ss = (a, b, t) => { const u = cl((t - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;
const rnd = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const COL = { w: '#f4f1e6', y: '#ffd96a', b: '#8fcbff', o: '#ff8f70', g: '#9be7b5' };

// ---------- board, frame, ledge (baked once) ----------
(function bake() {
  const r = rnd(42);
  let g = B.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#223631'); g.addColorStop(1, '#16241f'); B.fillStyle = g; B.fillRect(0, 0, W, H);
  // old eraser smudges and ghost writing (loops, arrows and swirls only, no letters)
  for (let i = 0; i < 14; i++) { const x = r() * W, y = 80 + r() * 840, rx = 140 + r() * 260, ry = 30 + r() * 60; B.save(); B.translate(x, y); B.rotate((r() - 0.5) * 0.5); B.scale(1, ry / rx); const rg = B.createRadialGradient(0, 0, 0, 0, 0, rx); rg.addColorStop(0, 'rgba(230,240,230,0.07)'); rg.addColorStop(1, 'rgba(230,240,230,0)'); B.fillStyle = rg; B.beginPath(); B.arc(0, 0, rx, 0, 7); B.fill(); B.restore(); }
  B.lineCap = 'round'; B.strokeStyle = 'rgba(235,245,235,0.07)'; B.lineWidth = 3;
  for (let i = 0; i < 26; i++) { const x = 120 + r() * 1650, y = 100 + r() * 800; B.beginPath(); B.moveTo(x, y); for (let k = 1; k < 7; k++) B.lineTo(x + k * 18 + (r() - 0.5) * 18, y + Math.sin(k * 1.3 + i) * 22 + (r() - 0.5) * 8); B.stroke(); }
  for (let i = 0; i < 8; i++) { const x = 140 + r() * 1600, y = 120 + r() * 760; B.beginPath(); B.ellipse(x, y, 30 + r() * 40, 24 + r() * 30, r(), 0, 6.3); B.stroke(); }
  // chalk-dust grain
  const id = B.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  B.putImageData(id, 0, 0);
  // vignette
  g = B.createRadialGradient(W / 2, H / 2 - 40, 300, W / 2, H / 2, 1150); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)'); B.fillStyle = g; B.fillRect(0, 0, W, H);
  // wooden frame
  const wood = (x, y, w, h, horiz) => { const wg = horiz ? B.createLinearGradient(0, y, 0, y + h) : B.createLinearGradient(x, 0, x + w, 0); wg.addColorStop(0, '#8a5a34'); wg.addColorStop(0.5, '#6e4426'); wg.addColorStop(1, '#4e2f19'); B.fillStyle = wg; B.fillRect(x, y, w, h); B.strokeStyle = 'rgba(40,22,10,0.35)'; B.lineWidth = 2; for (let i = 0; i < 14; i++) { B.beginPath(); if (horiz) { const yy = y + r() * h; B.moveTo(x, yy); B.bezierCurveTo(x + w * 0.3, yy + 3, x + w * 0.6, yy - 3, x + w, yy + 1); } else { const xx = x + r() * w; B.moveTo(xx, y); B.bezierCurveTo(xx + 3, y + h * 0.3, xx - 3, y + h * 0.6, xx + 1, y + h); } B.stroke(); } };
  wood(0, 0, W, 52, true); wood(0, 0, 66, H, false); wood(W - 66, 0, 66, H, false);
  B.fillStyle = 'rgba(0,0,0,0.45)'; B.fillRect(66, 52, W - 132, 10); B.fillRect(66, 52, 8, H);
  // ledge
  wood(0, 968, W, 112, true); B.fillStyle = '#a77347'; B.fillRect(0, 968, W, 10); B.fillStyle = 'rgba(0,0,0,0.4)'; B.fillRect(0, 978, W, 8);
  const stub = (x, c, w) => { B.fillStyle = 'rgba(0,0,0,0.35)'; B.fillRect(x + 4, 1000, w, 16); B.fillStyle = c; B.beginPath(); B.roundRect(x, 982, w, 20, 5); B.fill(); B.fillStyle = 'rgba(255,255,255,0.3)'; B.fillRect(x + 4, 985, w - 8, 4); };
  stub(300, COL.w, 78); stub(398, COL.y, 64); stub(480, COL.b, 56); stub(1520, COL.o, 70); stub(1610, COL.g, 60);
  B.fillStyle = 'rgba(0,0,0,0.35)'; B.fillRect(1180, 1004, 190, 14); B.fillStyle = '#c9b48a'; B.beginPath(); B.roundRect(1176, 960, 190, 44, 6); B.fill(); B.fillStyle = '#3b3f45'; B.fillRect(1176, 984, 190, 22); B.fillStyle = 'rgba(255,255,255,0.18)'; B.fillRect(1184, 966, 174, 5);
  // dust on the ledge
  B.fillStyle = 'rgba(244,241,230,0.18)'; for (let i = 0; i < 160; i++) B.fillRect(100 + r() * 1700, 968 + r() * 14, 2, 1);
  // chalk texture mask: speckled holes
  noiseC.width = noiseC.height = 512; const nx = noiseC.getContext('2d'), nd = nx.createImageData(512, 512);
  for (let i = 0; i < nd.data.length; i += 4) { const v = r(); nd.data[i + 3] = v < 0.2 ? 255 : v < 0.3 ? 110 : 0; }
  nx.putImageData(nd, 0, 0);
})();
const MASK = K.createPattern(noiseC, 'repeat');

// ---------- strokes ----------
function dense(pts, seed, amp = 2.4, step = 8) {
  const r = rnd(seed), p1 = r() * 6, p2 = r() * 6, p3 = r() * 6, p4 = r() * 6, out = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) { const u = k / n, d = s + u * L; out.push([lerp(x0, x1, u) + amp * Math.sin(d * 0.035 + p1) + amp * 0.5 * Math.sin(d * 0.11 + p2), lerp(y0, y1, u) + amp * Math.sin(d * 0.04 + p3) + amp * 0.5 * Math.sin(d * 0.09 + p4)]); }
    s += L;
  }
  const l = pts[pts.length - 1]; out.push([l[0] + amp * Math.sin(s * 0.035 + p1), l[1] + amp * Math.sin(s * 0.04 + p3)]);
  return out;
}
let SEED = 1;
function st(pts, c, w, t0, dur, amp) { return { p: dense(pts, SEED++, amp), c, w, t0, dur: Math.max(0.05, dur) }; }
const ell = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, rot = 0) => { const n = Math.max(8, Math.round(Math.abs(a1 - a0) * Math.max(rx, ry) / 14)), o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n), x = Math.cos(a) * rx, y = Math.sin(a) * ry; o.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); } return o; };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const bez = (a, b, c, d, n = 20) => { const o = []; for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; o.push([v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0], v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]]); } return o; };
const plen = s => s.p.length;
// sequence a list of [pts,color,width] so they are drawn one after another between t0 and t1
function seq(defs, t0, t1, amp) {
  const L = defs.map(d => d[0].reduce((s, p, i, a) => s + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0) + 40), tot = L.reduce((a, b) => a + b, 0);
  let t = t0; return defs.map((d, i) => { const dur = (t1 - t0) * L[i] / tot, s = st(d[0], d[1], d[2], t, dur, amp); t += dur; return s; });
}
const GLYPH = { 0: [[0.1, 0], [0.9, 0], [1, 0.3], [1, 1.7], [0.9, 2], [0.1, 2], [0, 1.7], [0, 0.3], [0.1, 0]], 1: [[0.1, 0.5], [0.6, 0], [0.6, 2]], 2: [[0, 0.5], [0.4, 0], [0.9, 0.1], [1, 0.7], [0, 2], [1, 2]], 3: [[0, 0.1], [1, 0], [0.4, 0.9], [1, 1.2], [1, 1.8], [0, 2]], 4: [[0.8, 2], [0.8, 0], [0, 1.4], [1, 1.4]], 5: [[1, 0], [0.1, 0], [0, 0.9], [0.9, 0.9], [1, 1.9], [0, 2]], 6: [[0.9, 0], [0, 0.9], [0, 2], [1, 2], [1, 1], [0, 1]], 7: [[0, 0], [1, 0], [0.4, 2]], 8: [[0.5, 0], [0, 0.5], [0.5, 1], [1, 1.5], [0.5, 2], [0, 1.5], [0.5, 1], [1, 0.5], [0.5, 0]], 9: [[1, 1], [0, 1], [0, 0], [1, 0], [1, 2]], '/': [[1, 0], [0, 2]] };
function digitsStrokes(str, x, y, h, c, w, t0, dur) { const sc = h / 2, adv = sc * 1.45; return [...String(str)].map((ch, i) => GLYPH[ch].map(([gx, gy]) => [x + i * adv + gx * sc * 0.9, y + gy * sc])).map((pts, i, a) => st(pts, c, w, t0 + (dur * i) / a.length, dur / a.length, 1.2)); }

// ---------- drawing ----------
function drawStroke(ctx, s, t, ox = 0, oy = 0, a = 1, widthK = 1) {
  const u = cl((t - s.t0) / s.dur), p = u * u * (3 - 2 * u), n = Math.floor(p * (s.p.length - 1));
  if (n < 1 || a <= 0) return null;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.c;
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = a * (pass ? 0.95 : 0.22);
    for (let i = 0; i < n; i += 8) {
      ctx.lineWidth = (pass ? s.w : s.w * 2.1) * widthK * (0.85 + 0.3 * Math.sin(i * 0.37 + s.t0 * 3));
      ctx.beginPath(); ctx.moveTo(s.p[i][0] + ox, s.p[i][1] + oy);
      for (let k = i + 1; k <= Math.min(n, i + 8); k++) ctx.lineTo(s.p[k][0] + ox, s.p[k][1] + oy);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return p < 1 ? { x: s.p[n][0] + ox, y: s.p[n][1] + oy, s, p } : null;
}
let HEADS = [];
function drawAll(ctx, list, t, ox = 0, oy = 0, a = 1, wk = 1) { for (const s of list) { const h = drawStroke(ctx, s, t, ox, oy, a, wk); if (h) HEADS.push(h); } }
function sweepGroup(drawFn, t, te, x0, x1, dir = -1, dur = 1.1) {
  // draw into tmp, then wipe with a soft eraser edge moving from x0 towards x1; returns sweep x or null
  T.clearRect(0, 0, W, H); drawFn(T);
  let ex = null;
  if (t > te) {
    const u = cl((t - te) / dur), e = ss(0, 1, u); ex = lerp(x0, x1, e);
    T.globalCompositeOperation = 'destination-out'; const gr = T.createLinearGradient(ex - dir * 70, 0, ex + dir * 5, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); T.fillStyle = gr;
    if (dir < 0) { T.fillRect(ex - 70 * dir * -1 - 0, 0, W, H); } // keep simple: hide everything to the right of the eraser
    T.globalCompositeOperation = 'source-over';
    if (u >= 1) { T.clearRect(0, 0, W, H); ex = null; }
  }
  K.drawImage(tmpC, 0, 0);
  return ex;
}

// ---------- scene content ----------
const DESKY = 800;
const desk = seq([[[[150, DESKY], [1700, DESKY]], COL.w, 7], [[[250, DESKY], [250, 930]], COL.w, 5], [[[1600, DESKY], [1600, 930]], COL.w, 5], [[[150, DESKY + 14], [1700, DESKY + 14]], COL.w, 3]], 0.5, 2.2, 2.5);
const laptop = seq([[rect(590, 520, 320, 250), COL.w, 6], [[[615, 545], [885, 545]], COL.w, 2], [[[560, DESKY], [940, DESKY], [915, 772], [585, 772], [560, DESKY]], COL.w, 6], [[[700, 788], [800, 788]], COL.w, 3]], 2.2, 3.6, 2);
// tester
const TX = 380, TY = 430;
const tester = seq([
  [ell(TX, TY, 90, 96), COL.w, 7], [[[TX - 96, TY - 20], [TX - 112, TY + 6], [TX - 94, TY + 24]], COL.w, 4], [[[TX + 96, TY - 20], [TX + 112, TY + 6], [TX + 94, TY + 24]], COL.w, 4],
  [[[TX - 80, TY - 60], [TX - 40, TY - 105], [TX + 20, TY - 100], [TX + 70, TY - 62], [TX + 40, TY - 74], [TX, TY - 60], [TX - 40, TY - 72], [TX - 80, TY - 60]], COL.y, 6],
  [[[TX - 30, TY + 96], [TX - 30, TY + 130], [TX - 130, TY + 160], [TX - 110, DESKY], [TX + 130, DESKY], [TX + 120, TY + 160], [TX + 30, TY + 130], [TX + 30, TY + 96]], COL.b, 7],
  [[[TX - 100, TY + 190], [TX - 160, TY + 270]], COL.b, 5], [[[TX - 120, TY + 150], [TX - 150, DESKY - 40]], COL.b, 3],
], 3.4, 5.4, 2);
// Mimir
const MX = 1450, MBY = DESKY;
const mimirParts = seq([
  [[[MX - 120, MBY], [MX - 140, MBY - 140], [MX - 110, MBY - 250], [MX - 60, MBY - 270], [MX + 60, MBY - 270], [MX + 110, MBY - 250], [MX + 140, MBY - 140], [MX + 120, MBY], [MX - 120, MBY]], COL.b, 8],
  [ell(MX, MBY - 340, 98, 92), COL.w, 7],
  [ell(MX, MBY - 396, 104, 70, Math.PI, Math.PI * 2), COL.y, 7], [[[MX - 106, MBY - 396], [MX + 106, MBY - 396]], COL.y, 6],
  [bez([MX - 96, MBY - 410], [MX - 150, MBY - 425], [MX - 172, MBY - 470], [MX - 138, MBY - 505]), COL.y, 9], [bez([MX + 96, MBY - 410], [MX + 150, MBY - 425], [MX + 172, MBY - 470], [MX + 138, MBY - 505]), COL.y, 9],
  [[[MX - 96, MBY - 292], [MX - 138, MBY - 230], [MX - 112, MBY - 150], [MX - 64, MBY - 84], [MX - 20, MBY - 40], [MX, MBY - 30], [MX + 20, MBY - 40], [MX + 64, MBY - 84], [MX + 112, MBY - 150], [MX + 138, MBY - 230], [MX + 96, MBY - 292]], COL.w, 8],
  [bez([MX - 90, MBY - 270], [MX - 100, MBY - 210], [MX - 85, MBY - 150], [MX - 60, MBY - 90]), COL.w, 4], [bez([MX - 50, MBY - 262], [MX - 70, MBY - 200], [MX - 45, MBY - 140], [MX - 30, MBY - 70]), COL.w, 4], [bez([MX - 10, MBY - 258], [MX - 25, MBY - 190], [MX + 5, MBY - 130], [MX - 5, MBY - 50]), COL.w, 4], [bez([MX + 30, MBY - 260], [MX + 45, MBY - 190], [MX + 20, MBY - 130], [MX + 15, MBY - 60]), COL.w, 4], [bez([MX + 66, MBY - 262], [MX + 80, MBY - 200], [MX + 55, MBY - 140], [MX + 45, MBY - 80]), COL.w, 4], [bez([MX + 92, MBY - 270], [MX + 102, MBY - 210], [MX + 88, MBY - 150], [MX + 66, MBY - 90]), COL.w, 4],
  [[[MX - 140, MBY - 120], [MX + 140, MBY - 120]], COL.y, 5], [[[MX - 140, MBY - 140], [MX - 190, MBY - 90], [MX - 175, MBY - 60]], COL.w, 6], [[[MX + 140, MBY - 140], [MX + 190, MBY - 90], [MX + 175, MBY - 60]], COL.w, 6],
], 4.6, 6.2, 2);
// face intro (normal), then live
const faceIntro = [...[-1, 1].flatMap(k => [st(ell(MX + k * 38, MBY - 350, 22, 24), COL.b, 5, 5.9, 0.25, 1), st(ell(MX + k * 38, MBY - 350, 8, 8), COL.b, 8, 6.05, 0.2, 0.5)]),
  ...[-1, 1].map(k => st(ell(TX + k * 34, TY - 6, 8, 9), COL.w, 7, 5.5, 0.25, 0.5)), st([[TX - 22, TY + 40], [TX + 22, TY + 40]], COL.w, 5, 5.6, 0.3, 0.8), st(ell(TX + 4, TY + 14, 7, 9, 0, 3), COL.w, 3, 5.6, 0.3, 0.5)];
// token meter, books
const MTR = { x: 1750, y0: 170, h: 610, w: 56 };
const wlY = MTR.y0 + MTR.h * (1 - 8192 / 16000);
const meterFrame = seq([[rect(MTR.x, MTR.y0, MTR.w, MTR.h), COL.w, 6], [[[MTR.x - 22, wlY], [MTR.x + MTR.w + 22, wlY]], COL.b, 5]], C.booksStart - 0.8, C.booksStart + 0.6, 2);
const dig8192 = digitsStrokes('8192', MTR.x - 150, wlY - 18, 40, COL.b, 5, C.booksStart + 0.2, 1.2);
const dig15522 = digitsStrokes('15522', MTR.x - 190, MTR.y0 - 72, 50, COL.o, 6, C.booksStart + 7, 1.6);
const dig264 = digitsStrokes('264', 1260, 190, 50, COL.y, 5, C.booksStart + 3.8, 1.2);
const BK = ['#8fcbff', '#ff8f70', '#9be7b5', '#ffd96a', '#d8b4ff', '#f4f1e6'];
const SLOTS = [];
for (let lvl = 0; lvl < 14; lvl++) { SLOTS.push({ x: 1140, lvl, w: 150 }); SLOTS.push({ x: 1580, lvl, w: 150 }); if (lvl < 4) for (let k = 0; k < 2; k++) SLOTS.push({ x: 1305 + k * 135, lvl, w: 130 }); }
SLOTS.forEach((s, i) => { s.ts = C.booksStart + (i / SLOTS.length) * (C.booksEnd - C.booksStart); s.y = DESKY - 34 * (s.lvl + 1); s.col = BK[(i * 5 + (i >> 2)) % 6]; });
function bookStrokes(x, y, w, col, t0, dur, tilt = 0) { return [st(rect(x, y, w, 32), col, 5, t0, dur, 1.5), st([[x + 10, y + 7], [x + w - 10, y + 7]], col, 3, t0 + dur * 0.5, dur * 0.5, 1), st([[x + 10, y + 21], [x + w * 0.6, y + 21]], col, 3, t0 + dur * 0.5, dur * 0.5, 1)]; }
const bookStrokesCache = SLOTS.map((s, i) => bookStrokes(s.x, 0, s.w, s.col, 0, 0.3));
// toggle card
const cardDefs = () => { const x = 640, y = 150, w = 330, h = 190; return seq([[rect(x, y, w, h), COL.w, 7], [ell(x + 70, y + 60, 14, 14), COL.b, 5], [ell(x + 130, y + 120, 14, 14), COL.b, 5], [ell(x + 70, y + 130, 14, 14), COL.b, 5], [[[x + 70, y + 74], [x + 70, y + 116]], COL.b, 4], [[[x + 82, y + 68], [x + 120, y + 112]], COL.b, 4], [ell(x + 235, y + 125, 55, 30), COL.w, 6]], C.cardIn, C.cardIn + 1.6, 2); };
const card = cardDefs();
// graph
const rg = rnd(9);
const GA = [], GB = [], GC = [];
for (let i = 0; i < 9; i++) GA.push([620 + rg() * 20, 140 + i * 31]);
for (let i = 0; i < 6; i++) GB.push([930 + rg() * 30, 150 + i * 48]);
for (let i = 0; i < 12; i++) GC.push([1250 + rg() * 24, 134 + i * 22.5]);
const PATH = { a: 4, b: 2, tools: [1, 4, 6, 9, 11] };
const EAB = [], EBC = [];
GA.forEach((_, i) => { EAB.push([i, Math.min(5, Math.floor(i * 6 / 9))]); EAB.push([i, (Math.floor(i * 6 / 9) + 1 + (i % 2)) % 6]); });
GB.forEach((_, j) => { for (let k = 0; k < 3; k++) EBC.push([j, (j * 2 + k * 4 + (j % 3)) % 12]); });
EAB.push([PATH.a, PATH.b]); PATH.tools.forEach(tl => EBC.push([PATH.b, tl]));
const gStart = C.graph0;
const graphEdges = [], graphNodes = [];
EAB.forEach(([i, j], k) => graphEdges.push(st([GA[i], GB[j]], 'rgba(244,241,230,0.55)', 2.5, gStart + 1.6 + k * 0.08, 0.5, 1)));
EBC.forEach(([j, l], k) => graphEdges.push(st([GB[j], GC[l]], 'rgba(244,241,230,0.55)', 2.5, gStart + 2.8 + k * 0.05, 0.5, 1)));
GA.forEach((p, i) => graphNodes.push(st(ell(p[0], p[1], 11, 11), COL.b, 5, gStart + i * 0.09, 0.35, 0.8)));
GB.forEach((p, i) => graphNodes.push(st(ell(p[0], p[1], 15, 15), COL.y, 6, gStart + 0.9 + i * 0.1, 0.4, 0.8)));
GC.forEach((p, i) => graphNodes.push(st(ell(p[0], p[1], 10, 10), COL.g, 5, gStart + 1.8 + i * 0.07, 0.35, 0.8)));
const lit = [st([GA[PATH.a], GB[PATH.b]], COL.o, 7, C.path0, C.pathStep, 1), ...PATH.tools.map((tl, i) => st([GB[PATH.b], GC[tl]], COL.o, 7, C.path0 + C.pathStep + i * 0.07, C.pathStep * 0.8, 1))];
const litNodes = [GA[PATH.a], GB[PATH.b], ...PATH.tools.map(tl => GC[tl])];
const SLX = 620, SLY = 430, SLW = 31;
const slotRow = Array.from({ length: 18 }, (_, i) => st(rect(SLX + i * (SLW + 3), SLY, SLW, 46), COL.w, 4, C.slots + i * 0.05, 0.25, 0.8));
const slotFill = Array.from({ length: 5 }, (_, i) => [0, 1, 2, 3].map(k => st([[SLX + i * (SLW + 3) + 6, SLY + 10 + k * 9], [SLX + i * (SLW + 3) + SLW - 6, SLY + 14 + k * 9]], COL.y, 5, C.slots + 1.1 + i * 0.12, 0.2, 0.5))).flat();
const slotAll = Array.from({ length: 18 }, (_, i) => [0, 1, 2, 3].map(k => st([[SLX + i * (SLW + 3) + 6, SLY + 10 + k * 9], [SLX + i * (SLW + 3) + SLW - 6, SLY + 14 + k * 9]], COL.w, 5, C.all18 + i * 0.06, 0.2, 0.5))).flat();
const d518 = digitsStrokes('5/18', 960, 488, 46, COL.y, 5, C.slots + 1.8, 0.9);
const d1818 = digitsStrokes('18/18', 960, 488, 46, COL.w, 5, C.all18 + 0.2, 1.0);
const newEdge = [st([GA[0], GC[8]], COL.b, 8, C.newEdge, 1.0, 1.5)];
// chart
const CHX = 1390, CHY = 100, CHW = 300, CHH = 220;
const chartFrame = seq([[rect(CHX, CHY, CHW, CHH), COL.w, 6], [[[CHX + 24, CHY + CHH - 26], [CHX + CHW - 20, CHY + CHH - 26]], COL.w, 4], [[[CHX + 24, CHY + 20], [CHX + 24, CHY + CHH - 26]], COL.w, 4]], C.chart[0] - 1.4, C.chart[0] - 0.2, 1.5);
const cpts = [0.18, 0.4, 0.62, 0.86].map((v, i) => [CHX + 60 + i * 70, CHY + CHH - 26 - v * 170]);
const chartLine = [1, 2, 3].map(i => st([cpts[i - 1], cpts[i]], COL.y, 8, C.chart[i - 1] - 0.15, 0.7, 1));
const chartDots = cpts.map((p, i) => st(ell(p[0], p[1], 9, 9), COL.w, 6, i ? C.chart[i - 1] + 0.45 : C.chart[0] - 0.4, 0.25, 0.5));
// plug and big X
const plugS = seq([[rect(1290, 70, 70, 36), COL.w, 5], [[[1255, 82], [1290, 82]], COL.w, 5], [[[1255, 96], [1290, 96]], COL.w, 5], [[[1360, 80], [1395, 80]], COL.w, 4], [[[1360, 96], [1395, 96]], COL.w, 4]], C.graph0 + 0.5, C.graph0 + 1.6, 1.5);
const bigX = [st([[640, 150], [1380, 420]], COL.o, 16, C.cut + 0.5, 0.5, 4), st([[1380, 150], [640, 420]], COL.o, 16, C.cut + 1.0, 0.5, 4)];
// checks, bubbles
const bigCheck = t0 => [st([[1200, 560], [1260, 640], [1390, 480]], COL.g, 16, t0, 0.8, 3)];
const lapCheck = t0 => [st([[700, 610], [745, 665], [830, 570]], COL.g, 12, t0, 0.6, 2)];
// end card
const sunRays = Array.from({ length: 12 }, (_, i) => { const a = Math.PI + (i / 11) * Math.PI, rr = 150; return st([[960 + Math.cos(a) * (rr + 20), 640 + Math.sin(a) * (rr + 20)], [960 + Math.cos(a) * (rr + 80), 640 + Math.sin(a) * (rr + 80)]], COL.y, 7, C.end0 + 1.4 + i * 0.08, 0.3, 1.5); });
const sunDisc = [st(ell(960, 640, 150, 150, Math.PI, Math.PI * 2), COL.y, 9, C.end0 + 0.4, 1.2, 2), st([[780, 640], [1140, 640]], COL.y, 7, C.end0 + 1.2, 0.5, 2)];
const hydra = (() => { const ox = 1440, oy = 840, out = []; const neck = (dx, top, t0) => out.push(st(bez([ox, oy], [ox + dx * 0.2, oy - 140], [ox + dx * 1.3, oy - top * 0.5], [ox + dx, oy - top]), COL.b, 10, t0, 0.8, 2), st(ell(ox + dx, oy - top - 10, 34, 28), COL.b, 8, t0 + 0.7, 0.4, 1), st(ell(ox + dx + 8, oy - top - 14, 6, 6), COL.o, 8, t0 + 1.1, 0.15, 0.5)); neck(-170, 360, C.end0 + 1.0); neck(0, 450, C.end0 + 1.4); neck(170, 360, C.end0 + 1.8); out.push(st(ell(ox, oy, 70, 26), COL.g, 9, C.end0 + 0.8, 0.5, 1)); [-1, 1].forEach(k => out.push(st([[ox + k * 70, oy], [ox + k * 130, oy + 8]], COL.g, 6, C.end0 + 1.0, 0.3, 1))); return out; })();

// ---------- live faces ----------
function liveFaces(ctx, t, mood) {
  const w = 1, tk = 6;
  const drawLive = (pts, c, wd) => { ctx.strokeStyle = c; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = wd; ctx.globalAlpha = 0.95; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.globalAlpha = 1; };
  const m = mood.mimir, s = mood.tester;
  const mf = k => [MX + k * 38, MBY - 350];
  [-1, 1].forEach(k => {
    const [ex, ey] = mf(k);
    if (m === 'x') { drawLive([[ex - 16, ey - 16], [ex + 16, ey + 16]], COL.o, 7); drawLive([[ex + 16, ey - 16], [ex - 16, ey + 16]], COL.o, 7); }
    else if (m === 'h') { drawLive(ell(ex, ey + 6, 18, 16, Math.PI * 1.1, Math.PI * 1.9), COL.b, 7); }
    else { drawLive(ell(ex, ey, 22, 24), COL.b, 5); drawLive(ell(ex + (m === 'q' ? 6 : 0), ey + (m === 'q' ? -6 : 0), 8, 8), COL.b, 9); }
  });
  drawLive([[MX - 30, MBY - 292], [MX, MBY - (m === 'h' ? 280 : 290)], [MX + 30, MBY - 292]], COL.w, 4);
  // tester
  [-1, 1].forEach(k => { const ex = TX + k * 34, ey = TY - 6; if (s === 'worry') { drawLive(ell(ex, ey, 9, 11), COL.w, 7); drawLive([[ex - 14, ey - 26 - k * 5], [ex + 14, ey - 18 + k * 5]], COL.w, 5); } else if (s === 'happy') drawLive(ell(ex, ey + 4, 14, 12, Math.PI * 1.1, Math.PI * 1.9), COL.w, 6); else drawLive(ell(ex, ey, 8, 9), COL.w, 8); });
  drawLive([[TX + 4, TY + 8], [TX + 14, TY + 20], [TX + 2, TY + 22]], COL.w, 3);
  if (s === 'happy') drawLive(ell(TX, TY + 36, 34, 22, 0.15, Math.PI - 0.15), COL.w, 5);
  else if (s === 'worry') drawLive(ell(TX, TY + 48, 22, 16, Math.PI * 1.1, Math.PI * 1.9), COL.w, 5);
  else if (s === 'shrug') drawLive(ell(TX + 2, TY + 44, 12, 14), COL.w, 5);
  else drawLive([[TX - 22, TY + 40], [TX + 22, TY + 40]], COL.w, 5);
}
