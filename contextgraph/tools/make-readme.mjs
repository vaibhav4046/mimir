// Fills README.template.md from results/results.json so the README can only say what was measured.
//   node tools/make-readme.mjs [liveUrl] [videoUrl]
import fs from 'node:fs';
const [LIVE = '(see the repository description)', VIDEO = '(see the repository description)'] = process.argv.slice(2);
const dir = new URL('../', import.meta.url);
const R = JSON.parse(fs.readFileSync(new URL('results/results.json', dir), 'utf8'));
const c = R.config;
const lc = R.learningCurve;
const bl = R.baselines;
const last = lc.epochs.length - 1;
const row = (...a) => `| ${a.join(' | ')} |`;
const md = [];

md.push(`${c.tasks} tasks (${c.train} for training, ${c.test} held out with different wording) over a catalog of ${c.catalogTools} tools (${c.realMimirTools} are Mimir's real tools, ${c.skills} skills). "Complete" means every tool the task needs was pulled (top ${c.k}). ${c.trials} independent runs with different training order; ± is one standard deviation.`);
md.push('');
md.push('### It learns: held-out accuracy by training pass');
md.push(row('Training passes', ...lc.epochs.map(String)));
md.push(row('---', ...lc.epochs.map(() => '---:')));
md.push(row('Held-out, complete', ...lc.testCompleteMean.map((v, i) => `${v}% ±${lc.testCompleteSd[i]}`)));
md.push(row('Held-out, plain jobs', ...lc.byKindMean.D.map(v => `${v}%`)));
md.push(row('Held-out, skill jobs', ...lc.byKindMean.S.map(v => `${v}%`)));
md.push(row('Held-out, entity jobs', ...lc.byKindMean.E.map(v => `${v}%`)));
md.push(row('Training tasks, complete', ...lc.trainCompleteMean.map(v => `${v}%`)));
md.push('');
md.push(`Pass 0 is before any learning (the cold graph, built only from tool descriptions, skills and similar-word links). Edge writes per run: about ${lc.edgeWritesPerTrial.toLocaleString()}.`);
md.push('');
md.push('### Versus the alternatives (held-out tasks)');
md.push(row('Method', 'Complete', 'Tools in prompt', 'Schema characters'));
md.push(row('---', '---:', '---:', '---:'));
md.push(row(`Preload all ${c.catalogTools} (complete by construction)`, '100%', String(c.catalogTools), c.allToolsSchemaChars.toLocaleString()));
md.push(row('**Graph, after learning**', `**${lc.testCompleteMean[last]}%**`, String(lc.avgToolsLoaded[last]), (R.scale?.[0]?.graphSchemaChars || 0).toLocaleString()));
md.push(row('Graph, cold start', `${lc.testCompleteMean[0]}%`, String(lc.avgToolsLoaded[0]), (R.scale?.[0]?.graphSchemaChars || 0).toLocaleString()));
md.push(row('Keyword search (BM25) over tools and skills', `${bl.bm25ToolsAndSkills.complete}%`, String(bl.bm25ToolsAndSkills.avgTools), bl.bm25ToolsAndSkills.avgSchemaChars.toLocaleString()));
md.push(row('Keyword search (BM25) over tools', `${bl.bm25Tools.complete}%`, String(bl.bm25Tools.avgTools), bl.bm25Tools.avgSchemaChars.toLocaleString()));
if (R.flatLearner) {
  md.push('');
  md.push('### Against a keyword index that also learns');
  md.push(R.flatLearner.note);
  md.push('');
  md.push(row('Method', 'Complete', 'Plain', 'Skill', 'Entity'));
  md.push(row('---', '---:', '---:', '---:', '---:'));
  md.push(row('Graph, after learning', `${lc.testCompleteMean[last]}%`, `${lc.byKindMean.D[last]}%`, `${lc.byKindMean.S[last]}%`, `${lc.byKindMean.E[last]}%`));
  for (const x of R.flatLearner.rows) md.push(row(x.label, `${x.complete}%`, `${x.byKind.D}%`, `${x.byKind.S}%`, `${x.byKind.E}%`));
}
if (R.unseenJobs) {
  md.push('');
  md.push('### Jobs it has never seen');
  md.push(R.unseenJobs.note);
  md.push('');
  md.push(row('Method', 'Complete', 'Plain', 'Skill', 'Entity'));
  md.push(row('---', '---:', '---:', '---:', '---:'));
  for (const x of R.unseenJobs.rows) md.push(row(x.label, `${x.complete}%`, `${x.byKind.D}%`, `${x.byKind.S}%`, `${x.byKind.E}%`));
}
if (R.llm) {
  md.push('');
  md.push(`### End to end with a real local model (${R.llm.model}, Ollama, ${R.llm.sampleSize} unseen tasks, temperature 0)`);
  md.push(row('Tools offered by', 'First call is a needed tool', 'Needed tool offered', 'Tools', 'Prompt tokens', 'Time per call'));
  md.push(row('---', '---:', '---:', '---:', '---:', '---:'));
  for (const [k, v] of Object.entries(R.llm.methods)) md.push(row(k, `${v.firstCallHitPct}%`, `${v.toolOfferedPct}%`, String(v.avgToolsOffered), v.avgPromptTokens.toLocaleString(), `${v.avgMs.toLocaleString()} ms`));
}
md.push('');
md.push('### When it is not sure');
md.push(row('Confidence needed (top score)', 'Tasks answered', 'Complete when answered'));
md.push(row('---', '---:', '---:'));
for (const s of R.confidence.sweep) md.push(row(`>= ${s.threshold}`, `${s.coveragePct}%`, s.completeWhenConfident === null ? '-' : `${s.completeWhenConfident}%`));
md.push('');
md.push(`In the agent an unsure pull falls back to the default tool set: ${R.confidence.withFallback.complete}% complete with the fallback, at ${R.confidence.withFallback.avgSchemaChars.toLocaleString()} schema characters per call on average.`);
md.push('');
md.push('### A tool the graph has never seen');
md.push(`${R.drift.newTools} tools added at run time with no rebuild, tested on wording that never appeared in training: ${R.drift.heldOutCompletePct.onlyDescription}% found from the description alone, ${R.drift.heldOutCompletePct.afterOneExample}% after one example, ${R.drift.heldOutCompletePct.afterTwoExamples}% after two.`);
if (R.scale?.length) {
  md.push('');
  md.push('### Catalog size and load (cold graph, one HydraDB node)');
  md.push(row('Catalog', 'Graph', 'Keyword search', 'HydraDB requests per pull', '1 client', '8 clients', '32 clients'));
  md.push(row('---', '---:', '---:', '---:', '---:', '---:', '---:'));
  for (const s of R.scale) md.push(row(`${s.catalogTools.toLocaleString()} tools`, `${s.graphCompleteCold}%`, `${s.bm25Complete}%`, String(s.graphAvgRequests), ...s.load.map(l => `${l.perSec}/s, p95 ${l.p95ms} ms`)));
  md.push('');
  md.push('Pulls per second and 95th-percentile latency of a complete retrieval. Tools beyond the first 264 are synthetic distractors built from the same vocabulary, so accuracy at larger sizes shows how well each method ignores noise.');
}

const tpl = fs.readFileSync(new URL('README.template.md', dir), 'utf8');
const out = tpl
  .replaceAll('{{TOOLS}}', String(c.catalogTools))
  .replaceAll('{{MODELLED}}', String(c.catalogTools - c.realMimirTools))
  .replaceAll('{{PRELOAD_TOKENS}}', (R.llm?.methods?.['All tools preloaded']?.avgPromptTokens ?? Math.round(c.allToolsSchemaChars / 4)).toLocaleString())
  .replaceAll('{{BM25S}}', String(bl.bm25ToolsAndSkills.complete))
  .replaceAll('{{FLAT}}', String(R.flatLearner ? Math.max(...R.flatLearner.rows.slice(1).map(x => x.complete)) : '?'))
  .replaceAll('{{UNSEEN}}', String(R.unseenJobs?.rows.find(x => x.label === 'Graph, after learning')?.complete ?? '?') + '%')
  .replaceAll('{{LIVE}}', LIVE)
  .replaceAll('{{VIDEO}}', VIDEO)
  .replace('{{RESULTS}}', md.join('\n'));
fs.writeFileSync(new URL('README.md', dir), out);
console.log('README.md written,', out.length, 'chars');
