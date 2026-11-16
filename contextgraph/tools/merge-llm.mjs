// Folds the local-model test (results/llm.json) into results/results.json for the app and the write-ups.
import fs from 'node:fs';
const dir = new URL('../results/', import.meta.url);
const R = JSON.parse(fs.readFileSync(new URL('results.json', dir), 'utf8'));
const L = JSON.parse(fs.readFileSync(new URL('llm.json', dir), 'utf8'));
R.llm = {
  model: L.model,
  sampleSize: L.sampleSize,
  methods: Object.fromEntries(Object.entries(L.methods).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), { firstCallHitPct: v.firstCallHitPct, toolOfferedPct: v.toolOfferedPct, avgToolsOffered: v.avgToolsOffered, avgPromptTokens: v.avgPromptTokens, avgMs: v.avgMs }])),
};
fs.writeFileSync(new URL('results.json', dir), JSON.stringify(R, null, 1));
console.log('merged', Object.keys(R.llm.methods).join(' | '));
