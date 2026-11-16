// Query-time semantic bridge. The offline vocabulary (data/similar.json) only knows words that were in
// the catalog, the skills or the training tasks. A word it has never seen ("workshop", "webshop") would get
// no similar-word links. This embeds such words on the fly with the same small model, finds their nearest
// "anchor" words (words that appear in tool and skill descriptions), and caches the answer.
// It never throws: no Ollama, no model, a timeout, all mean "no extra links", and retrieval carries on.

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const unit = v => {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
};

export function createEmbedder({ url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434', model = process.env.EMBED_MODEL || 'all-minilm', minSim = 0.5, top = 4, timeoutMs = 4000 } = {}) {
  const anchorVec = new Map(); // anchor word -> unit vector
  const cache = new Map(); // unknown word -> [[anchor, sim], ...]
  let dead = 0; // consecutive failures; after 3 stop trying for a minute
  let deadAt = 0;

  async function embed(words) {
    const res = await fetch(`${url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: words }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    return (await res.json()).embeddings.map(unit);
  }

  /** words: query words with no precomputed links. anchors: every word that appears in tool or skill descriptions. */
  return async function neighbours(words, anchors) {
    const out = new Map();
    const todo = [];
    for (const w of words) {
      if (cache.has(w)) out.set(w, cache.get(w));
      else todo.push(w);
    }
    if (!todo.length) return out;
    if (dead >= 3 && Date.now() - deadAt < 60_000) return out;
    try {
      const missing = anchors.filter(a => !anchorVec.has(a));
      for (let i = 0; i < missing.length; i += 128) {
        const batch = missing.slice(i, i + 128);
        (await embed(batch)).forEach((v, j) => anchorVec.set(batch[j], v));
      }
      const vecs = await embed(todo);
      todo.forEach((w, i) => {
        const near = anchors
          .filter(a => a !== w && anchorVec.has(a))
          .map(a => [a, dot(vecs[i], anchorVec.get(a))])
          .filter(([, s]) => s >= minSim)
          .sort((x, y) => y[1] - x[1])
          .slice(0, top)
          .map(([a, s]) => [a, +s.toFixed(3)]);
        if (cache.size >= 5000) cache.delete(cache.keys().next().value); // oldest first; the text is untrusted
        cache.set(w, near);
        out.set(w, near);
      });
      dead = 0;
    } catch {
      dead += 1;
      deadAt = Date.now();
    }
    return out;
  };
}
