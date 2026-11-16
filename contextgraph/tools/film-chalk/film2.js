// ---------- per-frame ----------
const tokens = t => {
  if (t < C.booksStart) return 0.02;
  if (t < C.poof) return 0.02 + 0.95 * ss(C.booksStart, C.booksEnd, t);
  if (t < C.fly) return lerp(0.97, 0.04, ss(C.poof, C.poof + 1.8, t));
  if (t < C.cut) return 0.04 + 0.025 * ss(C.fly, C.fly + 1.6, t);
  if (t < C.reconnect) return lerp(0.065, 0.3, ss(C.all18, C.all18 + 1.8, t));
  return lerp(0.3, 0.065, ss(C.reconnect, C.reconnect + 1.4, t));
};
// draw a group into tmp, optionally wipe it with an eraser moving from xFrom to xTo, then add it to the chalk layer
function sweep(drawFn, t, te, xFrom, xTo, dur, ers, target = K) {
  T.setTransform(1, 0, 0, 1, 0, 0); T.globalAlpha = 1; T.globalCompositeOperation = 'source-over'; T.clearRect(0, 0, W, H); drawFn(T);
  if (t > te) {
    const u = cl((t - te) / dur), ex = lerp(xFrom, xTo, ss(0, 1, u)), dirn = Math.sign(xTo - xFrom);
    if (u >= 1) T.clearRect(0, 0, W, H);
    else {
      T.globalCompositeOperation = 'destination-out';
      const gr = T.createLinearGradient(ex, 0, ex + dirn * 90, 0); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); T.fillStyle = gr;
      T.fillRect(Math.min(ex, ex + dirn * 90), 0, 90, H);
      T.fillStyle = 'rgba(0,0,0,1)';
      if (dirn > 0) T.fillRect(0, 0, ex, H); else T.fillRect(ex, 0, W, H);
      T.globalCompositeOperation = 'source-over'; ers.push(ex);
    }
  }
  target.globalAlpha = 1; target.drawImage(tmpC, 0, 0);
}
const bkSmall = Array.from({ length: 18 }, (_, i) => bookStrokes(0, 0, 76, BK[i % 6], 0, 0.1));
const exclam = [st([[TX + 150, TY - 180], [TX + 150, TY - 120]], COL.y, 11, C.notice, 0.25, 1), st(ell(TX + 150, TY - 92, 6, 6), COL.y, 11, C.notice + 0.25, 0.15, 0.5)];
const qM = [st(bez([MX - 40, MBY - 520], [MX - 40, MBY - 580], [MX + 40, MBY - 580], [MX + 20, MBY - 530]), COL.w, 9, C.cut + 1.3, 0.5, 1), st(ell(MX + 20, MBY - 500, 5, 5), COL.w, 9, C.cut + 1.8, 0.15, 0.5)];
const qT = [st(bez([TX + 100, TY - 180], [TX + 100, TY - 240], [TX + 180, TY - 240], [TX + 160, TY - 190]), COL.w, 9, C.shrug, 0.5, 1), st(ell(TX + 160, TY - 160, 5, 5), COL.w, 9, C.shrug + 0.5, 0.15, 0.5)];
const CHECK_BIG = [C.check, C.check2].map(t0 => [st([[1200, 560], [1260, 640], [1390, 480]], COL.g, 16, t0, 0.8, 3)]);
const CHECK_LAP = [C.check, C.check2].map(t0 => [st([[700, 610], [745, 665], [830, 570]], COL.g, 12, t0 + 0.2, 0.6, 2)]);

function scene(ctx, t, ers) {
  const mood = {
    mimir: (t > C.booksStart + 3 && t < C.toggle + 0.3) ? 'x' : (t > C.check && t < C.cut) || (t > C.reconnect + 0.4 && t < C.wipe0) ? 'h' : (t > C.cut + 1 && t < C.all18) ? 'q' : 'n',
    tester: (t > C.alarm && t < C.toggle) || (t > C.cut && t < C.all18 + 1) ? 'worry' : (t > C.check && t < C.cut) || t > C.reconnect + 0.4 ? 'happy' : (t > C.shrug && t < C.thumbs) ? 'shrug' : 'n',
  };
  const bob = Math.sin(t * 2) * 5;
  const sh = (t > C.alarm && t < C.toggle) ? Math.sin(t * 40) * 3 : 0;
  drawAll(ctx, desk, t); drawAll(ctx, laptop, t); drawAll(ctx, tester, t);
  ctx.save(); ctx.translate(sh, bob * ss(6.5, 7.5, t)); drawAll(ctx, mimirParts, t); ctx.restore();
  if (t < 6.4) drawAll(ctx, faceIntro, t);
  else { ctx.save(); ctx.translate(sh, bob); liveFaces(ctx, t, mood); ctx.restore(); }
  // tester's arms (live)
  const typing = t > C.typeStart && t < C.send + 0.5, shrug = t > C.shrug && t < C.thumbs, thumbs = t > C.thumbs && t < C.reconnect + 0.6;
  ctx.globalAlpha = ss(5.2, 5.9, t);
  const arm = pts => { ctx.strokeStyle = COL.b; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); };
  const hand = (x, y) => { ctx.strokeStyle = COL.w; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.stroke(); };
  if (shrug) { arm([[TX + 100, TY + 170], [TX + 200, TY + 180], [TX + 215, TY + 90]]); hand(TX + 218, TY + 66); arm([[TX - 100, TY + 190], [TX - 190, TY + 190], [TX - 205, TY + 110]]); hand(TX - 208, TY + 86); }
  else if (thumbs) { arm([[TX + 100, TY + 170], [TX + 210, TY + 210], [TX + 240, TY + 110]]); hand(TX + 244, TY + 86); ctx.strokeStyle = COL.w; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(TX + 244, TY + 66); ctx.lineTo(TX + 244, TY + 28); ctx.stroke(); }
  else { const by = typing ? Math.sin(t * 22) * 7 : 0; arm([[TX + 100, TY + 170], [TX + 200, TY + 260 + by], [TX + 250, TY + 340]]); hand(TX + 262, TY + 350 + by); }
  ctx.globalAlpha = 1;
  // laptop screen
  if (t > C.check && t < C.cut) drawAll(ctx, CHECK_LAP[0], t);
  else if (t > C.check2 && t < C.reconnect) drawAll(ctx, CHECK_LAP[1], t);
  else if (typing) { for (let i = 0; i < 4; i++) { ctx.strokeStyle = COL.b; ctx.lineWidth = 4; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(630, 575 + i * 38); ctx.lineTo(630 + 40 + ((t * 70 + i * 55) % 190), 575 + i * 38); ctx.stroke(); } ctx.globalAlpha = 1; }
  else if (t > 7) { for (let i = 0; i < 3; i++) { ctx.strokeStyle = 'rgba(244,241,230,0.5)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(630, 580 + i * 45); ctx.lineTo(630 + 120 + i * 40, 580 + i * 45); ctx.stroke(); } }
  // token meter
  drawAll(ctx, meterFrame, t); drawAll(ctx, dig8192, t);
  if (t > C.booksStart) {
    const v = tokens(t), top = MTR.y0 + MTR.h * (1 - v), n = Math.floor((MTR.y0 + MTR.h - top) / 15);
    for (let i = 0; i < n; i++) { const y = MTR.y0 + MTR.h - 10 - i * 15; ctx.strokeStyle = y < wlY ? ((t > C.alarm && t < C.poof && Math.floor(t * 6) % 2) ? '#ffb7a6' : COL.o) : COL.g; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(MTR.x + 8, y + 8); ctx.lineTo(MTR.x + MTR.w - 8, y - 6); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // toggle card (drawn into its own wipeable layer)
  sweep(c2 => {
    drawAll(c2, card, t);
    if (t > C.cardIn + 1.6) {
      const on = ss(C.toggle, C.toggle + 0.2, t); c2.strokeStyle = on > 0.5 ? COL.b : COL.w; c2.lineWidth = 7; c2.beginPath(); c2.arc(640 + 210 + 50 * on, 275, 20, 0, 7); c2.stroke();
      if (t > C.toggle && t < C.toggle + 0.5) for (let i = 0; i < 8; i++) { const a = i * 0.785, r1 = 50 + (t - C.toggle) * 160; c2.strokeStyle = COL.y; c2.lineWidth = 5; c2.beginPath(); c2.moveTo(875 + Math.cos(a) * r1, 275 + Math.sin(a) * r1 * 0.6); c2.lineTo(875 + Math.cos(a) * (r1 + 16), 275 + Math.sin(a) * (r1 + 16) * 0.6); c2.stroke(); }
    }
  }, t, C.toggle + 1.5, 600, 1000, 0.9, ers, ctx);
  // manual towers and counters; swept away when the toggle goes on
  sweep(c2 => {
    SLOTS.forEach((s, i) => {
      if (t < s.ts) return; const u = cl((t - s.ts) / 0.5), y = u < 1 ? lerp(-90, s.y, u * u) : s.y, lean = u < 1 ? 0 : Math.sin(t * 1.7) * (s.lvl / 14) * 6 * (s.x < 1300 ? 1 : -1);
      c2.save(); c2.translate(lean, y); bookStrokesCache[i].forEach(b => drawStroke(c2, b, 99)); c2.restore();
    });
    drawAll(c2, dig264, t); drawAll(c2, dig15522, t);
    for (let i = 0; i < 60 && t > C.poof; i++) { const r = rnd(i + 5), u = (t - C.poof - r() * 0.5) / 1.1; if (u > 0 && u < 1) { const x = 1150 + r() * 600, y = 800 - r() * 400 - u * 120; c2.strokeStyle = [COL.y, COL.b, COL.w][i % 3]; c2.lineWidth = 4; c2.globalAlpha = 1 - u; c2.beginPath(); c2.moveTo(x - 9, y); c2.lineTo(x + 9, y); c2.moveTo(x, y - 9); c2.lineTo(x, y + 9); c2.stroke(); c2.globalAlpha = 1; } }
  }, t, C.poof + 0.1, 1780, 1100, 1.3, ers, ctx);
  // graph
  const out = t > C.cut && t < C.reconnect, a = out ? 1 - 0.78 * ss(C.cut + 0.2, C.cut + 1.0, t) : 1;
  drawAll(ctx, plugS, t, 0, 0, a);
  if (t > C.graph0) {
    drawAll(ctx, graphEdges, t, 0, 0, a * 0.9); drawAll(ctx, graphNodes, t, 0, 0, a);
    if (t > C.path0 && !out) {
      drawAll(ctx, lit, t);
      litNodes.forEach((p, i) => { const sT = i === 0 ? C.path0 : i === 1 ? C.path0 + C.pathStep : C.path0 + C.pathStep + (i - 2) * 0.07 + 0.3, k = ss(sT, sT + 0.3, t); if (k > 0) { ctx.strokeStyle = COL.y; ctx.lineWidth = 6; ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(p[0], p[1], 15 + 4 * Math.sin(t * 6), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; } });
    }
    drawAll(ctx, slotRow, t, 0, 0, a);
    if (t < C.cut || t > C.reconnect) { drawAll(ctx, slotFill, t); drawAll(ctx, d518, t); } else if (t > C.all18) { drawAll(ctx, slotAll, t); drawAll(ctx, d1818, t); }
    if (t > C.newEdge && !out) drawAll(ctx, newEdge, t);
  }
  sweep(c2 => { drawAll(c2, chartFrame, t); drawAll(c2, chartLine, t); drawAll(c2, chartDots, t); }, t, C.cut - 0.8, 1400, 1100, 0.8, ers, ctx);
  if (t > C.cut && t < C.reconnect) drawAll(ctx, bigX, t);
  if (t > C.reconnect - 0.1 && t < C.reconnect + 0.8) for (let i = 0; i < 10; i++) { const ang = i * 0.63, r1 = 20 + (t - C.reconnect + 0.1) * 150; ctx.strokeStyle = COL.y; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(1325 + Math.cos(ang) * r1, 88 + Math.sin(ang) * r1); ctx.lineTo(1325 + Math.cos(ang) * (r1 + 18), 88 + Math.sin(ang) * (r1 + 18)); ctx.stroke(); }
  // manuals flying to Mimir: 5 chosen, later all 18
  if (t > C.fly && t < C.cut) for (let k = 0; k < 5; k++) { const u = cl((t - C.fly - k * 0.18) / 1.2); if (u <= 0) continue; const P = GC[PATH.tools[k]], e = ss(0, 1, u); ctx.save(); ctx.translate(lerp(P[0], 1590, e) - 38, lerp(P[1], 770 - k * 36, e) - Math.sin(u * Math.PI) * 120); bkSmall[k].forEach(b => drawStroke(ctx, b, 99)); ctx.restore(); }
  if (t > C.all18 && t < C.reconnect + 0.6) for (let k = 0; k < 18; k++) { const u = cl((t - C.all18 - k * 0.07) / 0.7); if (u <= 0) continue; const e = ss(0, 1, u); ctx.save(); ctx.translate(lerp(900, 1160 + (k % 3) * 82, e), lerp(300, 768 - Math.floor(k / 3) * 36, e) - Math.sin(u * Math.PI) * 60); bkSmall[k].forEach(b => drawStroke(ctx, b, 99)); ctx.restore(); }
  // symbols and bubbles
  if (t > C.notice && t < C.toggle) drawAll(ctx, exclam, t);
  if (t > C.cut + 1.3 && t < C.all18) drawAll(ctx, qM, t);
  if (t > C.shrug && t < C.thumbs) drawAll(ctx, qT, t);
  if (t > C.typeStart - 0.5 && t < C.send + 0.6) {
    ctx.strokeStyle = COL.w; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(500, 250, 80, 50, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(440, 288); ctx.lineTo(420, 330); ctx.lineTo(470, 296); ctx.stroke();
    if (t < C.send - 0.9) { const n = Math.floor(t * 4) % 4; for (let i = 0; i < 3; i++) { ctx.fillStyle = i < n ? COL.w : 'rgba(244,241,230,0.3)'; ctx.beginPath(); ctx.arc(465 + i * 35, 250, 9, 0, 7); ctx.fill(); } }
    else { ctx.strokeStyle = COL.b; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(492, 244, 22, 0, 7); ctx.moveTo(508, 260); ctx.lineTo(534, 286); ctx.stroke(); }
  }
  if (t > C.check && t < C.cut) drawAll(ctx, CHECK_BIG[0], t); else if (t > C.check2 && t < C.reconnect) drawAll(ctx, CHECK_BIG[1], t);
  if (mood.mimir === 'x') for (let i = 0; i < 2; i++) { const k = ((t * 0.9 + i * 0.5) % 1); ctx.fillStyle = COL.b; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.ellipse(MX + 118 + i * 14, MBY - 400 + k * 90, 7, 11, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
}

function endCard(ctx, t) {
  const u = t - C.end0;
  drawAll(ctx, [st([[200, 905], [1720, 905]], COL.w, 8, C.end0 + 0.2, 1.2, 3)], t);
  drawAll(ctx, sunDisc, t); drawAll(ctx, sunRays, t);
  const s = 1.35; ctx.save(); ctx.translate(560 - MX * s, 900 - MBY * s); ctx.scale(s, s);
  const tm = 4.6 + u * 1.3; drawAll(ctx, mimirParts, tm); drawAll(ctx, faceIntro.slice(0, 4), tm); if (tm > 6.4) liveFaces(ctx, t, { mimir: 'h', tester: 'n' }); ctx.restore();
  drawAll(ctx, hydra, t);
}

function renderAt(t) {
  HEADS = [];
  X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.filter = 'none'; X.drawImage(boardC, 0, 0);
  K.setTransform(1, 0, 0, 1, 0, 0); K.globalCompositeOperation = 'source-over'; K.globalAlpha = 1; K.clearRect(0, 0, W, H);
  const ers = [];
  if (t < C.wipe1 + 0.1) {
    scene(K, t, ers);
    if (t > C.wipe0) { const u = cl((t - C.wipe0) / (C.wipe1 - C.wipe0)), ex = lerp(1780, 100, ss(0, 1, u)); K.globalCompositeOperation = 'destination-out'; const gr = K.createLinearGradient(ex, 0, ex - 100, 0); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); K.fillStyle = gr; K.fillRect(ex - 100, 0, 100, H); K.fillStyle = 'rgba(0,0,0,1)'; K.fillRect(ex, 0, W, H); K.globalCompositeOperation = 'source-over'; if (u < 1) ers.push(ex); }
  }
  if (t > C.end0) endCard(K, t);
  const dust = [];
  HEADS.slice(0, 4).forEach(h => { const s = h.s, n = Math.floor(h.p * (s.p.length - 1)); for (let k = 1; k < 7; k++) { const q = s.p[Math.max(0, n - k * 3)]; if (!q) continue; const r = rnd(k * 31 + n), fall = k * k * 4.5 + k * 6; dust.push([q[0] + (r() - 0.5) * 14, q[1] + fall, (1 - k / 7) * 0.7, 1 + r() * 2.2]); } });
  K.globalCompositeOperation = 'destination-out'; K.fillStyle = MASK; K.globalAlpha = 1; K.fillRect(0, 0, W, H); K.globalCompositeOperation = 'source-over';
  X.save(); X.beginPath(); X.rect(70, 60, 1780, 906); X.clip();
  X.globalAlpha = 0.28; X.filter = 'blur(5px)'; X.drawImage(chalkC, 0, 0); X.filter = 'none'; X.globalAlpha = 1; X.drawImage(chalkC, 0, 0); X.restore();
  dust.forEach(d => { X.fillStyle = `rgba(244,241,230,${d[2]})`; X.fillRect(d[0], d[1], d[3], d[3]); });
  if (HEADS[0]) { const h = HEADS[0]; X.save(); X.translate(h.x, h.y); X.rotate(-0.6); X.fillStyle = h.s.c; X.beginPath(); X.roundRect(0, -8, 54, 16, 4); X.fill(); X.fillStyle = 'rgba(0,0,0,0.25)'; X.fillRect(30, -8, 24, 16); X.restore(); }
  ers.forEach(ex => { const wob = Math.sin(t * 14) * 8; X.save(); X.translate(ex, 520 + wob); X.rotate(0.12); X.fillStyle = 'rgba(0,0,0,0.3)'; X.beginPath(); X.roundRect(-52, -30, 120, 90, 10); X.fill(); X.fillStyle = '#c9b48a'; X.beginPath(); X.roundRect(-60, -48, 120, 52, 10); X.fill(); X.fillStyle = '#3b3f45'; X.beginPath(); X.roundRect(-60, -4, 120, 30, 6); X.fill(); X.restore(); });
  const f = Math.max(1 - ss(0, 1.0, t), ss(C.total - 1.4, C.total, t)); if (f > 0) { X.fillStyle = `rgba(0,0,0,${f})`; X.fillRect(0, 0, W, H); }
}
window.renderAt = renderAt; renderAt(0);
