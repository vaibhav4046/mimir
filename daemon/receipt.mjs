import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Run receipts: a record of what a turn actually did, built from tool results on disk and in
 * the thread, never from the model's own words. The model's final answer is then checked
 * against that record, and any action it says it took without evidence is flagged.
 *
 * Deterministic on purpose. A small local model will sometimes say "I've saved the file" when
 * nothing was written; a second model asked to judge that could be wrong the same way.
 */

const SEARCH_TOOLS = ['browser_search', 'browser_open', 'browser_screenshot', 'knowledge_search', 'knowledge_ingest', 'fs_list', 'fs_read', 'memory_read'];

/** What each kind of claim needs to have happened. `tools` entries are matched as name prefixes. */
const EVIDENCE = {
  file: { label: 'a file being written', tools: ['fs_write', 'foundry_create', 'artifact', 'foundry'] },
  send: { label: 'a message being sent', tools: [], mcp: /(send|post|reply|publish|submit|message|email)/i },
  search: { label: 'a search or page visit', tools: SEARCH_TOOLS },
  memory: { label: 'something saved to memory', tools: ['memory_save'] },
  run: { label: 'a command being run', tools: ['shell_exec'] },
  download: { label: 'a download', tools: [] },
  upload: { label: 'an upload', tools: [] },
  schedule: { label: 'a schedule being created', tools: [] },
  delegate: { label: 'a teammate being run', tools: ['subagent_loop', 'bot_spawn'] },
};

const OBJ = String.raw`(?:(?:the|a|an|your|this|that|it|them|these|those|new|my|our)\s+)?(?:[\w'-]+\s+){0,3}?`;
const CLAIM_PATTERNS = [
  { kind: 'file', re: new RegExp(String.raw`\b(saved|wrote|written|created|generated|updated|deleted|exported)\s+${OBJ}(file|files|document|report|pdf|spreadsheet|folder|csv|docx|pptx|xlsx|zip|artifact)\b`, 'i') },
  { kind: 'file', re: /\b(saved|wrote|written|exported)\b[^.!?\n]{0,60}?\b(?:to|as|in|into)\s+[`'"]?[\w./\\-]+\.[a-z0-9]{1,5}\b/i },
  { kind: 'send', re: /\b(sent|emailed|messaged|texted|posted|published|submitted|replied to|forwarded)\b/i },
  { kind: 'search', re: new RegExp(String.raw`\b(searched|looked up|browsed|googled|visited|opened|checked)\s+${OBJ}(web|internet|site|website|page|pages|url|link|online|results|sources|workspace|directory|folder|files)\b`, 'i') },
  { kind: 'search', re: /\b(searched (?:for|the)|looked (?:it|this|that) up|did a search)\b/i },
  { kind: 'memory', re: /\b(remembered|memorized|made a note|noted (?:this|that|it) down|saved (?:this|that|it) to (?:my )?memory|stored (?:this|that|it) in (?:my )?memory)\b/i },
  { kind: 'run', re: new RegExp(String.raw`\b(ran|run|executed|installed|deployed|compiled|built)\s+${OBJ}(command|commands|script|scripts|test|tests|build|code|program|package|packages|app|server)\b`, 'i') },
  { kind: 'download', re: /\b(downloaded)\b/i },
  { kind: 'upload', re: /\b(uploaded)\b/i },
  { kind: 'schedule', re: /\b(scheduled|set up (?:a|the|your) (?:routine|reminder|schedule|recurring))\b/i },
];
// Only statements about the assistant's own completed actions count as claims.
const FIRST_PERSON_DONE = /\b(?:i|we)(?:['’]ve| have| just| already| successfully| also|\s)+\s*$|\b(?:has|have) been\s*$|\b(?:is|was|are|were) now\s*$/i;
const NOT_A_CLAIM = /\b(?:can|could|will|would|should|shall|may|might|let me|going to|want me to|if you|once|after|before|to)\s*$|\b(?:not|never|n['’]t|unable to|couldn['’]t|cannot|failed to)\s+(?:\w+\s+){0,2}$/i;

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function summarizeArgs(toolName, args = {}) {
  if (toolName === 'fs_write' || toolName === 'fs_read' || toolName === 'fs_list') return String(args.path || '.');
  if (toolName === 'shell_exec') return String(args.command || '').slice(0, 100);
  if (toolName === 'browser_open') return String(args.url || '').slice(0, 100);
  if (toolName === 'browser_search' || toolName === 'knowledge_search') return String(args.query || '').slice(0, 100);
  if (toolName === 'browser_action') return `${args.action || 'action'}${args.selector ? ` ${String(args.selector).slice(0, 60)}` : ''}`;
  if (toolName === 'memory_save') return String(args.key || '');
  if (toolName === 'subagent_loop') return String(args.role || args.botId || '').slice(0, 60);
  return JSON.stringify(args).slice(0, 100);
}

/** One entry per tool result of this turn: what was asked, and whether it really happened. */
function collectActions(turnMessages, workspace, actor) {
  const actions = [];
  for (const m of turnMessages) {
    if (m.role !== 'tool') continue;
    const output = String(m.content || '');
    const status = m.approved === false ? 'denied' : output.startsWith('ERROR:') ? 'failed' : 'done';
    const action = { by: actor, tool: m.toolName, target: summarizeArgs(m.toolName, m.toolArgs), status };
    if (status === 'failed') action.error = output.slice(7, 160);
    if (m.toolName === 'fs_write' && status === 'done' && workspace) {
      // Trust the disk, not the tool's reply: the file must exist inside the sandbox right now.
      const abs = path.resolve(workspace, String(m.toolArgs?.path || ''));
      const inside = abs.startsWith(path.resolve(workspace) + path.sep);
      if (inside && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        action.file = { path: String(m.toolArgs.path), bytes: fs.statSync(abs).size, sha256: sha256Of(abs).slice(0, 16) };
      } else {
        action.status = 'failed';
        action.error = 'Tool reported success but the file is not on disk';
      }
    }
    if (m.toolName === 'foundry_create' && status === 'done') {
      try {
        const parsed = JSON.parse(String(m.content || '{}'));
        const fpath = parsed?.artifact?.file_path;
        if (fpath && fs.existsSync(fpath) && fs.statSync(fpath).isFile()) {
          action.file = { path: path.basename(fpath), bytes: fs.statSync(fpath).size, sha256: sha256Of(fpath).slice(0, 16) };
        }
      } catch {
        // Ignore unparseable foundry output; non-error tool call remains recorded.
      }
    }
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed.downloaded) && parsed.downloaded.length) action.downloaded = parsed.downloaded.map(d => d.path);
      if (parsed.uploaded) action.uploaded = parsed.uploaded;
      if (parsed.url) action.url = String(parsed.url).slice(0, 300);
      if (Array.isArray(parsed.results)) {
        action.sourceCount = parsed.results.length;
        action.sources = parsed.results.slice(0, 5).map(r => ({
          title: String(r?.title || r?.url || 'Source').slice(0, 120),
          url: String(r?.url || '').slice(0, 300),
        }));
      }
    } catch {
      // Not every tool returns JSON.
    }
    actions.push(action);
  }
  return actions;
}

export function computeReceiptEventHash(receipt, prevHash = '0'.repeat(64)) {
  const payload = {
    prevHash: String(prevHash || '0'.repeat(64)),
    id: receipt.id || null,
    runId: receipt.runId || null,
    threadId: receipt.threadId || null,
    userId: receipt.userId || 'local-owner',
    botId: receipt.botId || null,
    verdict: receipt.verdict || 'verified',
    actions: receipt.actions || [],
    files: receipt.files || [],
    sources: receipt.sources || [],
    citations: receipt.citations || [],
    tests: receipt.tests || [],
    delegated: receipt.delegated || [],
    unbackedClaims: receipt.unbackedClaims || [],
    retries: Number(receipt.retries || 0),
    model: receipt.model || null,
    createdAt: receipt.createdAt || null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function finalizeReceiptHashChain(receipt, prevHash = '0'.repeat(64)) {
  const cleanPrev = String(prevHash || '0'.repeat(64));
  const next = { ...receipt, prevHash: cleanPrev };
  next.eventHash = computeReceiptEventHash(next, cleanPrev);
  return next;
}

export function verifyReceiptChain(receipts = []) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return { valid: true, count: 0, brokenIndex: null };
  }
  let expectedPrev = '0'.repeat(64);
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (!r || String(r.prevHash || '') !== expectedPrev) {
      return { valid: false, count: receipts.length, brokenIndex: i, reason: 'prevHash mismatch' };
    }
    const recomputed = computeReceiptEventHash(r, expectedPrev);
    if (String(r.eventHash || '') !== recomputed) {
      return { valid: false, count: receipts.length, brokenIndex: i, reason: 'eventHash mismatch' };
    }
    expectedPrev = r.eventHash;
  }
  return { valid: true, count: receipts.length, brokenIndex: null };
}

function hasEvidence(kind, { actions, delegated, rememberedFacts }) {
  const done = actions.filter(a => a.status === 'done');
  if (kind === 'download') return done.some(a => a.downloaded?.length);
  if (kind === 'upload') return done.some(a => a.uploaded);
  if (kind === 'memory' && rememberedFacts.length) return true;
  if (kind === 'delegate' && delegated.some(d => d.status === 'done')) return true;
  const spec = EVIDENCE[kind];
  return done.some(a => spec.tools.some(t => a.tool === t || a.tool.startsWith(`${t}_`)) || (spec.mcp && a.tool.startsWith('mcp__') && spec.mcp.test(a.tool)));
}

/**
 * Find sentences where the assistant says it did something, and return those with no matching
 * evidence. Quoted text and code are ignored so that reporting what a document says is not a claim.
 */
export function findUnbackedClaims(reply, evidence) {
  const text = String(reply || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' `code` ')
    .replace(/"[^"\n]{0,200}"|“[^”\n]{0,200}”/g, ' "quote" ');
  const flagged = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (s.length < 6 || s.endsWith('?')) continue;
    const matches = CLAIM_PATTERNS.map(({ kind, re }) => ({ kind, match: re.exec(s) }))
      .filter(x => x.match)
      .sort((a, b) => a.match.index - b.match.index);
    let subjectIsAssistant = false; // "I saved X and sent Y": the second verb shares the subject
    for (const { kind, match } of matches) {
      const before = s.slice(0, match.index);
      const direct = FIRST_PERSON_DONE.test(before) && !NOT_A_CLAIM.test(before);
      const continued = subjectIsAssistant && /(?:\band\b|\bthen\b|,)\s*(?:also\s+|then\s+)?$/i.test(before);
      if (!direct && !continued) continue;
      subjectIsAssistant = true;
      if (hasEvidence(kind, evidence)) continue;
      if (!flagged.some(f => f.kind === kind)) flagged.push({ kind, claim: s.slice(0, 180), missing: EVIDENCE[kind].label });
    }
  }
  return flagged;
}

/**
 * Build the receipt for one finished turn.
 * `groups` is one entry per bot that worked on it: { actor, messages, workspace }, so a teammate's
 * actions in its own sandbox count as evidence for what the team says it did.
 */
export function buildReceipt({
  id = null,
  runId = null,
  threadId = null,
  botId = null,
  userId = 'local-owner',
  prevHash = '0'.repeat(64),
  groups = [],
  reply,
  delegated = [],
  rememberedFacts = [],
  citations = [],
  tests = [],
  retries = 0,
  provider,
  model,
  baseUrl,
  isLocal,
  startedAt,
}) {
  const actions = groups.flatMap(g => collectActions(g.messages, g.workspace, g.actor));
  const evidence = { actions, delegated, rememberedFacts };
  const unbackedClaims = findUnbackedClaims(reply, evidence);
  const count = status => actions.filter(a => a.status === status).length;
  const parts = [];
  if (count('done')) parts.push(`${count('done')} action${count('done') === 1 ? '' : 's'} verified`);
  if (delegated.length) parts.push(`${delegated.filter(d => d.status === 'done').length}/${delegated.length} teammate run${delegated.length === 1 ? '' : 's'} finished`);
  if (rememberedFacts.length) parts.push('saved to shared memory');
  if (count('failed')) parts.push(`${count('failed')} failed`);
  if (count('denied')) parts.push(`${count('denied')} not approved`);
  if (!parts.length) parts.push('Answered from the model only, no actions taken');
  if (unbackedClaims.length) parts.push(`${unbackedClaims.length} claim${unbackedClaims.length === 1 ? '' : 's'} not backed by any action`);

  const sources = [];
  const seenUrls = new Set();
  for (const a of actions) {
    if (a.url && !seenUrls.has(a.url)) {
      seenUrls.add(a.url);
      sources.push({ title: a.target || a.url, url: a.url });
    }
    for (const s of a.sources || []) {
      if (s.url && !seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        sources.push(s);
      }
    }
  }

  let endpointHost = null;
  if (baseUrl) {
    try {
      endpointHost = new URL(baseUrl).host;
    } catch {
      endpointHost = String(baseUrl).slice(0, 80);
    }
  }

  const baseReceipt = {
    id: id || `rcpt-${crypto.randomBytes(6).toString('hex')}`,
    runId: runId || threadId || null,
    threadId: threadId || null,
    botId: botId || null,
    userId: userId || 'local-owner',
    verdict: unbackedClaims.length ? 'unverified-claims' : count('failed') ? 'had-failures' : 'verified',
    summary: parts.join(' · '),
    actions,
    files: actions.filter(a => a.file).map(a => a.file),
    sources,
    citations: Array.isArray(citations) ? citations : [],
    tests: Array.isArray(tests) ? tests : [],
    retries: Number(retries || 0),
    delegated: delegated.map(d => ({ name: d.name, status: d.status })),
    remembered: rememberedFacts.map(f => f.value),
    unbackedClaims,
    model: { provider, name: model, leftThisComputer: !isLocal, endpoint: endpointHost },
    durationMs: startedAt ? Date.now() - Date.parse(startedAt) : null,
    createdAt: new Date().toISOString(),
  };
  return finalizeReceiptHashChain(baseReceipt, prevHash);
}
