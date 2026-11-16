import { tokens } from './text.mjs';

/**
 * The plain-store baseline: BM25 keyword search over tool documents, no graph and no learning.
 * `skillDocs` optionally adds each skill as a document that lists its tools in its own text, which
 * is the strongest thing a flat index can do about multi-tool tasks.
 */
export class Bm25 {
  constructor(docs, { k1 = 1.4, b = 0.75 } = {}) {
    this.docs = docs.map(d => ({ id: d.id, tf: count(tokens(d.text)), len: 0, toolIds: d.toolIds || [d.id] }));
    for (const d of this.docs) d.len = [...d.tf.values()].reduce((a, b2) => a + b2, 0);
    this.avg = this.docs.reduce((a, d) => a + d.len, 0) / this.docs.length;
    this.df = new Map();
    for (const d of this.docs) for (const w of d.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
    this.k1 = k1;
    this.b = b;
  }

  /** Top-k distinct tool ids. Skill documents contribute their tools. */
  search(text, k = 6) {
    const q = [...new Set(tokens(text))];
    const N = this.docs.length;
    const scores = new Map();
    for (const d of this.docs) {
      let s = 0;
      for (const w of q) {
        const f = d.tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5));
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avg));
      }
      if (s > 0) for (const t of d.toolIds) scores.set(t, Math.max(scores.get(t) || 0, s));
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id, score]) => ({ id, score }));
  }
}

function count(arr) {
  const m = new Map();
  for (const w of arr) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
