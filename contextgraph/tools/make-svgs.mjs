// Draws the README graphics as real SVG files from results/results.json, so a picture can only show what was measured.
//   node tools/make-svgs.mjs
import fs from 'node:fs';

const dir = new URL('../', import.meta.url);
const out = new URL('docs/img/', dir);
fs.mkdirSync(out, { recursive: true });
const R = JSON.parse(fs.readFileSync(new URL('results/results.json', dir), 'utf8'));

const b64 = (f, mime) => `data:${mime};base64,${fs.readFileSync(new URL(f, out)).toString('base64')}`;
const LOGO_H = b64('hydradb-logo.jpg', 'image/jpeg'); // HydraDB's official mark (its GitHub organization avatar)
const LOGO_M = b64('mimir-head.svg', 'image/svg+xml'); // Mimir's own brand sprite
const logo = (x, y, size, uri, label, round = 8) =>
  `<clipPath id="c${x}_${y}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${round}"/></clipPath><image x="${x}" y="${y}" width="${size}" height="${size}" href="${uri}" clip-path="url(#c${x}_${y})" preserveAspectRatio="xMidYMid slice"><title>${label}</title></image>`;
const logos = W => logo(W - 100, 14, 36, LOGO_M, 'Mimir', 6) + logo(W - 56, 14, 36, LOGO_H, 'HydraDB', 6);
const BG = '#0b0b0d';
const PANEL = '#15151a';
const INK = '#ececf1';
const MUTED = '#9a9aa6';
const ACCENT = '#ff5b1f';
const GREEN = '#37d67a';
const BLUE = '#5aa9ff';
const FONT = "font-family=\"Inter, 'Segoe UI', Helvetica, Arial, sans-serif\"";
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">\n<title>${esc(title)}</title>\n<rect width="${w}" height="${h}" rx="16" fill="${BG}"/>\n${body}\n</svg>\n`;
const text = (x, y, s, { size = 14, fill = INK, weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const n = x => Number(x).toLocaleString('en-US');

// 1. Learning curve ------------------------------------------------------------------------
{
  const W = 860, H = 420, L = 96, Rr = 80, T = 70, B = 70;
  const lc = R.learningCurve.testCompleteMean;
  const flat = R.flatLearner ? Math.max(...R.flatLearner.rows.slice(1).map(x => x.complete)) : null;
  const bm = R.baselines.bm25ToolsAndSkills.complete;
  const x = i => L + (i * (W - L - Rr)) / (lc.length - 1);
  const y = v => T + ((100 - v) * (H - T - B)) / 60 - ((100 - 100) * 0); // axis 40..100
  const yy = v => T + ((100 - v) / 60) * (H - T - B);
  let g = text(L, 34, 'Does it learn? Held-out coverage over training passes', { size: 18, weight: 700 });
  g += text(L, 54, '80 tasks worded differently from anything it trained on. Higher is better.', { size: 12.5, fill: MUTED });
  for (const v of [40, 50, 60, 70, 80, 90, 100]) {
    g += `<line x1="${L}" x2="${W - Rr}" y1="${yy(v)}" y2="${yy(v)}" stroke="#2a2a33" stroke-width="1"/>` + text(L - 10, yy(v) + 4, `${v}%`, { size: 11.5, fill: MUTED, anchor: 'end' });
  }
  const hline = (v, color, label, dash) =>
    `<line x1="${L}" x2="${W - Rr}" y1="${yy(v)}" y2="${yy(v)}" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>` + text(W - Rr, yy(v) + 16, label, { size: 11.5, fill: color, anchor: 'end' });
  g += hline(bm, MUTED, `keyword search over tools and skills ${bm}%`, '6 5');
  if (flat) g += hline(flat, BLUE, `keyword index that also learns ${flat}%`, '2 5');
  const pts = lc.map((v, i) => `${x(i)},${yy(v)}`).join(' ');
  g += `<polyline points="${pts}" fill="none" stroke="${ACCENT}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  lc.forEach((v, i) => {
    g += `<circle cx="${x(i)}" cy="${yy(v)}" r="5" fill="${ACCENT}" stroke="${BG}" stroke-width="2"/>` + text(x(i), yy(v) - 12, `${Math.round(v * 10) / 10}%`, { size: 12, weight: 600, anchor: 'middle' });
    g += text(x(i), H - B + 22, i === 0 ? 'before learning' : `after ${i} pass${i > 1 ? 'es' : ''}`, { size: 11.5, fill: MUTED, anchor: 'middle' });
  });
  g += text(L, H - 18, 'Coverage = every tool the task needs was pulled. Peaks after one pass, then drifts: more passes over the same examples do not help.', { size: 11.5, fill: MUTED });
  g += logos(W);
  fs.writeFileSync(new URL('learning-curve.svg', out), svg(W, H, 'Held-out coverage over training passes', g));
}

// 2. Tokens ---------------------------------------------------------------------------------
{
  const m = R.llm?.methods || {};
  const rows = [
    ['All tools preloaded', m['All tools preloaded'], MUTED],
    ['Context Graph (after learning)', m['Graph, after learning'], ACCENT],
  ].filter(r => r[1]);
  if (rows.length === 2) {
    const W = 860, H = 300, L = 250, Rr = 150;
    const max = Math.max(...rows.map(r => r[1].avgPromptTokens));
    let g = text(24, 34, 'What the model has to read before it sees your question', { size: 18, weight: 700 });
    g += text(24, 54, `A real small model (qwen3:1.7b through Ollama), ${R.llm.tasks || 40} unseen tasks, ${R.config.catalogTools} tools in the catalog.`, { size: 12.5, fill: MUTED });
    rows.forEach(([label, v, color], i) => {
      const yTop = 90 + i * 70;
      const w = Math.max(6, ((W - L - Rr) * v.avgPromptTokens) / max);
      g += text(24, yTop + 26, label, { size: 14, weight: 600 });
      g += `<rect x="${L}" y="${yTop}" width="${w}" height="40" rx="8" fill="${color}"/>`;
      g += text(L + w + 12, yTop + 20, `${n(v.avgPromptTokens)} tokens`, { size: 15, weight: 700 });
      g += text(L + w + 12, yTop + 38, `${n(v.avgMs)} ms per call`, { size: 12, fill: MUTED });
    });
    g += text(24, H - 36, `The honest part: first tool call was right ${m['Graph, after learning'].firstCallHitPct}% of the time with the graph and ${m['All tools preloaded'].firstCallHitPct}% with everything loaded.`, { size: 12.5, fill: MUTED });
    g += text(24, H - 16, 'The measured win is cost and speed, not accuracy.', { size: 12.5, fill: MUTED });
    g += logos(W);
    fs.writeFileSync(new URL('tokens.svg', out), svg(W, H, 'Prompt tokens with and without Context Graph', g));
  }
}

// 3. Architecture ---------------------------------------------------------------------------
{
  const W = 860, H = 360;
  const box = (x, y, w, h, label, sub, color) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${PANEL}" stroke="${color}" stroke-width="2"/>` +
    text(x + w / 2, y + h / 2 - 2, label, { size: 15, weight: 700, anchor: 'middle' }) +
    (sub ? text(x + w / 2, y + h / 2 + 18, sub, { size: 11.5, fill: MUTED, anchor: 'middle' }) : '');
  const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUTED}" stroke-width="2" marker-end="url(#a)"/>`;
  let g = `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="${MUTED}"/></marker></defs>`;
  g += text(24, 34, 'How a request flows', { size: 18, weight: 700 });
  g += box(24, 90, 170, 70, 'Your request', 'e.g. "refund Acme"', BLUE);
  g += box(24, 230, 170, 70, 'Agent (Mimir)', 'offers only the pulled tools', GREEN);
  g += `<rect x="250" y="70" width="586" height="250" rx="16" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="6 6"/>`;
  g += text(268, 96, 'A graph stored in HydraDB, on your computer', { size: 13, fill: ACCENT, weight: 700 });
  g += box(274, 130, 120, 56, 'Words', 'refund, Acme', BLUE);
  g += box(440, 130, 120, 56, 'Skills', 'issue-refund', ACCENT);
  g += box(606, 130, 120, 56, 'Tools', 'stripe__refund', GREEN);
  g += box(440, 236, 286, 56, 'Entities', 'Acme resolves to Stripe', MUTED);
  g += arrow(394, 158, 438, 158) + arrow(560, 158, 604, 158) + arrow(500, 236, 500, 188) + arrow(666, 236, 666, 188);
  g += arrow(194, 125, 272, 150) + arrow(606, 190, 196, 250);
  g += text(398, 340, 'Learning: when a tool really worked, its links get stronger. No AI model is called to retrieve or to learn.', { size: 12, fill: MUTED, anchor: 'middle' });
  g += text(730, 214, 'a few bounded reads', { size: 11, fill: MUTED, anchor: 'start' });
  g += logo(32, 238, 34, LOGO_M, 'Mimir', 6) + logo(W - 66, 76, 34, LOGO_H, 'HydraDB', 6);
  fs.writeFileSync(new URL('architecture.svg', out), svg(W, H, 'Request flow through the HydraDB graph', g));
}
console.log('wrote', fs.readdirSync(out).join(', '));
