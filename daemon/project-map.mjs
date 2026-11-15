import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_REPO = path.resolve(__dirname, '..');

export const NINE_REALMS = Object.freeze([
  { id: 'midgard', name: 'Midgard', x: 500, y: 380, role: 'Lake of Nine Hub & Primary Repo', radius: 95, tone: '#6e95b5' },
  { id: 'asgard', name: 'Asgard', x: 500, y: 120, role: 'Rust Core Security & Auth Vault', radius: 54, tone: '#e6ab42' },
  { id: 'alfheim', name: 'Alfheim', x: 780, y: 205, role: 'Model Router & Voice Synthesis', radius: 54, tone: '#92e1ff' },
  { id: 'vanaheim', name: 'Vanaheim', x: 830, y: 465, role: '2026 Knowledge & Chronicle History', radius: 54, tone: '#44c27f' },
  { id: 'jotunheim', name: 'Jötunheim', x: 200, y: 185, role: 'Elephant Architect Long-Horizon Specs', radius: 54, tone: '#d48b38' },
  { id: 'svartalfheim', name: 'Svartalfheim', x: 185, y: 475, role: 'Dwarven Forge & Artifact Foundry', radius: 54, tone: '#c87f2b' },
  { id: 'muspelheim', name: 'Muspelheim', x: 720, y: 635, role: 'Quantitative Evals & Chaos Stress', radius: 54, tone: '#f06438' },
  { id: 'niflheim', name: 'Niflheim', x: 295, y: 635, role: 'Goldfish Zero-Context Adversarial Mist', radius: 54, tone: '#58b4d1' },
  { id: 'helheim', name: 'Helheim', x: 500, y: 675, role: 'Dead-Letter Queue & Crash Recovery', radius: 52, tone: '#38c8a2' },
]);

async function safeGitInfo(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return { isGit: false, branch: null, worktrees: [], recentCommits: [] };
  }
  try {
    const [{ stdout: brOut }, { stdout: wtOut }, { stdout: logOut }] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: repoDir, timeout: 3000 }),
      execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir, timeout: 3000 }),
      execFileAsync('git', ['log', '-n', '5', '--oneline'], { cwd: repoDir, timeout: 3000 }),
    ]);
    const worktrees = wtOut
      .split(/\r?\n/)
      .filter(l => l.startsWith('worktree '))
      .map(l => l.slice('worktree '.length).trim());
    const recentCommits = logOut
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    return {
      isGit: true,
      branch: brOut.trim() || 'HEAD',
      worktrees,
      recentCommits,
    };
  } catch {
    return { isGit: false, branch: null, worktrees: [], recentCommits: [] };
  }
}

export async function buildMidgardProjectMap({ store, foundry }) {
  const gitRoot = await safeGitInfo(ROOT_REPO);
  const bots = store.listBots();
  const threads = store.listThreads().slice(0, 18);
  const artifacts = await foundry.listArtifacts().catch(() => []);

  const nodes = [];
  // Central Midgard Repo Node
  nodes.push({
    id: 'repo-main',
    realmId: 'midgard',
    type: 'project',
    label: `mimir-os (${gitRoot.branch || 'workspace'})`,
    subtitle: `${gitRoot.worktrees.length || 1} worktree · ${gitRoot.recentCommits[0] || 'local workspace'}`,
    x: 500,
    y: 380,
    pinTone: '#3ac9ff',
    navTab: 'chat',
    meta: gitRoot,
  });

  // Worktrees
  gitRoot.worktrees.forEach((wt, idx) => {
    if (idx === 0) return;
    nodes.push({
      id: `wt-${idx}`,
      realmId: 'midgard',
      type: 'worktree',
      label: path.basename(wt),
      subtitle: wt,
      x: 420 + idx * 75,
      y: 330,
      pinTone: '#e6ab42',
      navTab: 'agents',
    });
  });

  // Bots mapped to functional Norse Realms
  const botCoords = [
    { x: 500, y: 120, realmId: 'asgard', pinTone: '#e6ab42' },
    { x: 185, y: 475, realmId: 'svartalfheim', pinTone: '#d48b38' },
    { x: 780, y: 205, realmId: 'alfheim', pinTone: '#3ac9ff' },
    { x: 200, y: 185, realmId: 'jotunheim', pinTone: '#e6ab42' },
    { x: 830, y: 465, realmId: 'vanaheim', pinTone: '#44c27f' },
  ];
  bots.slice(0, 8).forEach((b, i) => {
    const slot = botCoords[i % botCoords.length];
    const spread = Math.floor(i / botCoords.length) * 38;
    nodes.push({
      id: b.id,
      realmId: slot.realmId,
      type: 'bot',
      label: b.name,
      subtitle: b.role,
      x: slot.x + spread,
      y: slot.y + spread * 0.6,
      pinTone: b.color || slot.pinTone,
      navTab: 'agents',
      botId: b.id,
    });
  });

  // Recent Chronicle threads around Vanaheim/Midgard shores
  threads.slice(0, 8).forEach((th, i) => {
    const angle = (i / Math.max(1, Math.min(threads.length, 8))) * Math.PI * 2 + 0.35;
    nodes.push({
      id: `thr-${th.id}`,
      realmId: i % 2 === 0 ? 'vanaheim' : 'midgard',
      type: 'thread',
      label: th.title || 'Chronicle',
      subtitle: `${th.messageCount || 0} msgs`,
      x: Math.round(500 + Math.cos(angle) * 205),
      y: Math.round(380 + Math.sin(angle) * 155),
      pinTone: '#6e95b5',
      navTab: 'chat',
      threadId: th.id,
      botId: th.botId,
    });
  });

  // Artifacts in Svartalfheim
  artifacts.slice(0, 5).forEach((art, i) => {
    nodes.push({
      id: `art-${art.id}`,
      realmId: 'svartalfheim',
      type: 'artifact',
      label: art.title,
      subtitle: `${String(art.format || '').toUpperCase()} · ${art.folder}`,
      x: 115 + (i % 2) * 115,
      y: 530 + Math.floor(i / 2) * 42,
      pinTone: '#c87f2b',
      navTab: 'library',
      artifactId: art.id,
    });
  });

  const edges = nodes
    .filter(n => n.id !== 'repo-main')
    .slice(0, 18)
    .map(n => ({ from: 'repo-main', to: n.id }));

  return {
    attribution: 'Original Lake-of-Nine Mimir project topology inspired by Norse realms (non-franchise schematic coordinates).',
    repo: { path: ROOT_REPO, ...gitRoot },
    realms: NINE_REALMS,
    nodes,
    edges,
  };
}

/**
 * Yggdrasil Memory Atlas (Phase G):
 * Unified graph/list/timeline view over User, Project, File, Task, Bot, Conversation, Decision,
 * Source, Evidence, Skill, Artifact, and Timeline event entities with strict user isolation,
 * provenance, verification status, staleness detection, and tombstone exclusion.
 */
export async function buildMemoryAtlas({
  store,
  foundry = null,
  ragEngine = null,
  userId = 'local-owner',
  query = '',
  typeFilter = 'all',
  includeStale = true,
} = {}) {
  const scope = String(userId || 'local-owner');
  const q = String(query || '').trim().toLowerCase();
  const staleCutoffMs = 30 * 86_400_000;
  const nowMs = Date.now();
  const nodes = [];
  const edges = [];

  const addNode = n => {
    const updatedMs = Date.parse(n.updatedAt || n.createdAt || '') || nowMs;
    const stale = Boolean(n.stale ?? (nowMs - updatedMs > staleCutoffMs));
    if (!includeStale && stale) return;
    if (typeFilter !== 'all' && n.type !== typeFilter) return;
    if (q) {
      const hay = `${n.label} ${n.subtitle || ''} ${n.value || ''} ${n.provenance || ''} ${n.type}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    nodes.push({ ...n, userId: scope, stale });
  };

  // User root node
  addNode({
    id: `user-${scope}`,
    type: 'User',
    realmId: 'midgard',
    label: scope === 'local-owner' ? 'Local Operator' : scope,
    subtitle: `Tenant scope: ${scope}`,
    provenance: 'auth-session',
    confidence: 1,
    verified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Project node
  addNode({
    id: 'project-mimir',
    type: 'Project',
    realmId: 'midgard',
    label: 'Mimir OS Workspace',
    subtitle: ROOT_REPO,
    provenance: 'workspace',
    confidence: 1,
    verified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  edges.push({ from: `user-${scope}`, to: 'project-mimir', relation: 'owns' });

  // Bots
  for (const b of store?.listBots?.() || []) {
    addNode({
      id: `bot-${b.id}`,
      type: 'Bot',
      realmId: b.specialistTag === 'research' ? 'vanaheim' : 'asgard',
      label: b.name,
      subtitle: b.role,
      provenance: 'agent-registry',
      confidence: 1,
      verified: true,
      openTarget: { tab: 'agents', botId: b.id },
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    });
    edges.push({ from: 'project-mimir', to: `bot-${b.id}`, relation: 'hosts' });

    // Scoped Memories & Decisions
    for (const m of store.getMemories(b.id, scope)) {
      const memNodeId = m.id || `mem-${b.id}-${m.key}`;
      const isDecision = /decision|policy|rule|preference/i.test(`${m.key} ${m.value}`);
      addNode({
        id: memNodeId,
        rawId: m.id,
        botId: b.id,
        memoryKey: m.key,
        type: isDecision ? 'Decision' : 'Memory',
        realmId: 'helheim',
        label: m.key,
        subtitle: String(m.value || '').slice(0, 140),
        value: m.value,
        provenance: m.provenance || 'user-memory',
        confidence: m.confidence ?? 0.9,
        verified: m.verified !== false,
        deletable: true,
        createdAt: m.createdAt || m.updatedAt,
        updatedAt: m.updatedAt,
      });
      edges.push({ from: `bot-${b.id}`, to: memNodeId, relation: 'remembers' });
    }

    // Skill files
    for (const sk of store.listSkillFiles?.(b.id) || []) {
      addNode({
        id: `skill-${b.id}-${sk.slug}`,
        type: 'Skill',
        realmId: 'svartalfheim',
        label: sk.title,
        subtitle: sk.logicalPath,
        provenance: sk.path,
        confidence: 0.95,
        verified: true,
        createdAt: sk.updatedAt,
        updatedAt: sk.updatedAt,
      });
      edges.push({ from: `bot-${b.id}`, to: `skill-${b.id}-${sk.slug}`, relation: 'uses-skill' });
    }
  }

  // Scoped Conversations
  for (const th of (store?.listThreads?.(null, scope) || []).slice(0, 12)) {
    addNode({
      id: `conv-${th.id}`,
      type: 'Conversation',
      realmId: 'vanaheim',
      label: th.title || 'Conversation',
      subtitle: `${(th.messages || []).length} msgs`,
      provenance: `thread:${th.id}`,
      confidence: 1,
      verified: true,
      createdAt: th.createdAt,
      updatedAt: th.updatedAt,
    });
    edges.push({ from: `user-${scope}`, to: `conv-${th.id}`, relation: 'participates' });
  }

  // Scoped Tasks / Runs
  for (const run of (store?.listRuns?.({ userId: scope, limit: 15 }) || [])) {
    addNode({
      id: `task-${run.id}`,
      type: 'Task',
      realmId: 'muspelheim',
      label: run.goal ? run.goal.slice(0, 64) : run.id,
      subtitle: `${run.status} · ${run.botId}`,
      provenance: `run:${run.id}`,
      confidence: run.status === 'COMPLETED' ? 1 : 0.7,
      verified: run.status === 'COMPLETED',
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
    edges.push({ from: `user-${scope}`, to: `task-${run.id}`, relation: 'scheduled' });
  }

  // Scoped Research Sources & Evidence Spans
  for (const rr of (store?.state?.researchRuns || []).filter(r => (r.userId || 'local-owner') === scope).slice(0, 6)) {
    for (const sp of rr.evidenceSpans || []) {
      const srcId = `src-${rr.id}-${sp.sourceId}`;
      addNode({
        id: srcId,
        type: 'Source',
        realmId: 'vanaheim',
        label: `[${sp.sourceId}] ${sp.title}`,
        subtitle: sp.urlOrPath,
        provenance: sp.urlOrPath,
        confidence: sp.quality?.overallScore ?? 0.85,
        verified: true,
        createdAt: sp.retrievedAt,
        updatedAt: sp.retrievedAt,
      });
      const evId = `ev-${rr.id}-${sp.sourceId}`;
      addNode({
        id: evId,
        type: 'Evidence',
        realmId: 'jotunheim',
        label: `${rr.query.slice(0, 40)} · [${sp.sourceId}]`,
        subtitle: sp.quote.slice(0, 140),
        provenance: `sha256:${sp.sha256.slice(0, 12)}`,
        confidence: sp.quality?.overallScore ?? 0.85,
        verified: true,
        createdAt: sp.retrievedAt,
        updatedAt: sp.retrievedAt,
      });
      edges.push({ from: srcId, to: evId, relation: 'supports' });
    }
  }

  // Artifacts & Files
  const artifacts = foundry ? await foundry.listArtifacts().catch(() => []) : [];
  for (const art of artifacts.slice(0, 10)) {
    addNode({
      id: `artifact-${art.id}`,
      type: 'Artifact',
      realmId: 'svartalfheim',
      label: art.title || art.id,
      subtitle: `${String(art.format || '').toUpperCase()} · ${art.file_path || ''}`,
      provenance: art.file_path || `artifact:${art.id}`,
      confidence: 1,
      verified: Boolean(art.validated ?? true),
      openTarget: { tab: 'studio', artifactId: art.id },
      createdAt: art.createdAt || new Date().toISOString(),
      updatedAt: art.updatedAt || art.createdAt || new Date().toISOString(),
    });
    edges.push({ from: 'project-mimir', to: `artifact-${art.id}`, relation: 'produced' });
  }

  // Workspace Core Files (indexed as typed File nodes)
  const coreFiles = [
    'daemon/coordinator.mjs',
    'daemon/contracts.mjs',
    'daemon/sentinel.mjs',
    'daemon/norse-agents.mjs',
    'daemon/intelligent-ui.mjs',
    'daemon/agent-runner.mjs',
    'daemon/foundry.mjs',
    'scripts/creative_studio_builder.py',
    'renderer/App.jsx',
    'renderer/components/ChatView.jsx',
    'renderer/components/MimirAvatarSvg.jsx',
  ];
  for (const relPath of coreFiles) {
    const absPath = path.join(ROOT_REPO, relPath);
    if (!fs.existsSync(absPath)) continue;
    const st = fs.statSync(absPath);
    const iso = new Date(st.mtimeMs).toISOString();
    addNode({
      id: `file-${relPath.replace(/[^a-z0-9]+/gi, '-')}`,
      type: 'File',
      realmId: relPath.startsWith('daemon/') ? 'asgard' : relPath.startsWith('scripts/') ? 'svartalfheim' : 'midgard',
      label: relPath,
      subtitle: `${st.size} bytes`,
      provenance: absPath,
      confidence: 1,
      verified: true,
      openTarget: { tab: 'architecture', filePath: relPath },
      createdAt: iso,
      updatedAt: iso,
    });
    edges.push({ from: 'project-mimir', to: `file-${relPath.replace(/[^a-z0-9]+/gi, '-')}`, relation: 'contains' });
  }

  // Timeline events from scoped Receipts
  for (const rcpt of (store?.listReceipts?.({ userId: scope, limit: 15 }) || [])) {
    addNode({
      id: `evt-${rcpt.id}`,
      type: 'Timeline event',
      realmId: 'helheim',
      label: `${rcpt.verdict}: ${rcpt.summary}`,
      subtitle: `sha256:${String(rcpt.eventHash || '').slice(0, 12)}`,
      provenance: `receipt:${rcpt.id}`,
      confidence: rcpt.verdict === 'verified' ? 1 : 0.65,
      verified: rcpt.verdict === 'verified',
      createdAt: rcpt.createdAt,
      updatedAt: rcpt.createdAt,
    });
  }

  // Diagnostics: 11 supported entity types, counts, duplicate & contradiction detection, stale check
  const supportedNodeTypes = [
    'Project',
    'File',
    'Task',
    'Conversation',
    'Bot',
    'Memory',
    'Source',
    'Decision',
    'Skill',
    'Artifact',
    'Timeline event',
  ];
  const nodeCountsByType = {};
  const seenLabels = new Map();
  const duplicateNodes = [];
  const memoryValuesByKey = new Map();
  const contradictions = [];
  const staleMemories = [];

  for (const n of nodes) {
    nodeCountsByType[n.type] = (nodeCountsByType[n.type] || 0) + 1;
    const sig = `${String(n.type || '').toLowerCase()}::${String(n.label || '').trim().toLowerCase()}`;
    if (seenLabels.has(sig)) {
      duplicateNodes.push({ id: n.id, duplicateOf: seenLabels.get(sig), type: n.type, label: n.label });
    } else {
      seenLabels.set(sig, n.id);
    }
    if (n.stale) {
      staleMemories.push({ id: n.id, type: n.type, label: n.label });
    }
    if (n.type === 'Memory' || n.type === 'Decision') {
      const k = String(n.memoryKey || n.label || '').trim().toLowerCase();
      const v = String(n.value || n.subtitle || '').trim();
      if (k && memoryValuesByKey.has(k) && memoryValuesByKey.get(k).value !== v) {
        contradictions.push({ key: k, nodeIds: [memoryValuesByKey.get(k).id, n.id] });
      } else if (k) {
        memoryValuesByKey.set(k, { id: n.id, value: v });
      }
    }
  }

  return {
    userId: scope,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    tombstones: store?.listTombstones?.({ userId: scope }) || [],
    nodes,
    edges,
    diagnostics: {
      supportedNodeTypes,
      nodeCountsByType,
      duplicateNodes,
      staleMemories,
      contradictions,
    },
    ragSummary: ragEngine?.getGraphSummary?.() || null,
    generatedAt: new Date().toISOString(),
  };
}
