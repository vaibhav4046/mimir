import fs from 'node:fs';
import path from 'node:path';
import { buildRepositoryKnowledgeGraph } from '../daemon/code-understanding.mjs';

// Local, read-only source analysis. Writes only the generated JSON to .ua/.
const root = path.resolve(import.meta.dirname, '..');
const graph = buildRepositoryKnowledgeGraph({ root });
const directory = path.join(root, '.ua');
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, 'mimir-code-graph.json');
const temporary = destination + '.' + process.pid + '.tmp';
const payload = JSON.stringify({ ...graph, generatedAt: new Date().toISOString() }, null, 2) + '\n';
fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporary, destination);
console.log(JSON.stringify({
  output: destination,
  source: graph.source,
  nodes: graph.stats?.nodes,
  edges: graph.stats?.edges,
  files: graph.stats?.files
}, null, 2));
