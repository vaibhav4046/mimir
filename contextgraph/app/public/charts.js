// Tiny dependency-free SVG charts.
const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Line chart. series: [{name, color, values:[y], band:[sd]?, dashed?, label?}] */
export function lineChart({ width = 760, height = 360, xs, series, yMin = 0, yMax = 100, yLabel = '%', xLabel = '', refs = [], title = '' }) {
  const m = { l: 56, r: 56, t: 30, b: 52 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const x = i => m.l + (xs.length === 1 ? 0 : (i / (xs.length - 1)) * w);
  const y = v => m.t + h - ((v - yMin) / (yMax - yMin)) * h;
  let g = '';
  for (let t = yMin; t <= yMax; t += (yMax - yMin) / 5) g += `<line x1="${m.l}" x2="${m.l + w}" y1="${y(t)}" y2="${y(t)}" stroke="#2a2a31"/><text x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end" fill="#9b9ba6" font-size="12" font-family="JetBrains Mono, monospace">${Math.round(t)}${yLabel}</text>`;
  xs.forEach((v, i) => (g += `<text x="${x(i)}" y="${m.t + h + 22}" text-anchor="middle" fill="#9b9ba6" font-size="12" font-family="JetBrains Mono, monospace">${esc(v)}</text>`));
  if (xLabel) g += `<text x="${m.l + w / 2}" y="${height - 6}" text-anchor="middle" fill="#9b9ba6" font-size="12.5" font-family="Space Grotesk, sans-serif">${esc(xLabel)}</text>`;
  for (const r of refs) g += `<line x1="${m.l}" x2="${m.l + w}" y1="${y(r.value)}" y2="${y(r.value)}" stroke="${r.color}" stroke-dasharray="6 5" stroke-width="1.6"/><text x="${m.l + w - 4}" y="${y(r.value) - 7}" text-anchor="end" fill="${r.color}" font-size="12.5" font-family="Space Grotesk, sans-serif">${esc(r.label)} ${r.value}%</text>`;
  for (const s of series) {
    if (s.band) {
      const up = s.values.map((v, i) => `${x(i)},${y(Math.min(yMax, v + s.band[i]))}`);
      const dn = s.values.map((v, i) => `${x(i)},${y(Math.max(yMin, v - s.band[i]))}`).reverse();
      g += `<polygon points="${[...up, ...dn].join(' ')}" fill="${s.color}" opacity=".16"/>`;
    }
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="3 7"' : ''} class="draw"/>`;
    s.values.forEach((v, i) => (g += `<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${s.color}"><title>${esc(s.name)}, epoch ${esc(xs[i])}: ${v}${yLabel}</title></circle>`));
    const last = s.values.length - 1;
    if (s.label !== false) g += `<text x="${x(last) - 6}" y="${y(s.values[last]) - 14}" text-anchor="end" fill="${s.color}" font-weight="700" font-size="14" font-family="Space Grotesk, sans-serif">${s.values[last]}%</text>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto">${g}</svg>`;
}

/** Horizontal bars. rows: [{label, value, color, note}] */
export function barChart({ rows, max = 100, unit = '%', width = 760, rowH = 46, title = '' }) {
  const lw = 230;
  const w = width - lw - 90;
  let g = '';
  rows.forEach((r, i) => {
    const yy = i * rowH + 8;
    const bw = Math.max(2, (r.value / max) * w);
    g += `<text x="${lw - 12}" y="${yy + 20}" text-anchor="end" fill="#e8e8ec" font-size="14.5" font-family="Space Grotesk, sans-serif">${esc(r.label)}</text>`;
    g += `<rect x="${lw}" y="${yy + 3}" width="${w}" height="26" rx="6" fill="#1a1a1f"/><rect x="${lw}" y="${yy + 3}" width="${bw}" height="26" rx="6" fill="${r.color}" class="grow"/>`;
    g += `<text x="${lw + bw + 8}" y="${yy + 22}" fill="#f3f3f4" font-weight="700" font-size="14" font-family="JetBrains Mono, monospace">${esc(r.text ?? `${r.value}${unit}`)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${rows.length * rowH + 14}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto">${g}</svg>`;
}
