// Builds data/similar.json: for every word the system may meet, its nearest "anchor" words
// (words that appear in tool and skill descriptions) by embedding similarity. The result is loaded
// into the graph as Term -SIMILAR-> Term edges, so a task that says "block two hours" can reach
// the calendar tools through "schedule" without any model call at query time.
// Needs Ollama with all-minilm:  ollama pull all-minilm
import fs from 'node:fs';
import { TOOLS } from '../data/catalog.mjs';
import { SKILLS } from '../data/skills.mjs';
import { TASKS } from '../data/tasks.mjs';
import { tokens } from '../src/text.mjs';

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.EMBED_MODEL || 'all-minilm';
const EXTRA = fs.existsSync(new URL('../data/extra-words.txt', import.meta.url)) ? fs.readFileSync(new URL('../data/extra-words.txt', import.meta.url), 'utf8').split(/\s+/) : [];

// EXCLUDE_TEST=1 builds the vocabulary from the catalog, skills and TRAINING tasks only (no held-out wording).
const EXCLUDE_TEST = process.env.EXCLUDE_TEST === '1';
const OUT = new URL(process.env.OUT || '../data/similar.json', import.meta.url);
const docWords = new Set([
  ...TOOLS.flatMap(t => tokens(`${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}`)),
  ...SKILLS.flatMap(([n, d]) => tokens(`${n.replace(/-/g, ' ')} ${d}`)),
]);
const vocab = [...new Set([...docWords, ...TASKS.filter(t => !EXCLUDE_TEST || t.split !== 'test').flatMap(t => tokens(t.text)), ...EXTRA.flatMap(w => tokens(w))])];
console.error(`anchors ${docWords.size}, vocabulary ${vocab.length}`);

async function embed(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 128) {
    const res = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, input: words.slice(i, i + 128) }) });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    out.push(...(await res.json()).embeddings);
  }
  return out;
}
const norm = v => {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
};
const vecs = new Map();
const all = await embed(vocab);
vocab.forEach((w, i) => vecs.set(w, norm(all[i])));
const anchors = [...docWords];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const MIN = Number(process.env.MIN_SIM || 0.5);
const TOP = Number(process.env.TOP || 4);
const similar = [];
for (const w of vocab) {
  const v = vecs.get(w);
  const near = anchors
    .filter(a => a !== w)
    .map(a => [a, dot(v, vecs.get(a))])
    .filter(([, s]) => s >= MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([a, s]) => [a, +s.toFixed(3)]);
  if (near.length) similar.push([w, near]);
}
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, minSim: MIN, top: TOP, words: vocab.length, similar }));
console.error(`wrote ${similar.length} words with neighbours, ${similar.reduce((s, [, n]) => s + n.length, 0)} edges`);
console.error('sample:', JSON.stringify(similar.filter(([w]) => ['block', 'planning', 'quote', 'sick', 'recruiting', 'german', 'exception'].includes(w))));
