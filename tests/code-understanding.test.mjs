import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepositoryKnowledgeGraph, findGraphNeighborhood } from '../daemon/code-understanding.mjs';

const withRepo = fn => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-codegraph-'));
  try { return fn(root); } finally { fs.rmSync(root, { force: true, recursive: true }); }
};
const write = (root, name, content) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

test('deterministic code graph resolves imports, symbols, folders and excludes secrets', () => withRepo(root => {
  write(root, 'src/index.js', "import { answer } from './math.js';\nexport function start() { return answer(); }\n");
  write(root, 'src/math.js', "export function answer() { return 42; }\n");
  write(root, 'src/Widget.jsx', "export class Widget {}\n");
  write(root, '.env', 'SECRET_SHOULD_NOT_BE_INDEXED=true');
  write(root, 'node_modules/loud/index.js', "export function ignored() {}\n");
  const graph = buildRepositoryKnowledgeGraph({ root });
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.ok(ids.has('project:root'));
  assert.ok(ids.has('folder:src'));
  assert.ok(ids.has('file:src/index.js'));
  assert.ok(ids.has('file:src/math.js'));
  assert.ok(ids.has('symbol:src/math.js:1:answer'));
  assert.ok(graph.edges.some(e => e.from === 'file:src/index.js' && e.to === 'file:src/math.js' && e.relation === 'imports'));
  assert.equal(graph.nodes.some(n => String(n.path).includes('node_modules') || String(n.path).includes('.env')), false);
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), 'edge source is a valid node');
    assert.ok(ids.has(edge.to), 'edge target is a valid node');
  }
  const graph2 = buildRepositoryKnowledgeGraph({ root });
  assert.deepEqual(graph.nodes, graph2.nodes, 'scanner output is deterministic for unchanged input');
  assert.deepEqual(graph.edges, graph2.edges);
  const nearby = findGraphNeighborhood(graph, 'answer');
  assert.ok(nearby.some(n => n.id === 'file:src/math.js'));
}));

test('prefers valid official Understand Anything graph and drops dangling relationships', () => withRepo(root => {
  write(root, 'src/index.js', 'function localOnly() {}');
  write(root, '.ua/knowledge-graph.json', JSON.stringify({
    nodes: [
      { id: 'a', type: 'file', name: 'src/index.js', filePath: 'src/index.js', summary: 'Entry point' },
      { id: 'b', type: 'function', name: 'start' }
    ],
    edges: [
      { source: 'a', target: 'b', type: 'defines' },
      { source: 'a', target: 'does-not-exist', type: 'dangling' }
    ]
  }));
  const graph = buildRepositoryKnowledgeGraph({ root });
  assert.equal(graph.source, 'understand-anything');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, 'defines');
  const fallback = buildRepositoryKnowledgeGraph({ root, preferOfficial: false });
  assert.equal(fallback.source, 'mimir-static-scanner');
}));

test('invalid official output falls back to local static scanner safely', () => withRepo(root => {
  write(root, 'src/index.ts', 'export const run = () => 1;');
  write(root, '.ua/knowledge-graph.json', '{invalid json');
  const graph = buildRepositoryKnowledgeGraph({ root });
  assert.equal(graph.source, 'mimir-static-scanner');
  assert.ok(graph.nodes.some(n => n.type === 'Function' && n.label === 'run'));
}));
