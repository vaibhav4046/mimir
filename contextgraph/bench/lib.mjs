import fs from 'node:fs';
import { createEmbedder } from '../src/embed-similar.mjs';
import { TOOLS, SERVERS, toSchema } from '../data/catalog.mjs';
import { SKILLS, ENTITIES } from '../data/skills.mjs';
import { TASKS, ENTITY_NAMES } from '../data/tasks.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { Bm25 } from '../src/bm25.mjs';

export { TOOLS, SERVERS, SKILLS, ENTITIES, TASKS, ENTITY_NAMES, toSchema };

export const toolIdSet = new Set(TOOLS.map(t => t.id));

/** Seeds a fresh graph on the given store. */
export const SIMILAR = fs.existsSync(new URL('../data/similar.json', import.meta.url)) ? JSON.parse(fs.readFileSync(new URL('../data/similar.json', import.meta.url), 'utf8')).similar : [];

// One shared embedder: its cache and anchor vectors are reused across every graph the benchmarks build.
export const EMBEDDER = process.env.EMBED === '0' ? null : createEmbedder();

export async function freshGraph(store, opts = {}, withSimilar = true) {
  await store.clear?.();
  const g = new ContextGraph(store, opts);
  if (withSimilar && EMBEDDER) g.embedUnknown = EMBEDDER;
  await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
  for (const name of ENTITY_NAMES) await g.registerEntity(name);
  if (withSimilar && SIMILAR.length) await g.loadSimilar(SIMILAR);
  return g;
}

export function bm25Tools() {
  return new Bm25(TOOLS.map(t => ({ id: t.id, text: `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}` })));
}

/** Strongest flat index: skills are documents that carry their tools' ids, so multi-tool tasks can be found. */
export function bm25WithSkills() {
  const docs = TOOLS.map(t => ({ id: t.id, text: `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}` }));
  for (const [name, desc, req] of SKILLS) docs.push({ id: `skill:${name}`, text: `${name.replace(/-/g, ' ')} ${desc}`, toolIds: req });
  return new Bm25(docs);
}

const BY_ID = new Map(TOOLS.map(t => [t.id, t]));
export const schemaChars = ids => ids.reduce((s, id) => s + (BY_ID.has(id) ? JSON.stringify(toSchema(BY_ID.get(id))).length : 290), 0);
export const ALL_SCHEMA_CHARS = TOOLS.reduce((s, t) => s + JSON.stringify(toSchema(t)).length, 0);

export function score(selected, required) {
  const have = new Set(selected);
  const hit = required.filter(r => have.has(r)).length;
  return { complete: hit === required.length, recall: hit / required.length, precision: selected.length ? hit / selected.length : 0, loaded: selected.length };
}

export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const sd = a => {
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
};
export const pct = a => 100 * mean(a);

export function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const trainTasks = TASKS.filter(t => t.split === 'train');
export const testTasks = TASKS.filter(t => t.split === 'test');

export async function evalGraph(g, tasks, k) {
  const out = [];
  for (const t of tasks) {
    const r = await g.retrieve(t.text, { k });
    out.push({ task: t, ...score(r.tools.map(x => x.id), t.tools), ms: r.ms, requests: r.requests, chars: schemaChars(r.tools.map(x => x.id)) });
  }
  return out;
}

export function evalBm25(index, tasks, k) {
  return tasks.map(t => {
    const sel = index.search(t.text, k).map(x => x.id);
    return { task: t, ...score(sel, t.tools), chars: schemaChars(sel) };
  });
}

export const byKind = (rows, kind) => rows.filter(r => r.task.kind === kind);
