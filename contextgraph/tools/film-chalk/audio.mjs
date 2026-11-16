// Warm chalkboard soundtrack: soft piano-like plucks, slow pad, brush/chalk noise, tap, eraser swish, thud, chime. Synced to cues.js.
import fs from 'node:fs';
const C = new Function(fs.readFileSync(new URL('./cues.js', import.meta.url), 'utf8') + ';return CUES;')();
const SR = 44100, N = Math.floor(C.total * SR), buf = new Float32Array(N);
const BPM = 84, BEAT = 60 / BPM, BAR = BEAT * 4;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
function add(t0, n, fn) { const s0 = Math.floor(t0 * SR); for (let i = 0; i < n; i++) { const k = s0 + i; if (k >= 0 && k < N) buf[k] += fn(i / SR); } }
// piano-ish pluck: harmonics with different decays and a soft attack
function pluck(t0, midi, vol = 0.2, len = 1.6) { const f = hz(midi); add(t0, Math.floor(len * SR), t => { const e = Math.min(1, t / 0.006); return vol * e * (Math.sin(6.2832 * f * t) * Math.exp(-t * 2.4) + 0.4 * Math.sin(6.2832 * 2 * f * t) * Math.exp(-t * 3.6) + 0.18 * Math.sin(6.2832 * 3 * f * t) * Math.exp(-t * 5.5) + 0.07 * Math.sin(6.2832 * 4.01 * f * t) * Math.exp(-t * 8)); }); }
function pad(t0, dur, midi, vol = 0.05) { const f = hz(midi); add(t0, Math.floor((dur + 1) * SR), t => { const e = Math.min(1, t / 0.8) * (t < dur ? 1 : Math.max(0, 1 - (t - dur))); return vol * e * (Math.sin(6.2832 * f * t) + 0.5 * Math.sin(6.2832 * f * 1.004 * t + 1) + 0.2 * Math.sin(6.2832 * f * 2 * t)) * (0.85 + 0.15 * Math.sin(t * 1.3)); }); }
function noise(t0, dur, vol, lp, rel = 0.1) { let y = 0; add(t0, Math.floor((dur + rel) * SR), t => { y += (rnd() - y) * lp; const e = Math.min(1, t / 0.01) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel)); return y * vol * e; }); }
const thud = t0 => add(t0, Math.floor(0.5 * SR), t => 0.5 * Math.sin(6.2832 * (55 - 20 * t) * t) * Math.exp(-t * 9));
const tap = t0 => { add(t0, Math.floor(0.12 * SR), t => 0.35 * Math.sin(6.2832 * 260 * t) * Math.exp(-t * 60)); noise(t0, 0.02, 0.2, 0.6, 0.03); };
const chime = (t0, midi, vol = 0.12) => add(t0, Math.floor(2.2 * SR), t => vol * (Math.sin(6.2832 * hz(midi) * t) + 0.5 * Math.sin(6.2832 * hz(midi) * 2.76 * t) * Math.exp(-t * 3)) * Math.exp(-t * 1.8));
const swish = (t0, dur) => { let y = 0; add(t0, Math.floor(dur * SR), t => { y += (rnd() - y) * (0.05 + 0.25 * Math.sin(Math.min(1, t / dur) * 3.14)); return y * 0.5 * Math.sin(Math.min(1, t / dur) * 3.14); }); };
// harmony: C G Am F
const PROG = [[48, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]]];
const out = (t) => t >= C.cut && t < C.all18;
for (let bar = 0, t = 0; t < C.total - 3; bar++, t += BAR) {
  const [root, ch] = PROG[bar % 4], quiet = t < 6 || out(t), tense = t >= C.booksStart + 2 && t < C.toggle;
  const pr = tense ? [45, [0, 3, 7]] : [root, ch];
  ch.forEach(o => pad(t, BAR, (tense ? 45 : root) + 12 + o, quiet ? 0.035 : 0.05));
  pad(t, BAR, (tense ? 45 : root) - 12, 0.05);
  if (t >= 2 && !out(t) || out(t) && (t - C.cut) > 2) { // arpeggio plucks, gentle
    const n = t < 6 ? 4 : 8, step = BAR / n;
    for (let i = 0; i < n; i++) pluck(t + i * step, pr[0] + 24 + pr[1][[0, 1, 2, 1, 0, 2, 1, 2][i % 8] % 3], tense ? 0.08 : quiet ? 0.1 : 0.14, 1.2);
  }
  if (t >= C.graph0 - 1 && !out(t) && t < C.wipe0) { pluck(t, root + 12, 0.16, 2); pluck(t + BEAT * 2, root + 7, 0.12, 1.5); } // bass notes
  if (t >= C.relief && t < C.wipe0 && !out(t)) [0, 2, 4, 5].forEach((k, i) => pluck(t + (i * 1.0 + 0.5) * BEAT, root + 36 + [0, 4, 7, 4][i] + (bar % 2 ? 2 : 0), 0.09, 1.4)); // gentle tune
  if (tense) for (let b = 0; b < 8; b++) noise(t + b * BEAT / 2, 0.03, 0.05 + 0.03 * ((t - C.booksStart) / 12), 0.7, 0.02); // ticking
}
// drawing scratch: soft chalk noise while things are drawn
[[0.5, 5.4], [C.booksStart - 0.6, C.booksStart + 0.8], [C.cardIn, C.cardIn + 1.7], [C.graph0, C.graph0 + 4], [C.path0, C.path0 + 1.4], [C.slots, C.slots + 1.8], [C.newEdge, C.newEdge + 1], [C.chart[0] - 1.4, C.chart[2] + 0.5], [C.cut + 0.5, C.cut + 1.5], [C.end0 + 0.2, C.end0 + 3.2]].forEach(([a, b]) => { for (let t = a; t < b; t += 0.22) noise(t, 0.14, 0.035, 0.45, 0.05); });
for (let t = C.booksStart; t < C.booksEnd; t += 0.2) noise(t + 0.4, 0.05, 0.06, 0.3, 0.03); // books landing
// events
tap(C.toggle); pluck(C.toggle + 0.08, 79, 0.12, 1); swish(C.poof + 0.1, 1.3); [84, 88, 91, 96].forEach((m, i) => pluck(C.poof + 0.2 + i * 0.1, m, 0.07, 1.2));
swish(C.toggle + 1.5, 0.9); swish(C.cut - 0.8, 0.8); swish(C.wipe0, C.wipe1 - C.wipe0);
for (let k = 0; k < 6; k++) pluck(C.path0 + k * 0.33, 72 + [0, 2, 4, 7, 9, 12][k], 0.1, 1);
[C.check, C.check2].forEach(t => { chime(t, 88, 0.12); chime(t + 0.12, 91, 0.1); chime(t + 0.24, 95, 0.1); });
for (let i = 0; i < 6; i++) pluck(C.newEdge + i * 0.09, 84 + i * 2, 0.06, 0.9);
C.chart.forEach((t, i) => { pluck(t, 72 + i * 4, 0.12, 1.2); pluck(t + 0.1, 79 + i * 4, 0.12, 1.2); });
thud(C.cut); thud(C.cut + 0.5); pad(C.cut + 0.2, 3, 33, 0.12);
pluck(C.shrug, 64, 0.1, 0.8); pluck(C.shrug + 0.35, 60, 0.1, 1); chime(C.thumbs, 91, 0.12);
thud(C.reconnect - 0.05); for (let i = 0; i < 9; i++) pluck(C.reconnect + 0.05 + i * 0.07, 60 + [0, 4, 7, 12][i % 4] + 12 * Math.floor(i / 4), 0.1, 1.4); chime(C.reconnect + 0.7, 96, 0.1);
// end: slow warm resolution on C
[48, 52, 55, 60].forEach(m => pad(C.end0 - 0.2, 4.4, m + 12, 0.06)); pad(C.end0 - 0.2, 4.4, 36, 0.08);
[72, 76, 79, 84, 79, 76, 72].forEach((m, i) => pluck(C.end0 + 0.3 + i * 0.5, m, 0.12, 2)); chime(C.end0 + 3.2, 84, 0.1);
// master
let peak = 0; for (let i = 0; i < N; i++) { buf[i] = Math.tanh(buf[i] * 1.3); peak = Math.max(peak, Math.abs(buf[i])); }
const gain = 0.7 / peak, fi = 0.8 * SR, fo = 2.6 * SR, o = Buffer.alloc(44 + N * 4);
o.write('RIFF', 0); o.writeUInt32LE(36 + N * 4, 4); o.write('WAVEfmt ', 8); o.writeUInt32LE(16, 16); o.writeUInt16LE(1, 20); o.writeUInt16LE(2, 22); o.writeUInt32LE(SR, 24); o.writeUInt32LE(SR * 4, 28); o.writeUInt16LE(4, 32); o.writeUInt16LE(16, 34); o.write('data', 36); o.writeUInt32LE(N * 4, 40);
let lp = 0;
for (let i = 0; i < N; i++) { lp += (buf[i] - lp) * 0.6; const v = lp * gain * Math.min(1, i / fi) * Math.min(1, (N - i) / fo), s = Math.max(-1, Math.min(1, v)) * 32767, d = Math.floor(0.0007 * SR); o.writeInt16LE(s, 44 + i * 4); o.writeInt16LE(i >= d ? Math.max(-32767, Math.min(32767, buf[i - d] * 0 + s)) : s, 44 + i * 4 + 2); }
fs.writeFileSync(process.argv[2] || 'film.wav', o);
console.log(`wrote ${process.argv[2] || 'film.wav'} ${C.total}s peak ${peak.toFixed(2)}`);
