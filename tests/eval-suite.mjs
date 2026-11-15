import fs from 'node:fs';
import path from 'node:path';
import { runEvalSuite } from '../daemon/eval-runner.mjs';

const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const r1 = await runEvalSuite({
  ollamaUrl,
  models: ['qwen3:1.7b'],
  modes: ['baseline', 'harnessed', 'council'],
  candidates: 3,
  maxRefine: 2,
});
const r4 = await runEvalSuite({
  ollamaUrl,
  models: ['qwen3.5:4b'],
  modes: ['baseline', 'harnessed'],
  candidates: 2,
  maxRefine: 1,
});
const r9 = await runEvalSuite({
  ollamaUrl,
  models: ['qwen3.5:9b'],
  modes: ['baseline'],
});

const report = {
  ok: true,
  modes: ['baseline', 'harnessed', 'council'],
  taskIds: r1.taskIds,
  installedModels: r1.installedModels,
  benchmarked: [...r1.benchmarked, ...r4.benchmarked, ...r9.benchmarked],
  harnessed: [...(r1.harnessed || []), ...(r4.harnessed || [])],
  council: [...(r1.council || [])],
  comparison: [...r1.comparison, ...r4.comparison, ...r9.comparison],
  disclaimer: r1.disclaimer,
  measuredAt: new Date().toISOString(),
};

const outDir = path.resolve('docs');
fs.mkdirSync(outDir, { recursive: true });
const evalOutPath = path.join(outDir, 'eval-results.json');
const pubEvalPath = path.resolve('public', 'eval-results.json');
for (const prevPath of [evalOutPath, pubEvalPath]) {
  if (fs.existsSync(prevPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      if (!report.ablationLadder && prev.ablationLadder) report.ablationLadder = prev.ablationLadder;
      if (!report.multiUserLoadBenchmark && prev.multiUserLoadBenchmark) report.multiUserLoadBenchmark = prev.multiUserLoadBenchmark;
    } catch {}
  }
}
const payload = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(evalOutPath, payload, 'utf8');
if (fs.existsSync(path.dirname(pubEvalPath))) fs.writeFileSync(pubEvalPath, payload, 'utf8');
console.log(JSON.stringify(report, null, 2));
