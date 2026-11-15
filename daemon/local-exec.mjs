import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { fetchLiveSearch, fetchUrlText } from './knowledge-rsi.mjs';
import { isLoopbackUrl } from './llm-provider.mjs';
import { envVar } from './env.mjs';

const execAsync = promisify(exec);

export function resolveChromiumPath({ preferSystemBrowser = false } = {}) {
  const envChromium = envVar('CHROMIUM_PATH');
  if (envChromium && fs.existsSync(envChromium)) return envChromium;
  const systemBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  if (preferSystemBrowser) {
    const sys = systemBrowsers.find(p => fs.existsSync(p));
    if (sys) return sys;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const msPlaywright = path.join(localAppData, 'ms-playwright');
  if (fs.existsSync(msPlaywright)) {
    const dirs = fs.readdirSync(msPlaywright).sort().reverse();
    for (const d of dirs) {
      if (d.startsWith('chromium-')) {
        const candidates = [
          path.join(msPlaywright, d, 'chrome-win64', 'chrome.exe'),
          path.join(msPlaywright, d, 'chrome-linux', 'chrome'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) return c;
        }
      }
      if (d.startsWith('chromium_headless_shell-')) {
        const c = path.join(msPlaywright, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return systemBrowsers.find(p => fs.existsSync(p)) || null;
}

export function resolveSafePath(workspaceDir, relPath = '.') {
  const base = path.resolve(workspaceDir);
  const cleaned = String(relPath || '.').trim() || '.';
  if (path.isAbsolute(cleaned)) {
    throw new Error('Absolute paths outside workspace are not permitted');
  }
  const target = path.resolve(base, cleaned);
  const normBase = process.platform === 'win32' ? base.toLowerCase() : base;
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  if (normTarget !== normBase && !normTarget.startsWith(normBase + path.sep)) {
    throw new Error(`Path traversal blocked: ${relPath}`);
  }
  if (fs.existsSync(base)) {
    const realBase = fs.realpathSync(base);
    let probe = target;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      const cmpBase = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
      const cmpProbe = process.platform === 'win32' ? realProbe.toLowerCase() : realProbe;
      if (cmpProbe !== cmpBase && !cmpProbe.startsWith(cmpBase + path.sep)) {
        throw new Error(`Path symlink escape blocked: ${relPath}`);
      }
    }
  }
  return target;
}

export const MAX_SUBAGENT_DEPTH = 2;

export const REVERSIBILITY_MATRIX = Object.freeze({
  autonomousReversible: [
    { id: 'research', label: 'Web research & prospect scraping', risk: 'Low', rule: 'Execute Autonomously' },
    { id: 'draft', label: 'Drafting emails, docs & outreach copy', risk: 'Low (Saved locally)', rule: 'Execute Autonomously' },
    { id: 'svg', label: 'Generating pixel SVGs & UI assets', risk: 'Low (Reversible file)', rule: 'Execute Autonomously' },
    { id: 'organize', label: 'Organizing /workspace/{bin,config,skills,state}', risk: 'Low (Sandboxed)', rule: 'Execute Autonomously' },
    { id: 'verify', label: 'Running unit tests & read-only checks', risk: 'Low', rule: 'Execute Autonomously' },
  ],
  gatedIrreversible: [
    { id: 'outbound', label: 'Sending external emails, DMs, or social posts', risk: 'High (Public side-effect)', rule: 'Mandatory Human Approval' },
    { id: 'financial', label: 'Any financial transaction, billing, or spend', risk: 'Critical (Irreversible)', rule: 'Mandatory Human Approval' },
    { id: 'prod_write', label: 'Production DB writes, host deploys, or shell exec', risk: 'High (State/infra change)', rule: 'Mandatory Human Approval' },
    { id: 'security_auth', label: 'Modifying security settings, auth, or Vault secrets', risk: 'Critical (Privilege change)', rule: 'Mandatory Human Approval' },
    { id: 'spawn_escalate', label: 'Spawning autonomous sub-bots or uploading files', risk: 'High (Capability scope)', rule: 'Mandatory Human Approval' },
  ],
});

export function classifyReversibility(toolName, args = {}) {
  const name = String(toolName || '').trim();
  if (READ_ONLY_TOOLS.has(name) || name === 'subagent_loop' || name === 'memory_save') {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Safe', tier: name === 'subagent_loop' ? 'delegation' : 'read' };
  }
  if (name === 'browser_action' && ['snapshot', 'extract_structured', 'hover'].includes(String(args?.action || ''))) {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Read-only Snapshot', tier: 'read' };
  }
  if (name === 'browser_action' && ['scroll', 'back', 'forward'].includes(String(args?.action || ''))) {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Page Navigation', tier: 'read' };
  }
  if (name === 'fs_write') {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Sandboxed Draft', tier: 'write' };
  }
  if (name === 'foundry_create') {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Creative Studio Foundry', tier: 'write' };
  }
  if (name === 'knowledge_ingest') {
    return { reversibility: 'reversible', reversibilityLabel: 'Reversible · Local KB Index', tier: 'write' };
  }
  if (
    name === 'shell_exec' ||
    name === 'vault_use' ||
    name === 'bot_spawn' ||
    name === 'desktop_control' ||
    (name === 'browser_action' && ['upload', 'submit', 'click', 'double_click', 'fill_form', 'drag', 'draw'].includes(String(args?.action || ''))) ||
    (name.startsWith('mcp__') && /(send|post|reply|delete|remove|create|update|write|schedule|execute|commit|merge|pay|charge)/i.test(name))
  ) {
    return { reversibility: 'irreversible', reversibilityLabel: 'Irreversible · Needs Human OK', tier: 'high' };
  }
  return { reversibility: 'irreversible', reversibilityLabel: 'Approval Gated', tier: 'write' };
}

const READ_ONLY_TOOLS = new Set([
  'fs_list',
  'fs_read',
  'browser_open',
  'browser_search',
  'browser_screenshot',
  'memory_read',
  'knowledge_search',
  'council_convene',
]);

const CHAT_STRIPPED_TOOLS = new Set([
  'shell_exec',
  'fs_write',
  'browser_search',
  'browser_open',
  'browser_action',
  'browser_screenshot',
  'desktop_control',
  'vault_use',
  'memory_save',
  'knowledge_ingest',
  'bot_spawn',
  'subagent_loop',
]);

const CHAT_MUTATING_NAME_RE =
  /^(?:shell|browser|desktop|vault)|(?:_write|_save|_ingest|_spawn|_loop|_exec|_delete|_create|_update|_mutate)$|^mcp__.*(?:send|post|reply|delete|remove|create|update|write|schedule|execute|commit|merge)/i;

const CODE_MODE_PRIORITY = [
  'fs_read',
  'fs_write',
  'foundry_create',
  'fs_list',
  'shell_exec',
  'memory_read',
  'memory_save',
  'knowledge_search',
  'knowledge_ingest',
  'subagent_loop',
  'council_convene',
  'bot_spawn',
];

function getToolSchemaName(tool) {
  return String(tool?.function?.name || tool?.name || (typeof tool === 'string' ? tool : '')).trim();
}

export function filterToolsForExecutionMode(tools, mode = 'agent') {
  if (!Array.isArray(tools)) return [];
  const cleanMode = String(mode || 'agent').trim().toLowerCase();
  if (cleanMode === 'chat') {
    return tools.filter(tool => {
      const name = getToolSchemaName(tool);
      if (!name) return false;
      if (CHAT_STRIPPED_TOOLS.has(name) || CHAT_MUTATING_NAME_RE.test(name)) return false;
      return true;
    });
  }
  if (cleanMode === 'code') {
    const rank = new Map(CODE_MODE_PRIORITY.map((n, i) => [n, i]));
    return tools
      .map((tool, index) => ({ tool, index, r: rank.has(getToolSchemaName(tool)) ? rank.get(getToolSchemaName(tool)) : 999 }))
      .sort((a, b) => (a.r - b.r) || (a.index - b.index))
      .map(entry => entry.tool);
  }
  return [...tools];
}

const ROLE_CORE_TOOLS = Object.freeze({
  research: ['browser_search', 'browser_open', 'browser_screenshot', 'knowledge_search', 'knowledge_ingest', 'fs_read', 'fs_list', 'memory_read', 'memory_save'],
  scout: ['browser_search', 'browser_open', 'browser_screenshot', 'knowledge_search', 'knowledge_ingest', 'fs_read', 'fs_list', 'memory_read', 'memory_save'],
  writer: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'knowledge_search', 'memory_read', 'memory_save'],
  copy: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'knowledge_search', 'memory_read', 'memory_save'],
  design: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'knowledge_search', 'memory_read', 'memory_save'],
  builder: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'shell_exec', 'knowledge_search', 'memory_read', 'memory_save'],
  code: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'shell_exec', 'knowledge_search', 'memory_read', 'memory_save'],
  engineer: ['fs_read', 'fs_write', 'foundry_create', 'fs_list', 'shell_exec', 'knowledge_search', 'memory_read', 'memory_save'],
  ops: ['fs_read', 'fs_write', 'fs_list', 'shell_exec', 'knowledge_search', 'memory_read', 'memory_save'],
  finance: ['fs_read', 'fs_write', 'fs_list', 'knowledge_search', 'memory_read', 'memory_save'],
  chief: ['subagent_loop', 'fs_read', 'fs_write', 'foundry_create', 'fs_list', 'knowledge_search', 'browser_search', 'memory_read', 'memory_save'],
  orchestrator: ['subagent_loop', 'fs_read', 'fs_write', 'foundry_create', 'fs_list', 'knowledge_search', 'browser_search', 'memory_read', 'memory_save'],
});

/**
 * Curate tool schemas per bot role, prompt intent, and model capacity so small local models
 * (e.g., qwen3:1.7b/4b) do not over-call heavy meta-tools on simple turns.
 */
export function curateToolsForBotTurn(tools, { bot = null, userText = '', modelName = '', explicitToolNames = null } = {}) {
  if (!Array.isArray(tools)) return [];
  if (Array.isArray(explicitToolNames)) {
    const allow = new Set(explicitToolNames.map(String));
    return tools.filter(t => allow.has(getToolSchemaName(t)));
  }

  const prompt = String(userText || '');
  const isSmallLocal = /(?:^|[^a-z0-9])(?:1\.7b|4b|3b|2b|1b|0\.5b)(?:$|[^a-z0-9])/i.test(String(modelName || ''));
  const wantsSpawn = /\b(spawn|recruit|create\s+(?:a\s+)?(?:bot|ally|specialist|agent))\b/i.test(prompt);
  const wantsDesktop = /\b(desktop|mouse|keyboard|click\s+screen|hotkey|window)\b/i.test(prompt);

  let curated = tools;
  if (isSmallLocal) {
    curated = curated.filter(t => {
      const name = getToolSchemaName(t);
      if (name === 'bot_spawn' && !wantsSpawn) return false;
      if (name === 'desktop_control' && !wantsDesktop) return false;
      return true;
    });
  }

  const tag = String(bot?.specialistTag || '').toLowerCase();
  const roleStr = `${tag} ${String(bot?.role || '').toLowerCase()}`;
  const matchedKey = Object.keys(ROLE_CORE_TOOLS).find(k => roleStr.includes(k));
  const wantsAllTools = /\b(shell|terminal|command|run|browser|search|mcp|council|spawn)\b/i.test(prompt);
  if (matchedKey && isSmallLocal && !wantsAllTools) {
    const roleSet = new Set(ROLE_CORE_TOOLS[matchedKey]);
    const filtered = curated.filter(t => {
      const name = getToolSchemaName(t);
      return roleSet.has(name) || name.startsWith('mcp__');
    });
    if (filtered.length > 0) curated = filtered;
  }
  return curated;
}

const CAPABILITY_KEYS = ['shell', 'fs', 'browser', 'memory', 'vault'];
const TOOL_CAPABILITY_MAP = {
  shell_exec: 'shell',
  desktop_control: 'shell',
  fs_list: 'fs',
  fs_read: 'fs',
  fs_write: 'fs',
  foundry_create: 'fs',
  browser_search: 'browser',
  browser_open: 'browser',
  browser_action: 'browser',
  browser_screenshot: 'browser',
  memory_save: 'memory',
  memory_read: 'memory',
  vault_use: 'vault',
};
const CAPABILITY_TOOLS = {
  shell: ['shell_exec'],
  fs: ['fs_list', 'fs_read', 'fs_write', 'foundry_create'],
  browser: ['browser_search', 'browser_open', 'browser_action', 'browser_screenshot'],
  memory: ['memory_read', 'memory_save'],
  vault: ['vault_use'],
};
const AUTONOMY_UNIVERSAL_TOOLS = [
  'knowledge_search',
  'knowledge_ingest',
  'subagent_loop',
  'council_convene',
  'bot_spawn',
];

function capabilityEnabledOnTools(toolsMap, cap) {
  if (!toolsMap || typeof toolsMap !== 'object') return cap !== 'vault';
  if (cap === 'vault') return toolsMap.vault === true;
  return toolsMap[cap] !== false;
}

export function getEffectiveParentAllowedTools(parentBot) {
  const hasExplicitArray = Array.isArray(parentBot?.allowedTools);
  const explicitSet = hasExplicitArray ? new Set(parentBot.allowedTools.map(String)) : null;
  const hasToolsObj = Boolean(parentBot?.tools && typeof parentBot.tools === 'object');

  const capAllowed = {};
  for (const cap of CAPABILITY_KEYS) {
    const byTools = hasToolsObj ? capabilityEnabledOnTools(parentBot.tools, cap) : !hasExplicitArray && cap !== 'vault';
    const byArray = !explicitSet || explicitSet.has(cap) || (CAPABILITY_TOOLS[cap] || []).some(tn => explicitSet.has(tn));
    capAllowed[cap] = hasExplicitArray && !hasToolsObj
      ? explicitSet.has(cap) || (CAPABILITY_TOOLS[cap] || []).some(tn => explicitSet.has(tn))
      : byTools && byArray;
  }

  const allowedToolSet = new Set();
  for (const cap of CAPABILITY_KEYS) {
    if (!capAllowed[cap]) continue;
    for (const tn of CAPABILITY_TOOLS[cap] || []) {
      if (!explicitSet || explicitSet.has(tn) || explicitSet.has(cap)) {
        allowedToolSet.add(tn);
      }
    }
  }
  for (const tn of AUTONOMY_UNIVERSAL_TOOLS) {
    if (!explicitSet || explicitSet.has(tn)) {
      allowedToolSet.add(tn);
    }
  }
  if (explicitSet) {
    for (const item of explicitSet) {
      if (item.startsWith('mcp__')) allowedToolSet.add(item);
      if (item === 'desktop_control' && capAllowed.shell) allowedToolSet.add(item);
    }
  } else if (capAllowed.shell) {
    allowedToolSet.add('desktop_control');
  }

  return { capAllowed, allowedToolSet, explicitSet };
}

export function intersectBotToolPermissions(parentBot, requestedAllowedTools) {
  const { capAllowed, allowedToolSet, explicitSet } = getEffectiveParentAllowedTools(parentBot);

  if (Array.isArray(requestedAllowedTools)) {
    const filtered = [];
    const seen = new Set();
    for (const raw of requestedAllowedTools) {
      const item = String(raw || '').trim();
      if (!item || seen.has(item)) continue;
      if (CAPABILITY_KEYS.includes(item)) {
        if (!explicitSet || explicitSet.has(item)) {
          if (capAllowed[item]) {
            seen.add(item);
            filtered.push(item);
          }
        } else {
          // Expand capability wildcard strictly to the subset of tools the parent actually holds
          for (const tn of CAPABILITY_TOOLS[item] || []) {
            if (allowedToolSet.has(tn) && !seen.has(tn)) {
              seen.add(tn);
              filtered.push(tn);
            }
          }
          if (item === 'shell' && allowedToolSet.has('desktop_control') && !seen.has('desktop_control')) {
            seen.add('desktop_control');
            filtered.push('desktop_control');
          }
        }
      } else if (allowedToolSet.has(item)) {
        seen.add(item);
        filtered.push(item);
      }
    }

    const childTools = {};
    for (const cap of CAPABILITY_KEYS) {
      childTools[cap] = capAllowed[cap] && filtered.some(item => item === cap || TOOL_CAPABILITY_MAP[item] === cap);
    }
    return { childTools, childAllowedTools: filtered };
  }

  if (requestedAllowedTools && typeof requestedAllowedTools === 'object') {
    const childTools = {};
    for (const cap of CAPABILITY_KEYS) {
      childTools[cap] = capAllowed[cap] && Boolean(requestedAllowedTools[cap]);
    }
    const childAllowedTools = [];
    for (const cap of CAPABILITY_KEYS) {
      if (!childTools[cap]) continue;
      for (const tn of CAPABILITY_TOOLS[cap] || []) {
        if (allowedToolSet.has(tn)) childAllowedTools.push(tn);
      }
    }
    for (const tn of AUTONOMY_UNIVERSAL_TOOLS) {
      if (allowedToolSet.has(tn) && tn !== 'bot_spawn') childAllowedTools.push(tn);
    }
    return { childTools, childAllowedTools };
  }

  const childTools = { ...capAllowed };
  const childAllowedTools = explicitSet ? [...explicitSet].filter(x => CAPABILITY_KEYS.includes(x) || allowedToolSet.has(x)) : [...allowedToolSet];
  return { childTools, childAllowedTools };
}

export function isToolAllowedForBot(bot, toolName) {
  if (!bot) return false;
  const cap = TOOL_CAPABILITY_MAP[toolName];
  if (cap && bot.tools && !capabilityEnabledOnTools(bot.tools, cap)) {
    return false;
  }
  if (Array.isArray(bot.allowedTools)) {
    const set = new Set(bot.allowedTools.map(String));
    if (set.has(toolName)) return true;
    if (cap && set.has(cap)) return true;
    return false;
  }
  return true;
}

export function classifyToolApproval(toolName, args, policy = 'ask-writes', context = {}) {
  const rev = classifyReversibility(toolName, args);
  const tier = toolName === 'bot_spawn'
    ? 'high'
    : READ_ONLY_TOOLS.has(toolName)
      ? 'read'
      : toolName === 'subagent_loop'
        ? 'delegation'
        : 'write';

  if (policy === 'auto-approve') return { needsApproval: false, reason: 'auto-approve', tier, ...rev };
  if (context?.bot?.approvalPolicy === 'auto-approve' || context?.sessionApprovedTools?.has?.(toolName)) {
    return { needsApproval: false, reason: 'session/bot approval policy permits', tier, ...rev };
  }
  if (policy === 'always-ask') {
    return { needsApproval: true, reason: `Always-ask policy requires confirmation for ${toolName}`, tier, ...rev };
  }
  if (policy === 'reversibility') {
    // The matrix, enforced: reversible work runs on its own, irreversible work waits for a human.
    // Anything the classifier does not recognise counts as irreversible.
    return rev.reversibility === 'reversible'
      ? { needsApproval: false, reason: `Reversible: ${rev.reversibilityLabel}`, tier, ...rev }
      : { needsApproval: true, reason: `Irreversible action needs your OK: ${toolName}${args?.action ? ` (${args.action})` : ''}`, tier, ...rev };
  }
  if (READ_ONLY_TOOLS.has(toolName)) return { needsApproval: false, reason: 'read-only', tier: 'read', ...rev };
  if (toolName === 'memory_save') {
    return { needsApproval: false, reason: 'reversible bot memory note', tier: 'write', ...rev };
  }
  if (toolName === 'foundry_create') {
    return { needsApproval: false, reason: 'reversible creative studio deliverable', tier: 'write', ...rev };
  }
  if (toolName === 'subagent_loop') {
    return { needsApproval: false, reason: 'delegates bounded subtask; child mutating tools remain gated', tier: 'delegation', ...rev };
  }
  if (toolName === 'bot_spawn') {
    return {
      needsApproval: true,
      tier: 'high',
      ...rev,
      reason: `Spawn autonomous child bot "${String(args?.name || args?.role || 'specialist').slice(0, 60)}"`,
    };
  }
  if (toolName === 'shell_exec') {
    return { needsApproval: true, reason: `Execute local shell command: ${String(args?.command || '').slice(0, 80)}`, tier: 'high', ...rev };
  }
  if (toolName === 'fs_write') {
    return { needsApproval: true, reason: `Write workspace file: ${args?.path || 'unknown'}`, tier: 'write', ...rev };
  }
  if (toolName === 'vault_use') {
    return { needsApproval: true, reason: `Access encrypted Vault secret "${args?.label || ''}"`, tier: 'high', ...rev };
  }
  if (toolName === 'browser_action') {
    if (['snapshot', 'extract_structured'].includes(String(args?.action || ''))) {
      return { needsApproval: false, reason: 'read-only', tier: 'read', ...rev };
    }
    if (args?.action === 'upload') {
      return { needsApproval: true, reason: `Upload workspace file "${args?.filePath || '?'}" to the open web page`, tier: 'high', ...rev };
    }
    return { needsApproval: true, reason: `Perform browser ${args?.action || 'action'}`, tier: 'write', ...rev };
  }
  if (toolName === 'knowledge_ingest') {
    return { needsApproval: true, reason: `Fetch and index external content: ${String(args?.url || args?.query || '').slice(0, 80)}`, tier: 'write', ...rev };
  }
  if (toolName.startsWith('mcp__')) {
    return { needsApproval: true, reason: `Invoke external MCP tool ${toolName}`, tier: 'write', ...rev };
  }
  return { needsApproval: true, reason: `Invoke mutating tool ${toolName}`, tier: 'write', ...rev };
}

const SITE_SHORTCUTS = {
  google: 'https://www.google.com',
  duckduckgo: 'https://duckduckgo.com',
  ddg: 'https://duckduckgo.com',
  github: 'https://github.com',
  wikipedia: 'https://en.wikipedia.org',
  bing: 'https://www.bing.com',
  youtube: 'https://www.youtube.com',
  reddit: 'https://www.reddit.com',
  ollama: 'https://ollama.com',
};

export function resolveUrlOrSearch(rawInput) {
  const str = String(rawInput || '').trim();
  if (!str) throw new Error('Empty URL or query');
  if (str === 'about:blank') return 'about:blank';

  const lower = str.toLowerCase();
  if (SITE_SHORTCUTS[lower]) return SITE_SHORTCUTS[lower];

  if (/^https?:\/\//i.test(str)) {
    const u = new URL(str);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Blocked URL protocol: ${u.protocol}`);
    return u.toString();
  }

  // Block dangerous schemes (javascript:, file:, data:)
  if (/^[a-z][a-z0-9+.-]*:/i.test(str) && !/^localhost:/i.test(str)) {
    throw new Error(`Blocked URL protocol: ${str.split(':')[0]}:`);
  }

  // Bare host/domain like "example.com", "localhost:5173", "127.0.0.1:4567/health"
  if (!/\s/.test(str) && (str.includes('.') || /^localhost(:\d+)?(\/|$)/i.test(str))) {
    const proto = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(str) ? 'http://' : 'https://';
    return new URL(`${proto}${str}`).toString();
  }

  // Fallback for search phrases or unknown single words -> live web search page
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(str)}`;
}

const CHAT_PASSWORD_RE = /\b(password|passwd|pwd|api[_-]?key|secret[_-]?key|client[_-]?secret|passphrase)\s*[:=]\s*([^\s"'`]{4,})/gi;
const CHAT_2FA_CODE_RE = /\b(2fa|otp|totp|mfa|verification\s+code)(?:\s+(?:code|token|pin))?(?:\s*(?:is|:|=))?\s*(\d{6,8})\b/gi;

export function detectCredentialPasteInChat(text) {
  const raw = String(text || '');
  let matched = false;
  let sanitized = raw.replace(CHAT_PASSWORD_RE, (_m, key) => {
    matched = true;
    return `${key}: [REDACTED_USE_SESSION_HANDOFF]`;
  });
  sanitized = sanitized.replace(CHAT_2FA_CODE_RE, (_m, key) => {
    matched = true;
    return `${key}: [REDACTED_USE_SESSION_HANDOFF]`;
  });
  return {
    blockedCredentialPaste: matched,
    sanitizedText: sanitized,
    reason: matched
      ? 'Raw password or 2FA code detected in chat and redacted. Use Secure Session Handoff in the Browser pane so only session cookies persist in /workspace/state/sessions/.'
      : null,
  };
}

export class BrowserSessionManager {
  constructor(storeOrCallback, maybeCallback, onCursor = null) {
    if (typeof storeOrCallback === 'function' || !storeOrCallback) {
      this.store = null;
      this.onScreenshot = storeOrCallback || null;
    } else {
      this.store = storeOrCallback;
      this.onScreenshot = maybeCallback || null;
    }
    this.onCursor = typeof onCursor === 'function' ? onCursor : null;
    this.browser = null;
    this.persistentContext = null;
    this.activeMode = null;
    this.localRelayServer = null;
    this.localRelayWs = '';
    this.browserInitPromise = null;
    this.sessions = new Map(); // botId -> { context, page, url, title, screenshotBase64, interactiveElements, controlMode, agentCursor, mode, updatedAt }
  }

  #getModeSettings() {
    const s = this.store?.getSettings?.() || {};
    return {
      browserMode: s.browserMode || 'embedded',
      userCdpUrl: String(s.userCdpUrl || 'http://127.0.0.1:9222').trim(),
      cloudBrowserWsUrl: String(s.cloudBrowserWsUrl || this.localRelayWs || '').trim(),
    };
  }

  async startFreeCloudRelay() {
    if (this.localRelayServer && this.localRelayWs) {
      return { wsEndpoint: this.localRelayWs, mode: 'local-playwright-ws-relay' };
    }
    const executablePath = resolveChromiumPath();
    if (!executablePath) throw new Error('No Chromium executable available for relay');
    this.localRelayServer = await chromium.launchServer({
      executablePath,
      headless: true,
      host: '127.0.0.1',
      port: 0,
      args: ['--disable-gpu', '--no-sandbox'],
    });
    this.localRelayWs = this.localRelayServer.wsEndpoint();
    return { wsEndpoint: this.localRelayWs, mode: 'local-playwright-ws-relay' };
  }

  async stopFreeCloudRelay() {
    if (this.localRelayServer) {
      await this.localRelayServer.close().catch(() => {});
      this.localRelayServer = null;
      this.localRelayWs = '';
    }
  }

  async switchModeCleanup() {
    for (const s of this.sessions.values()) {
      if (s.ownsContext) {
        await s.context.close().catch(() => {});
      }
    }
    this.sessions.clear();
    if (this.persistentContext) {
      await this.persistentContext.close().catch(() => {});
      this.persistentContext = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  async #ensureConnection() {
    if (this.browserInitPromise) return this.browserInitPromise;
    this.browserInitPromise = (async () => {
      const cfg = this.#getModeSettings();
      if (this.activeMode && this.activeMode !== cfg.browserMode) {
        await this.switchModeCleanup();
      }
      this.activeMode = cfg.browserMode;

      if (cfg.browserMode === 'free-cloud') {
        if (this.browser?.isConnected()) return { mode: 'free-cloud', browser: this.browser, persistentContext: null };
        if (!cfg.cloudBrowserWsUrl) {
          throw new Error(
            'Free Cloud Browser has no WebSocket URL configured. Paste a free remote CDP/Playwright WS endpoint in Preview Settings or click "Start Free Relay" — zero payment needed.'
          );
        }
        if (/\/json\/version/i.test(cfg.cloudBrowserWsUrl) || /^https?:\/\//i.test(cfg.cloudBrowserWsUrl)) {
          this.browser = await chromium.connectOverCDP(cfg.cloudBrowserWsUrl);
        } else {
          try {
            this.browser = await chromium.connect(cfg.cloudBrowserWsUrl);
          } catch {
            this.browser = await chromium.connectOverCDP(cfg.cloudBrowserWsUrl);
          }
        }
        return { mode: 'free-cloud', browser: this.browser, persistentContext: null };
      }

      if (cfg.browserMode === 'user-computer') {
        if (this.browser?.isConnected()) return { mode: 'user-computer', browser: this.browser, persistentContext: null };
        if (this.persistentContext) {
          try {
            if (this.persistentContext.pages().some(p => !p.isClosed())) {
              return { mode: 'user-computer', browser: null, persistentContext: this.persistentContext };
            }
          } catch {
            // Closed persistent context — recreate below
          }
          await this.persistentContext.close().catch(() => {});
          this.persistentContext = null;
        }

        if (cfg.userCdpUrl) {
          try {
            const probe = await fetch(`${cfg.userCdpUrl.replace(/\/+$/, '')}/json/version`, { signal: AbortSignal.timeout(1200) });
            if (probe.ok) {
              this.browser = await chromium.connectOverCDP(cfg.userCdpUrl);
              return { mode: 'user-computer', browser: this.browser, persistentContext: null };
            }
          } catch {
            // Port 9222 not listening -> fall through to launching visible window on user computer
          }
        }

        const executablePath = resolveChromiumPath({ preferSystemBrowser: true });
        if (!executablePath) throw new Error('No Chrome, Edge, or Chromium browser found on this computer.');
        const profileDir = this.store?.dataDir
          ? path.join(this.store.dataDir, 'user-browser-profile')
          : path.join(os.tmpdir(), 'mimir-user-browser-profile');
        fs.mkdirSync(profileDir, { recursive: true });
        this.persistentContext = await chromium.launchPersistentContext(profileDir, {
          executablePath,
          headless: false,
          viewport: { width: 1280, height: 800 },
        });
        return { mode: 'user-computer', browser: null, persistentContext: this.persistentContext };
      }

      if (this.browser?.isConnected()) return { mode: 'embedded', browser: this.browser, persistentContext: null };
      const executablePath = resolveChromiumPath();
      if (!executablePath) {
        throw new Error('No Chromium executable found (install ms-playwright or Chrome/Edge)');
      }
      this.browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--disable-gpu', '--no-sandbox'],
      });
      return { mode: 'embedded', browser: this.browser, persistentContext: null };
    })();
    try {
      return await this.browserInitPromise;
    } finally {
      this.browserInitPromise = null;
    }
  }

  #pickUnclaimedPage(context, botId) {
    const claimed = new Set();
    for (const [id, sess] of this.sessions.entries()) {
      if (id !== botId && sess?.page && !sess.page.isClosed()) claimed.add(sess.page);
    }
    return context.pages().find(p => !p.isClosed() && !claimed.has(p)) || null;
  }

  async #ensurePage(botId) {
    const cfg = this.#getModeSettings();
    const existing = this.sessions.get(botId);
    if (existing && existing.mode === cfg.browserMode && !existing.page.isClosed()) {
      return existing;
    }

    const conn = await this.#ensureConnection();
    let context;
    let page;
    let ownsContext = false;

    if (conn.persistentContext) {
      context = conn.persistentContext;
      page = this.#pickUnclaimedPage(context, botId) || (await context.newPage());
    } else if (conn.mode === 'user-computer' && conn.browser.contexts().length > 0) {
      context = conn.browser.contexts()[0];
      page = this.#pickUnclaimedPage(context, botId) || (await context.newPage());
    } else {
      context = await conn.browser.newContext({ viewport: { width: 1280, height: 800 } });
      page = await context.newPage();
      ownsContext = true;
    }

    const session = {
      context,
      page,
      ownsContext,
      mode: conn.mode,
      url: page.url() || 'about:blank',
      title: 'New Tab',
      screenshotBase64: null,
      interactiveElements: [],
      controlMode: 'agent',
      agentCursor: {
        active: false,
        x: 640,
        y: 400,
        xPct: 50,
        yPct: 50,
        action: 'idle',
        label: '',
        targetSelector: '',
        trail: [],
        updatedAt: null,
      },
      updatedAt: null,
    };
    this.sessions.set(botId, session);
    return session;
  }

  async #extractInteractiveElements(page) {
    return page
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"]')
        );
        const out = [];
        for (const el of nodes) {
          if (out.length >= 20) break;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > window.innerHeight * 2) continue;

          const idPart = el.id ? `#${CSS.escape(el.id)}` : '';
          const nameAttr = el.getAttribute('name');
          const aria = el.getAttribute('aria-label');
          const placeholder = el.getAttribute('placeholder');
          const type = el.getAttribute('type') || '';
          const tag = el.tagName.toLowerCase();

          let selector = '';
          if (idPart) selector = `${tag}${idPart}`;
          else if (nameAttr) selector = `${tag}[name="${nameAttr.replace(/"/g, '\\"')}"]`;
          else if (aria) selector = `${tag}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
          else if (placeholder) selector = `${tag}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
          else if (type) selector = `${tag}[type="${type}"]`;
          else selector = tag;

          const label = (el.innerText || el.value || aria || placeholder || el.getAttribute('title') || nameAttr || tag)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 64);

          out.push({
            index: out.length,
            tag,
            type,
            label,
            selector,
            href: tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : undefined,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          });
        }
        return out;
      })
      .catch(() => []);
  }

  #emitCursor(botId, session, patch = {}) {
    const rawX = Number(patch.x);
    const rawY = Number(patch.y);
    const x = Number.isFinite(rawX) ? Math.max(0, Math.min(1280, Math.round(rawX))) : (session.agentCursor?.x ?? 640);
    const y = Number.isFinite(rawY) ? Math.max(0, Math.min(800, Math.round(rawY))) : (session.agentCursor?.y ?? 400);
    const xPct = Math.round((x / 1280) * 1000) / 10;
    const yPct = Math.round((y / 800) * 1000) / 10;
    const prevTrail = Array.isArray(session.agentCursor?.trail) ? session.agentCursor.trail : [];
    const lastPt = prevTrail[prevTrail.length - 1];
    const trail = (!lastPt || Math.abs(lastPt.xPct - xPct) > 0.3 || Math.abs(lastPt.yPct - yPct) > 0.3)
      ? [...prevTrail.slice(-13), { xPct, yPct }]
      : prevTrail;
    session.agentCursor = {
      active: patch.active !== undefined ? Boolean(patch.active) : true,
      x,
      y,
      xPct,
      yPct,
      action: String(patch.action || session.agentCursor?.action || 'move'),
      label: String(patch.label ?? patch.action ?? '').slice(0, 64),
      targetSelector: String(patch.targetSelector ?? ''),
      trail,
      updatedAt: new Date().toISOString(),
    };
    this.onCursor?.({
      botId,
      controlMode: session.controlMode || 'agent',
      userControlActive: session.controlMode === 'user',
      cursor: session.agentCursor,
    });
    return session.agentCursor;
  }

  async #resolveLocatorCenter(page, selector) {
    const loc = page.locator(String(selector)).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return null;
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      box,
      loc,
    };
  }

  async #moveCursor(botId, session, x, y, meta = {}) {
    await session.page.mouse.move(x, y, { steps: meta.steps || 5 }).catch(() => {});
    return this.#emitCursor(botId, session, { x, y, ...meta });
  }

  async setControlMode(botId, mode = 'agent') {
    const normalized = mode === 'user' ? 'user' : 'agent';
    const session = this.sessions.get(botId);
    if (session) {
      session.controlMode = normalized;
      if (normalized === 'user') {
        this.#emitCursor(botId, session, {
          active: false,
          action: 'user-control',
          label: 'User in control',
          targetSelector: '',
        });
      } else {
        this.#emitCursor(botId, session, {
          active: true,
          action: 'agent-resumed',
          label: 'Agent resumed',
          targetSelector: '',
        });
      }
    }
    return this.getState(botId);
  }

  async #captureState(botId, session) {
    const buf = await session.page.screenshot({ type: 'jpeg', quality: 75 });
    const title = await session.page.title().catch(() => '');
    const url = session.page.url();
    const interactiveElements = await this.#extractInteractiveElements(session.page);
    const b64 = buf.toString('base64');
    session.url = url;
    session.title = title;
    session.screenshotBase64 = b64;
    session.interactiveElements = interactiveElements;
    session.updatedAt = new Date().toISOString();
    this.onScreenshot?.({
      botId,
      mode: session.mode,
      url,
      title,
      screenshotBase64: b64,
      interactiveElements,
      controlMode: session.controlMode || 'agent',
      userControlActive: session.controlMode === 'user',
      agentCursor: session.agentCursor || null,
      updatedAt: session.updatedAt,
    });
    return session;
  }

  getState(botId) {
    const cfg = this.#getModeSettings();
    const s = this.sessions.get(botId);
    if (!s) {
      return {
        mode: cfg.browserMode,
        url: null,
        title: null,
        screenshotBase64: null,
        interactiveElements: [],
        controlMode: 'agent',
        userControlActive: false,
        agentCursor: null,
        updatedAt: null,
        relayActive: Boolean(this.localRelayWs),
        relayWsUrl: this.localRelayWs || '',
      };
    }
    return {
      mode: cfg.browserMode,
      url: s.url,
      title: s.title,
      screenshotBase64: s.screenshotBase64,
      interactiveElements: s.interactiveElements || [],
      controlMode: s.controlMode || 'agent',
      userControlActive: s.controlMode === 'user',
      agentCursor: s.agentCursor || null,
      updatedAt: s.updatedAt,
      relayActive: Boolean(this.localRelayWs),
      relayWsUrl: this.localRelayWs || '',
    };
  }

  async open(botId, rawUrl) {
    const url = resolveUrlOrSearch(rawUrl);
    const session = await this.#ensurePage(botId);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await this.#captureState(botId, session);
    const text = await session.page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => '');
    const isCaptcha = /\/sorry\/index|unusual traffic from your computer|verify you are human|captcha/i.test(`${session.url}\n${text}`);
    return {
      mode: session.mode,
      url: session.url,
      title: session.title,
      captchaDetected: isCaptcha,
      excerpt: isCaptcha
        ? 'CAPTCHA / anti-bot verification detected on this page. Mimir will not bypass bot checks; use browser_search or complete verification in Own Computer mode.'
        : text,
      interactiveElements: session.interactiveElements,
      screenshotBase64: session.screenshotBase64,
    };
  }

  #findFallbackElement(session, rawSelector, act) {
    const els = session.interactiveElements || [];
    if (!els.length) return null;
    const hint = String(rawSelector || '').toLowerCase();
    if (act === 'type' || /search|query|input|textarea|q/.test(hint)) {
      return els.find(e => e.tag === 'input' || e.tag === 'textarea') || null;
    }
    const words = hint.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length) {
      return els.find(e => words.some(w => `${e.label} ${e.selector}`.toLowerCase().includes(w))) || null;
    }
    return null;
  }

  async action(botId, params = {}) {
    const session = await this.#ensurePage(botId);
    const act = params.action;
    let structured = null;
    if (act === 'click' || act === 'double_click' || act === 'hover') {
      if (params.selector) {
        let targetSel = String(params.selector);
        let pt = await this.#resolveLocatorCenter(session.page, targetSel);
        if (!pt) {
          const fallback = this.#findFallbackElement(session, targetSel, 'click');
          if (fallback) {
            targetSel = fallback.selector;
            pt = await this.#resolveLocatorCenter(session.page, targetSel);
          }
        }
        if (pt) {
          await this.#moveCursor(botId, session, pt.x, pt.y, {
            action: act,
            label: `${act}: ${targetSel}`.slice(0, 48),
            targetSelector: targetSel,
          });
        }
        const loc = session.page.locator(targetSel).first();
        if (act === 'hover') await loc.hover({ timeout: 5000 });
        else if (act === 'double_click') await loc.dblclick({ timeout: 5000 });
        else await loc.click({ timeout: 5000 });
      } else if (typeof params.x === 'number' && typeof params.y === 'number') {
        await this.#moveCursor(botId, session, params.x, params.y, {
          action: act,
          label: `${act} (${Math.round(params.x)}, ${Math.round(params.y)})`,
        });
        if (act === 'double_click') await session.page.mouse.dblclick(params.x, params.y);
        else if (act === 'click') await session.page.mouse.click(params.x, params.y);
      } else {
        throw new Error(`${act} requires selector or x,y coordinates`);
      }
    } else if (act === 'click_percent') {
      const x = Math.round(((Number(params.xPct) || 50) / 100) * 1280);
      const y = Math.round(((Number(params.yPct) || 50) / 100) * 800);
      await this.#moveCursor(botId, session, x, y, {
        action: params.source === 'user' ? 'user-click' : 'click',
        label: params.source === 'user' ? `User click (${Math.round(Number(params.xPct) || 50)}%, ${Math.round(Number(params.yPct) || 50)}%)` : `Click (${x}, ${y})`,
      });
      await session.page.mouse.click(x, y);
    } else if (act === 'type') {
      const text = String(params.text ?? '');
      if (params.selector) {
        let targetSel = String(params.selector);
        let pt = await this.#resolveLocatorCenter(session.page, targetSel);
        if (!pt) {
          const fallback = this.#findFallbackElement(session, targetSel, 'type');
          if (fallback) {
            targetSel = fallback.selector;
            pt = await this.#resolveLocatorCenter(session.page, targetSel);
          }
        }
        if (pt) {
          await this.#moveCursor(botId, session, pt.x, pt.y, {
            action: 'type',
            label: `Type into ${targetSel}`.slice(0, 48),
            targetSelector: targetSel,
          });
        }
        await session.page.locator(targetSel).first().fill(text, { timeout: 5000 });
      } else {
        await session.page.keyboard.type(text);
      }
      if (params.submit) {
        await session.page.keyboard.press('Enter');
      }
    } else if (act === 'select') {
      if (!params.selector) throw new Error('select requires a selector');
      const pt = await this.#resolveLocatorCenter(session.page, params.selector);
      if (pt) {
        await this.#moveCursor(botId, session, pt.x, pt.y, {
          action: 'select',
          label: `Select ${params.selector}`.slice(0, 48),
          targetSelector: params.selector,
        });
      }
      await session.page.locator(params.selector).first().selectOption(String(params.value ?? params.text ?? ''), { timeout: 5000 });
    } else if (act === 'check') {
      if (!params.selector) throw new Error('check requires a selector');
      const pt = await this.#resolveLocatorCenter(session.page, params.selector);
      if (pt) {
        await this.#moveCursor(botId, session, pt.x, pt.y, {
          action: 'check',
          label: `Check ${params.selector}`.slice(0, 48),
          targetSelector: params.selector,
        });
      }
      await session.page.locator(params.selector).first().setChecked(params.value !== false && params.value !== 'false', { timeout: 5000 });
    } else if (act === 'fill_form') {
      const entries = Array.isArray(params.fields)
        ? params.fields
        : Object.entries(params.fields || {}).map(([selector, value]) => ({ selector, value }));
      if (!entries.length) throw new Error('fill_form requires non-empty fields array or object');
      for (const item of entries) {
        const sel = String(item?.selector || '');
        if (!sel) continue;
        const pt = await this.#resolveLocatorCenter(session.page, sel);
        if (pt) {
          await this.#moveCursor(botId, session, pt.x, pt.y, {
            action: 'fill_form',
            label: `Fill ${sel}`.slice(0, 48),
            targetSelector: sel,
          });
        }
        const loc = session.page.locator(sel).first();
        const kind = String(item?.type || 'text').toLowerCase();
        if (kind === 'select') {
          await loc.selectOption(String(item.value ?? ''), { timeout: 5000 });
        } else if (kind === 'checkbox' || kind === 'radio') {
          await loc.setChecked(item.checked !== false && item.value !== false && item.value !== 'false', { timeout: 5000 });
        } else {
          await loc.fill(String(item.value ?? ''), { timeout: 5000 });
        }
      }
      if (params.submitSelector) {
        const pt = await this.#resolveLocatorCenter(session.page, params.submitSelector);
        if (pt) {
          await this.#moveCursor(botId, session, pt.x, pt.y, {
            action: 'submit',
            label: `Submit ${params.submitSelector}`.slice(0, 48),
            targetSelector: params.submitSelector,
          });
        }
        await session.page.locator(String(params.submitSelector)).first().click({ timeout: 5000 });
      }
    } else if (act === 'drag') {
      let fromPt = null;
      let toPt = null;
      if (params.selector && params.targetSelector) {
        fromPt = await this.#resolveLocatorCenter(session.page, params.selector);
        toPt = await this.#resolveLocatorCenter(session.page, params.targetSelector);
      } else if (params.startXPct != null && params.startYPct != null && params.endXPct != null && params.endYPct != null) {
        fromPt = { x: Math.round((Number(params.startXPct) / 100) * 1280), y: Math.round((Number(params.startYPct) / 100) * 800) };
        toPt = { x: Math.round((Number(params.endXPct) / 100) * 1280), y: Math.round((Number(params.endYPct) / 100) * 800) };
      } else if (params.startX != null && params.startY != null && params.endX != null && params.endY != null) {
        fromPt = { x: Number(params.startX), y: Number(params.startY) };
        toPt = { x: Number(params.endX), y: Number(params.endY) };
      }
      if (!fromPt || !toPt) throw new Error('drag requires selector+targetSelector or start/end coordinates');
      await this.#moveCursor(botId, session, fromPt.x, fromPt.y, {
        action: 'drag',
        label: `Drag ${params.selector || 'pointer'}`.slice(0, 48),
        targetSelector: String(params.selector || ''),
      });
      await session.page.mouse.down();
      try {
        await this.#moveCursor(botId, session, (fromPt.x + toPt.x) / 2, (fromPt.y + toPt.y) / 2, {
          action: 'drag',
          label: 'Dragging...',
          targetSelector: String(params.targetSelector || ''),
          steps: 6,
        });
        await this.#moveCursor(botId, session, toPt.x, toPt.y, {
          action: 'drag',
          label: `Drop -> ${params.targetSelector || 'target'}`.slice(0, 48),
          targetSelector: String(params.targetSelector || ''),
          steps: 6,
        });
      } finally {
        await session.page.mouse.up().catch(() => {});
      }
    } else if (act === 'draw') {
      let box = null;
      if (params.selector) {
        const resolved = await this.#resolveLocatorCenter(session.page, params.selector);
        box = resolved?.box || null;
        if (!box) throw new Error(`draw selector not visible: ${params.selector}`);
      }
      let pts = [];
      if (Array.isArray(params.pathPct) && params.pathPct.length >= 2) {
        pts = params.pathPct.map(p => (
          box
            ? { x: Math.round(box.x + (Number(p.xPct) / 100) * box.width), y: Math.round(box.y + (Number(p.yPct) / 100) * box.height) }
            : { x: Math.round((Number(p.xPct) / 100) * 1280), y: Math.round((Number(p.yPct) / 100) * 800) }
        ));
      } else if (Array.isArray(params.path) && params.path.length >= 2) {
        pts = params.path.map(p => ({ x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }));
      }
      if (pts.length < 2) throw new Error('draw requires path or pathPct with at least 2 points');
      await this.#moveCursor(botId, session, pts[0].x, pts[0].y, {
        action: 'draw',
        label: `Draw on ${params.selector || 'canvas'}`.slice(0, 48),
        targetSelector: String(params.selector || ''),
      });
      await session.page.mouse.down();
      try {
        for (let i = 1; i < pts.length; i += 1) {
          await this.#moveCursor(botId, session, pts[i].x, pts[i].y, {
            action: 'draw',
            label: `Stroke ${i}/${pts.length - 1}`,
            targetSelector: String(params.selector || ''),
            steps: 4,
          });
        }
      } finally {
        await session.page.mouse.up().catch(() => {});
      }
    } else if (act === 'extract_structured') {
      const fieldsOut = {};
      const fieldSpec = params.fields && typeof params.fields === 'object' ? params.fields : {};
      let focused = false;
      for (const [key, spec] of Object.entries(fieldSpec)) {
        const sel = typeof spec === 'string' ? spec : String(spec?.selector || '');
        const attr = typeof spec === 'object' && spec?.attr ? String(spec.attr) : null;
        if (!sel) continue;
        if (!focused) {
          const pt = await this.#resolveLocatorCenter(session.page, sel);
          if (pt) {
            focused = true;
            await this.#moveCursor(botId, session, pt.x, pt.y, {
              action: 'extract_structured',
              label: `Extract: ${key}`.slice(0, 48),
              targetSelector: sel,
            });
          }
        }
        const loc = session.page.locator(sel).first();
        if (attr) {
          fieldsOut[key] = await loc.getAttribute(attr, { timeout: 3000 }).catch(() => '');
        } else {
          fieldsOut[key] = (await loc.innerText({ timeout: 3000 }).catch(() => '')).trim();
        }
      }
      let rows = [];
      if (params.tableSelector) {
        const rowCount = await session.page.locator(String(params.tableSelector)).count().catch(() => 0);
        for (let i = 0; i < Math.min(rowCount, 30); i += 1) {
          const cells = await session.page
            .locator(String(params.tableSelector))
            .nth(i)
            .locator('td,th')
            .allInnerTexts()
            .catch(() => []);
          if (cells.length) rows.push(cells.map(c => c.trim()));
        }
      }
      structured = { fields: fieldsOut, rows };
    } else if (act === 'snapshot') {
      // Accessibility tree (roles, names, values): a more reliable map than pixels for small models.
      const tree = await session.page.locator('body').ariaSnapshot({ timeout: 5000 });
      await this.#captureState(botId, session);
      return {
        mode: session.mode,
        url: session.url,
        title: session.title,
        controlMode: session.controlMode || 'agent',
        userControlActive: session.controlMode === 'user',
        agentCursor: session.agentCursor || null,
        interactiveElements: session.interactiveElements,
        excerpt: tree.slice(0, 6000),
      };
    } else if (act === 'press') {
      await session.page.keyboard.press(String(params.key || 'Enter'));
    } else if (act === 'scroll') {
      if (params.xPct != null && params.yPct != null) {
        const sx = Math.round((Number(params.xPct) / 100) * 1280);
        const sy = Math.round((Number(params.yPct) / 100) * 800);
        await this.#moveCursor(botId, session, sx, sy, { action: 'scroll', label: `Scroll ${params.direction || 'down'}` });
      }
      const delta = Number.isFinite(Number(params.deltaY))
        ? Number(params.deltaY)
        : (params.direction === 'up' ? -500 : 500);
      await session.page.mouse.wheel(0, delta);
    } else if (act === 'back') {
      await session.page.goBack({ timeout: 8000 }).catch(() => {});
    } else if (act === 'forward') {
      await session.page.goForward({ timeout: 8000 }).catch(() => {});
    } else {
      throw new Error(`Unsupported browser action: ${act}`);
    }
    await session.page.waitForTimeout(260);
    await this.#captureState(botId, session);
    const excerpt = await session.page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '').catch(() => '');
    return {
      mode: session.mode,
      url: session.url,
      title: session.title,
      controlMode: session.controlMode || 'agent',
      userControlActive: session.controlMode === 'user',
      agentCursor: session.agentCursor || null,
      interactiveElements: session.interactiveElements,
      ...(structured ? { structured } : {}),
      excerpt,
    };
  }

  async screenshot(botId) {
    const session = await this.#ensurePage(botId);
    await this.#captureState(botId, session);
    return {
      mode: session.mode,
      url: session.url,
      title: session.title,
      interactiveElements: session.interactiveElements,
      screenshotBase64: session.screenshotBase64,
    };
  }

  getSessionsDir(botId) {
    const safeBot = String(botId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = this.store?.getBotWorkspace
      ? path.join(this.store.getBotWorkspace(safeBot), 'state', 'sessions')
      : path.join(os.tmpdir(), 'mimir-sessions', safeBot);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  #sanitizeHandoffSummary(record) {
    const cookies = Array.isArray(record?.cookies) ? record.cookies : [];
    const maskedCookies = cookies.map(c => {
      const val = String(c?.value || '');
      const tail = val.length > 4 ? val.slice(-4) : '••••';
      return {
        name: String(c?.name || 'session'),
        domain: String(c?.domain || record?.domain || 'localhost'),
        maskedValue: `••••${tail}`,
        httpOnly: Boolean(c?.httpOnly),
        secure: Boolean(c?.secure),
      };
    });
    return {
      id: record.id,
      botId: record.botId,
      label: record.label,
      domain: record.domain,
      url: record.url,
      cookieCount: cookies.length,
      originCount: Array.isArray(record?.origins) ? record.origins.length : 0,
      savedAt: record.savedAt,
      lastRestoredAt: record.lastRestoredAt || null,
      filePath: `/workspace/state/sessions/${record.id}.json`,
      zeroPlaintextPasswords: true,
      maskedCookies,
    };
  }

  async saveSessionHandoff(botId, { label = '', url = '', domain = '' } = {}) {
    const sessionsDir = this.getSessionsDir(botId);
    const active = this.sessions.get(botId);
    const effectiveUrl = String(url || active?.url || (domain ? `https://${domain}` : 'https://app.mimir.local')).trim();
    let parsedDomain = String(domain || '').trim();
    if (!parsedDomain) {
      try {
        parsedDomain = new URL(effectiveUrl).hostname || 'localhost';
      } catch {
        parsedDomain = 'localhost';
      }
    }
    const cleanLabel = String(label || parsedDomain || 'browser-session').trim().slice(0, 64);
    const sessionId =
      cleanLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'session';

    let storageState = null;
    if (active?.context && typeof active.context.storageState === 'function') {
      try {
        storageState = await active.context.storageState();
      } catch {
        storageState = null;
      }
    }
    const cookies = Array.isArray(storageState?.cookies) && storageState.cookies.length
      ? storageState.cookies
      : [
          {
            name: 'mimir_handoff_sid',
            value: `handoff_${crypto.randomBytes(12).toString('hex')}`,
            domain: parsedDomain,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ];
    const origins = Array.isArray(storageState?.origins) ? storageState.origins : [];
    const now = new Date().toISOString();
    const record = {
      id: sessionId,
      botId,
      label: cleanLabel,
      domain: parsedDomain,
      url: effectiveUrl,
      savedAt: now,
      lastRestoredAt: null,
      zeroPlaintextPasswords: true,
      cookies,
      origins,
    };
    const filePath = path.join(sessionsDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    if (active) {
      active.activeSessionHandoff = sessionId;
    }
    return this.#sanitizeHandoffSummary(record);
  }

  listSessionHandoffs(botId) {
    const sessionsDir = this.getSessionsDir(botId);
    const items = [];
    for (const ent of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, ent.name), 'utf8'));
        items.push(this.#sanitizeHandoffSummary(raw));
      } catch {
        // skip corrupted session file
      }
    }
    return items.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  async restoreSessionHandoff(botId, sessionId) {
    const safeId = path.basename(String(sessionId || '')).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeId) throw new Error('Invalid session handoff ID');
    const filePath = path.join(this.getSessionsDir(botId), `${safeId}.json`);
    if (!fs.existsSync(filePath)) {
      const err = new Error(`Session handoff not found: ${safeId}`);
      err.status = 404;
      throw err;
    }
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const active = this.sessions.get(botId);
    if (active?.context && typeof active.context.addCookies === 'function' && Array.isArray(record.cookies)) {
      const validCookies = record.cookies.filter(c => c?.name && c?.value !== undefined && (c?.domain || c?.url));
      if (validCookies.length) {
        await active.context.addCookies(validCookies).catch(() => {});
      }
    }
    record.lastRestoredAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    if (active) {
      active.activeSessionHandoff = safeId;
      active.handoffRestoredAt = record.lastRestoredAt;
    }
    return {
      ok: true,
      session: this.#sanitizeHandoffSummary(record),
      state: this.getState(botId),
    };
  }

  deleteSessionHandoff(botId, sessionId) {
    const safeId = path.basename(String(sessionId || '')).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeId) return { ok: false, deleted: null };
    const filePath = path.join(this.getSessionsDir(botId), `${safeId}.json`);
    if (!fs.existsSync(filePath)) return { ok: false, deleted: safeId };
    fs.unlinkSync(filePath);
    return { ok: true, deleted: safeId };
  }

  async closeAll() {
    await this.switchModeCleanup();
    await this.stopFreeCloudRelay();
  }
}

export class LocalExecEngine {
  constructor({ store, vault, mcpManager, knowledge, scaleQueue, onEvent, runSubagentTurn = null, conveneCouncil = null }) {
    this.store = store;
    this.vault = vault;
    this.mcpManager = mcpManager;
    this.knowledge = knowledge;
    this.scaleQueue = scaleQueue;
    this.onEvent = onEvent;
    this.runSubagentTurn = runSubagentTurn;
    this.conveneCouncil = conveneCouncil;
    this.activity = new Map(); // botId -> array of recent tool logs
    this.browser = new BrowserSessionManager(
      store,
      payload => this.onEvent?.('computer:screenshot', payload),
      cursorPayload => this.onEvent?.('browser:cursor', cursorPayload),
    );
  }

  #pushActivity(botId, entry) {
    const list = this.activity.get(botId) || [];
    const item = { id: `act-${Date.now().toString(36)}`, timestamp: new Date().toISOString(), ...entry };
    list.unshift(item);
    if (list.length > 50) list.length = 50;
    this.activity.set(botId, list);
    this.onEvent?.('computer:activity', { botId, item });
  }

  getComputerState(botId) {
    const workspace = this.store.getBotWorkspace(botId);
    const files = this.#walkWorkspace(workspace, '', 2);
    return {
      botId,
      workspace,
      workspaceLayout: this.store.getWorkspaceLayout(botId),
      files,
      browser: this.browser.getState(botId),
      activity: this.activity.get(botId) || [],
    };
  }

  #walkWorkspace(root, rel, depth) {
    if (depth < 0) return [];
    const dir = rel ? path.join(root, rel) : root;
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        out.push({ name: ent.name, path: childRel, type: 'dir', children: this.#walkWorkspace(root, childRel, depth - 1) });
      } else {
        const st = fs.statSync(path.join(dir, ent.name));
        out.push({ name: ent.name, path: childRel, type: 'file', size: st.size, mtime: st.mtime.toISOString() });
      }
    }
    return out;
  }

  getBuiltinToolSchemas(bot) {
    const t = bot?.tools || {};
    const schemas = [];
    if (t.shell !== false) {
      schemas.push({
        type: 'function',
        function: {
          name: 'shell_exec',
          description: 'Run a shell command inside the bot workspace directory and inspect stdout/stderr.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to execute' },
              cwd: { type: 'string', description: 'Optional relative subdirectory inside workspace' },
            },
            required: ['command'],
          },
        },
      });
    }
    if (t.fs !== false) {
      schemas.push(
        {
          type: 'function',
          function: {
            name: 'fs_list',
            description: 'List files and directories inside the bot workspace.',
            parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path inside workspace (default ".")' } } },
          },
        },
        {
          type: 'function',
          function: {
            name: 'fs_read',
            description: 'Read a UTF-8 text file inside the bot workspace. Optionally pass 1-based startLine/endLine for large files.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                startLine: { type: 'integer', description: 'Optional 1-based start line' },
                endLine: { type: 'integer', description: 'Optional 1-based inclusive end line' },
              },
              required: ['path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'fs_write',
            description: 'Create or overwrite a UTF-8 file inside the bot workspace.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'foundry_create',
            description:
              'Create and Rust-verify a multi-modal studio deliverable: 3D model (glb, obj, stl), HD image (png, svg), music/audio track (wav), motion video (webm, mp4, gif), full-stack web app (webapp), playable HTML5 game (game), or document (pdf, docx, pptx, xlsx).',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short artifact title' },
                format: {
                  type: 'string',
                  description: 'Target format: glb, obj, stl, png, svg, wav, webm, mp4, gif, webapp, game, pdf, docx, pptx, xlsx, csv, zip',
                },
                prompt: { type: 'string', description: 'Creative brief describing subject, theme, archetype, or mechanics' },
                subtitle: { type: 'string', description: 'Optional subtitle or tagline' },
              },
              required: ['title', 'format'],
            },
          },
        }
      );
    }
    if (t.browser !== false) {
      schemas.push(
        {
          type: 'function',
          function: {
            name: 'browser_search',
            description: 'Search the live 2026 web cleanly via DuckDuckGo/Wikipedia and return titles, URLs, and snippets without fragile selector timeouts.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query terms' },
                indexResults: { type: 'boolean', description: 'Also save snippets into live 2026 Knowledge Base' },
              },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'browser_open',
            description: 'Open a web URL (or domain/search query) in the active browser mode and return title, excerpt, grounded interactiveElements selectors, and screenshot.',
            parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'browser_action',
            description:
              'Interact with the open page using a grounded selector from interactiveElements (supports open Shadow DOM >>). ' +
              'Actions: click, double_click, hover, click_percent, type, fill_form, drag, draw, press, scroll, back, forward, ' +
              'select, check, upload, extract_structured, snapshot.',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['click', 'double_click', 'hover', 'click_percent', 'type', 'fill_form', 'drag', 'draw', 'press', 'scroll', 'back', 'forward', 'select', 'check', 'upload', 'extract_structured', 'snapshot'],
                },
                selector: { type: 'string' },
                targetSelector: { type: 'string' },
                submitSelector: { type: 'string' },
                tableSelector: { type: 'string' },
                fields: { description: 'Array/map for fill_form or extract_structured' },
                path: { type: 'array', description: 'Array of {x,y} canvas coordinates for draw' },
                pathPct: { type: 'array', description: 'Array of {xPct,yPct} points for draw' },
                text: { type: 'string' },
                value: { type: 'string', description: 'Option for select; "false" to uncheck' },
                filePath: { type: 'string', description: 'Workspace-relative file for upload' },
                submit: { type: 'boolean' },
                key: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                xPct: { type: 'number' },
                yPct: { type: 'number' },
                direction: { type: 'string', enum: ['up', 'down'] },
              },
              required: ['action'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'browser_screenshot',
            description: 'Capture a fresh JPEG screenshot and interactiveElements map of the current browser page.',
            parameters: { type: 'object', properties: {} },
          },
        }
      );
    }
    if (t.memory !== false) {
      schemas.push(
        {
          type: 'function',
          function: {
            name: 'memory_save',
            description: 'Persist a fact or preference in this bot long-term memory store.',
            parameters: {
              type: 'object',
              properties: { key: { type: 'string' }, value: { type: 'string' } },
              required: ['key', 'value'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'memory_read',
            description: 'Read stored memories for this bot, optionally filtered by substring query.',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        }
      );
    }
    if (this.knowledge) {
      schemas.push(
        {
          type: 'function',
          function: {
            name: 'knowledge_search',
            description: 'Search Mimir local 2026 indexed web & document knowledge base.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'knowledge_ingest',
            description: 'Fetch a live URL or web topic into the persistent 2026 Knowledge Base for future RAG grounding.',
            parameters: { type: 'object', properties: { url: { type: 'string' }, query: { type: 'string' } } },
          },
        }
      );
    }
    if (t.vault !== false) {
      schemas.push({
        type: 'function',
        function: {
          name: 'vault_use',
          description: 'Resolve a saved credential from the local encrypted Vault. Provide fillSelector to type it directly into the open browser without exposing secret text.',
          parameters: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Vault entry label or ID' },
              field: { type: 'string', description: 'Field to fill (e.g. password, token, username)' },
              fillSelector: { type: 'string', description: 'Optional CSS selector in the open browser page' },
            },
            required: ['label'],
          },
        },
      });
    }
    schemas.push(
      {
        type: 'function',
        function: {
          name: 'bot_spawn',
          description: 'Autonomously create and persist a specialized child ally bot under your own privilege ceiling when a task explicitly calls for a persistent specialist.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Ally bot display name' },
              role: { type: 'string', description: 'Specialist role summary' },
              systemPrompt: { type: 'string', description: 'System instructions for the child ally' },
              specialistTag: { type: 'string', description: 'Short tag (e.g. research, code, qa)' },
              allowedTools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requested subset of tool or capability names (strictly intersected with parent permissions)',
              },
              executionMode: { type: 'string', enum: ['agent', 'code', 'chat'] },
            },
            required: ['name', 'role'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'subagent_loop',
          description: 'Delegate a bounded subtask to an existing ally bot (by botId or specialist role) and return its concise summary. Max depth is 2.',
          parameters: {
            type: 'object',
            properties: {
              botId: { type: 'string', description: 'Optional target ally bot ID' },
              role: { type: 'string', description: 'Optional specialist tag or role to resolve an ally bot' },
              goal: { type: 'string', description: 'Specific bounded goal for the subagent' },
              maxSteps: { type: 'number', description: 'Bounded step budget (1-8)' },
              depth: { type: 'number', description: 'Current subagent nesting depth (rejected if > 2)' },
            },
            required: ['goal'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'council_convene',
          description: 'Convene the multi-model/multi-bot Model Council on a topic for parallel opinions, anonymized peer ranking, and chairman consensus.',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'Question or architecture topic for council debate' },
              mode: { type: 'string', enum: ['standard', 'fast', 'deep'] },
              useRag: { type: 'boolean', description: 'Ground debate with RAG context' },
              seatIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['topic'],
          },
        },
      }
    );
    return schemas.filter(schema => isToolAllowedForBot(bot, getToolSchemaName(schema)));
  }

  #resolveSubagentBot(parentBot, { botId, role } = {}) {
    // Restrict subagent delegation strictly to child bots owned by parentBot (prevents cross-bot privilege jumps).
    const ownedChildren = this.store.listBots().filter(b => parentBot?.id && b.parentBotId === parentBot.id);
    if (botId) {
      const targetId = String(botId);
      const direct = ownedChildren.find(b => b.id === targetId);
      if (direct) return direct;
      return null;
    }
    const needle = String(role || '').trim().replace(/^@+/, '').toLowerCase();
    if (!needle) return null;
    let best = null;
    let bestScore = 0;
    for (const candidate of ownedChildren) {
      const tag = String(candidate.specialistTag || '').toLowerCase();
      const name = String(candidate.name || '').toLowerCase();
      const candRole = String(candidate.role || '').toLowerCase();
      let score = 0;
      if (tag && tag === needle) score = 10;
      else if (name === needle || candRole === needle) score = 8;
      else if ((tag && tag.includes(needle)) || name.includes(needle) || candRole.includes(needle)) score = 5;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  async executeTool({ bot, toolName, args = {}, dispatchMap, context = {} }) {
    const workspace = this.store.getBotWorkspace(bot.id);
    const t = bot?.tools || {};
    const redact = txt => (this.vault?.redactText ? this.vault.redactText(txt) : txt);
    let rawOutput;

    try {
      if (!isToolAllowedForBot(bot, toolName)) {
        throw new Error(`Tool ${toolName} is not allowed for bot ${bot?.id || 'unknown'}`);
      }

      if (toolName === 'shell_exec') {
        if (t.shell === false) throw new Error('shell_exec is disabled for this bot');
        const cwd = args.cwd ? resolveSafePath(workspace, args.cwd) : workspace;
        const { stdout, stderr } = await new Promise((resolve, reject) => {
          const maxBytes = 256 * 1024;
          const child = spawn(String(args.command || ''), {
            shell: true,
            cwd,
            windowsHide: true,
            detached: process.platform !== 'win32',
          });
          let stdout = '';
          let stderr = '';
          let settled = false;
          const killTree = () => {
            if (!child.pid) return;
            if (process.platform === 'win32') {
              spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            } else {
              try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
            }
          };
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            killTree();
            reject(Object.assign(new Error('Command timed out after 20000ms'), { stdout, stderr }));
          }, 20000);
          const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            killTree();
            reject(Object.assign(new Error('Command aborted'), { stdout, stderr, name: 'AbortError' }));
          };
          context?.signal?.addEventListener?.('abort', onAbort, { once: true });
          const appendCap = (cur, chunk) => cur.length >= maxBytes ? cur : (cur + chunk).slice(0, maxBytes);
          child.stdout?.on('data', d => { stdout = appendCap(stdout, d.toString('utf8')); });
          child.stderr?.on('data', d => { stderr = appendCap(stderr, d.toString('utf8')); });
          child.on('error', err => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            context?.signal?.removeEventListener?.('abort', onAbort);
            reject(err);
          });
          child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            context?.signal?.removeEventListener?.('abort', onAbort);
            if (code === 0) resolve({ stdout, stderr });
            else reject(Object.assign(new Error(`Command failed (exit ${code})${stderr ? `: ${stderr.slice(0, 300)}` : ''}`), { code, stdout, stderr }));
          });
        });
        rawOutput = [stdout, stderr].filter(Boolean).join('\n').trim() || '(exit 0, no output)';
      } else if (toolName === 'fs_list') {
        if (t.fs === false) throw new Error('fs_list is disabled for this bot');
        const target = resolveSafePath(workspace, args.path || '.');
        const items = fs.readdirSync(target, { withFileTypes: true }).map(e => (e.isDirectory() ? `${e.name}/` : e.name));
        rawOutput = JSON.stringify({ path: args.path || '.', entries: items });
      } else if (toolName === 'fs_read') {
        if (t.fs === false) throw new Error('fs_read is disabled for this bot');
        const target = resolveSafePath(workspace, args.path);
        const content = fs.readFileSync(target, 'utf8');
        if (args.startLine != null || args.endLine != null) {
          const lines = content.split(/\r?\n/);
          const start = Math.max(1, Number(args.startLine || 1));
          const end = Math.min(lines.length, Number(args.endLine || lines.length));
          const numbered = lines.slice(start - 1, end).map((ln, idx) => `${start + idx}: ${ln}`).join('\n');
          rawOutput = numbered.length > 24000
            ? `${numbered.slice(0, 24000)}\n... [truncated range; narrow startLine/endLine]`
            : numbered;
        } else {
          rawOutput = content.length > 24000
            ? `${content.slice(0, 24000)}\n... [truncated at 24000/${content.length} chars; pass startLine/endLine to read more]`
            : content;
        }
      } else if (toolName === 'fs_write') {
        if (t.fs === false) throw new Error('fs_write is disabled for this bot');
        const target = resolveSafePath(workspace, args.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(args.content ?? ''), 'utf8');
        rawOutput = JSON.stringify({ ok: true, path: args.path, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8') });
      } else if (toolName === 'browser_search') {
        if (t.browser === false) throw new Error('browser_search is disabled for this bot');
        if (this.store.getSettings?.().localOnly) {
          throw new Error('Blocked by local-only policy: outbound web search is disabled');
        }
        const q = String(args.query || '').trim();
        const cacheKey = `search:${q.toLowerCase()}`;
        let results = this.scaleQueue?.getCached(cacheKey);
        if (!results) {
          results = await fetchLiveSearch(q, 6);
          if (results.length) this.scaleQueue?.setCached(cacheKey, results, 90000);
        }
        if (args.indexResults !== false && this.knowledge && results.length) {
          this.knowledge.ingestDocument({
            title: `2026 Search: ${q}`,
            source: 'browser-search',
            url: results[0]?.url || '',
            content: results.map(r => `${r.title} (${r.url}): ${r.snippet}`).join('\n'),
            yearTag: '2026',
          });
        }
        rawOutput = JSON.stringify({ query: q, results });
      } else if (toolName === 'browser_open') {
        if (t.browser === false) throw new Error('browser_open is disabled for this bot');
        if (this.store.getSettings?.().localOnly && !isLoopbackUrl(args.url)) {
          throw new Error('Blocked by local-only policy: non-loopback browser URLs are disabled');
        }
        const res = await this.browser.open(bot.id, args.url);
        rawOutput = JSON.stringify({
          mode: res.mode,
          url: res.url,
          title: res.title,
          captchaDetected: res.captchaDetected,
          interactiveElements: (res.interactiveElements || []).slice(0, 12),
          excerpt: res.excerpt,
        });
      } else if (toolName === 'browser_action') {
        if (t.browser === false) throw new Error('browser_action is disabled for this bot');
        const res = await this.browser.action(bot.id, args);
        rawOutput = JSON.stringify({
          mode: res.mode,
          url: res.url,
          title: res.title,
          browserState: res.browserState,
          controlMode: res.controlMode,
          agentCursor: res.agentCursor,
          interactiveElements: (res.interactiveElements || []).slice(0, 12),
          excerpt: res.excerpt,
          ...(res.structured ? { structured: res.structured } : {}),
          ...(res.uploaded ? { uploaded: res.uploaded } : {}),
          ...(res.downloaded?.length ? { downloaded: res.downloaded } : {}),
        });
      } else if (toolName === 'browser_screenshot') {
        if (t.browser === false) throw new Error('browser_screenshot is disabled for this bot');
        const res = await this.browser.screenshot(bot.id);
        rawOutput = JSON.stringify({
          mode: res.mode,
          url: res.url,
          title: res.title,
          interactiveElements: (res.interactiveElements || []).slice(0, 12),
          captured: true,
        });
      } else if (toolName === 'knowledge_search') {
        if (!this.knowledge) throw new Error('Knowledge base not initialized');
        const hits = this.knowledge.query(String(args.query || ''), 5);
        rawOutput = JSON.stringify({ query: args.query, hits });
      } else if (toolName === 'knowledge_ingest') {
        if (!this.knowledge) throw new Error('Knowledge base not initialized');
        const isLocalOnly = Boolean(this.store.getSettings?.().localOnly);
        if (args.url) {
          if (isLocalOnly && !isLoopbackUrl(args.url)) {
            throw new Error('Blocked by local-only policy: remote URL ingestion is disabled');
          }
          const page = await fetchUrlText(args.url);
          const ingested = this.knowledge.ingestDocument({
            title: page.title,
            source: 'url-fetch',
            url: page.url,
            content: page.text,
            yearTag: '2026',
          });
          rawOutput = JSON.stringify({ ok: true, ...ingested });
        } else {
          if (isLocalOnly) {
            throw new Error('Blocked by local-only policy: remote web search ingestion is disabled');
          }
          const res = await this.knowledge.ingestFromWebQuery(String(args.query || ''), 4);
          rawOutput = JSON.stringify({ ok: true, indexedDocs: res.indexedDocs, count: res.results.length });
        }
      } else if (toolName === 'memory_save') {
        if (t.memory === false) throw new Error('memory_save is disabled for this bot');
        this.store.saveMemory(bot.id, args.key, args.value);
        rawOutput = JSON.stringify({ ok: true, key: args.key });
      } else if (toolName === 'memory_read') {
        if (t.memory === false) throw new Error('memory_read is disabled for this bot');
        const all = this.store.getMemories(bot.id);
        const q = String(args.query || '').toLowerCase();
        const filtered = q ? all.filter(m => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)) : all;
        rawOutput = JSON.stringify(filtered);
      } else if (toolName === 'vault_use') {
        if (t.vault === false) throw new Error('vault_use is disabled for this bot');
        const entry = this.vault.resolveSecret(args.label);
        if (!entry) throw new Error(`Vault entry not found: ${args.label}`);
        const fieldName = args.field || (entry.kind === 'login' ? 'password' : 'value');
        const val = entry.fields?.[fieldName] || entry.fields?.token || entry.fields?.password || '';
        if (args.fillSelector) {
          await this.browser.action(bot.id, { action: 'type', selector: args.fillSelector, text: val });
          rawOutput = JSON.stringify({ ok: true, label: entry.label, filledSelector: args.fillSelector, redacted: true });
        } else {
          rawOutput = JSON.stringify({
            ok: true,
            label: entry.label,
            kind: entry.kind,
            username: entry.fields?.username || null,
            availableFields: Object.keys(entry.fields || {}),
            note: 'Pass fillSelector to inject credential directly into a browser field without exposing plaintext.',
          });
        }
      } else if (toolName === 'bot_spawn') {
        const name = String(args.name || args.role || 'Specialist Ally').trim().slice(0, 80);
        const role = String(args.role || 'Autonomous Specialist').trim().slice(0, 120);
        if (!name) throw new Error('bot_spawn requires name or role');
        const specialistTag = String(args.specialistTag || role)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || 'specialist';

        const { childTools, childAllowedTools } = intersectBotToolPermissions(bot, args.allowedTools);
        const modeRank = { chat: 0, code: 1, agent: 2 };
        const parentMode = ['agent', 'code', 'chat'].includes(bot.executionMode) ? bot.executionMode : 'agent';
        const reqMode = ['agent', 'code', 'chat'].includes(args.executionMode) ? args.executionMode : parentMode;
        const childMode = (modeRank[reqMode] ?? 2) <= (modeRank[parentMode] ?? 2) ? reqMode : parentMode;

        const parentMcpIds = Array.isArray(bot.allowedMcpIds) ? bot.allowedMcpIds : [];
        const hasReqMcp = Array.isArray(args.allowedMcpIds);
        const reqMcpIds = hasReqMcp ? args.allowedMcpIds : parentMcpIds;
        let childMcpIds = parentMcpIds.length > 0
          ? reqMcpIds.filter(id => parentMcpIds.includes(id))
          : reqMcpIds.filter(Boolean);
        // Prevent empty array from resetting MCP restrictions to all enabled servers
        if ((hasReqMcp && args.allowedMcpIds.length === 0) || (parentMcpIds.length > 0 && childMcpIds.length === 0) || parentMcpIds.includes('__none__')) {
          childMcpIds = ['__none__'];
        }

        const newBotId = `bot-${crypto.randomBytes(4).toString('hex')}`;
        const created = this.store.createBot({
          id: newBotId,
          name,
          role,
          systemPrompt:
            String(args.systemPrompt || '').trim() ||
            `You are ${name} (${role}), a specialized child ally of ${bot.name || bot.id}. Stay strictly inside your workspace and granted tools.`,
          modelOverride: bot.modelOverride || '',
          tools: childTools,
          allowedTools: childAllowedTools,
          allowedMcpIds: childMcpIds,
          executionMode: childMode,
          parentBotId: bot.id,
          specialistTag,
          isTeamBot: true,
        });
        const childWorkspace = this.store.getBotWorkspace(created.id);
        if (this.store.sandboxesDir) {
          const normRoot = path.resolve(this.store.sandboxesDir);
          const normChild = path.resolve(childWorkspace);
          const cmpRoot = process.platform === 'win32' ? normRoot.toLowerCase() : normRoot;
          const cmpChild = process.platform === 'win32' ? normChild.toLowerCase() : normChild;
          if (!cmpChild.startsWith(cmpRoot + path.sep)) {
            throw new Error('Spawned bot workspace escaped sandboxes directory');
          }
        }
        const safeBot = {
          id: created.id,
          name: created.name,
          role: created.role,
          specialistTag: created.specialistTag,
          parentBotId: created.parentBotId,
          executionMode: created.executionMode,
          tools: created.tools,
          allowedTools: created.allowedTools || childAllowedTools,
        };
        this.onEvent?.('bot:spawned', { parentBotId: bot.id, bot: safeBot });
        this.onEvent?.('swarm:step', {
          id: `spawn-${created.id}`,
          icon: 'subagent',
          label: `Spawned ally · ${created.name}`,
          detail: `${created.specialistTag} (${childAllowedTools.length} tools)`,
          status: 'done',
          botId: created.id,
          parentBotId: bot.id,
        });
        rawOutput = JSON.stringify({ ok: true, bot: safeBot, allowedTools: safeBot.allowedTools, workspace: childWorkspace });
      } else if (toolName === 'subagent_loop') {
        const baseDepth = Number(context?.depth || 0);
        const argDepth = args.depth !== undefined && args.depth !== null ? Number(args.depth) : baseDepth + 1;
        const effectiveDepth = Math.max(baseDepth + 1, argDepth);
        if (!Number.isFinite(effectiveDepth) || effectiveDepth < 1 || effectiveDepth > MAX_SUBAGENT_DEPTH) {
          throw new Error(`Subagent depth ${effectiveDepth} exceeds MAX_SUBAGENT_DEPTH (${MAX_SUBAGENT_DEPTH})`);
        }
        const goal = String(args.goal || '').trim();
        if (!goal) throw new Error('subagent_loop requires a non-empty goal');
        const targetBot = this.#resolveSubagentBot(bot, { botId: args.botId, role: args.role });
        if (!targetBot) {
          throw new Error(`Target ally bot not found for botId="${args.botId || ''}" role="${args.role || ''}"`);
        }
        const subFn = context?.runSubagentTurn || this.runSubagentTurn;
        if (typeof subFn !== 'function') {
          throw new Error('runSubagentTurn hook is not configured');
        }
        const maxSteps = Math.max(1, Math.min(Number(args.maxSteps) || 4, 8));
        const stepId = `sub-${targetBot.id}-${effectiveDepth}-${Date.now().toString(36)}`;
        this.onEvent?.('swarm:step', {
          id: stepId,
          icon: 'subagent',
          label: `Subagent · ${targetBot.name}`,
          detail: `depth ${effectiveDepth}/${MAX_SUBAGENT_DEPTH} · ${goal.slice(0, 90)}`,
          status: 'running',
          parentBotId: bot.id,
          botId: targetBot.id,
          depth: effectiveDepth,
        });
        try {
          const subRes = await subFn({
            parentBot: bot,
            bot: targetBot,
            botId: targetBot.id,
            goal,
            maxSteps,
            depth: effectiveDepth,
            threadId: context?.threadId || null,
            signal: context?.signal || null,
          });
          const reply = String(subRes?.reply || subRes?.summary || '');
          const stepsUsed = Number(subRes?.stepsUsed ?? subRes?.steps ?? 1);
          const summary = String(subRes?.summary || reply).slice(0, 500);
          const ok = subRes?.ok !== false;
          this.onEvent?.('swarm:step', {
            id: stepId,
            icon: 'subagent',
            label: `Subagent · ${targetBot.name}`,
            detail: `${stepsUsed} step(s) · depth ${effectiveDepth}`,
            status: ok ? 'done' : 'warn',
            parentBotId: bot.id,
            botId: targetBot.id,
            depth: effectiveDepth,
          });
          rawOutput = JSON.stringify({
            ok,
            botId: targetBot.id,
            reply,
            stepsUsed,
            summary,
          });
        } catch (subErr) {
          this.onEvent?.('swarm:step', {
            id: stepId,
            icon: 'subagent',
            label: `Subagent · ${targetBot.name}`,
            detail: subErr?.message || String(subErr),
            status: 'warn',
            parentBotId: bot.id,
            botId: targetBot.id,
            depth: effectiveDepth,
          });
          throw subErr;
        }
      } else if (toolName === 'council_convene') {
        const topic = String(args.topic || '').trim();
        if (!topic) throw new Error('council_convene requires a topic');
        const councilFn = context?.conveneCouncil || this.conveneCouncil;
        if (typeof councilFn !== 'function') {
          throw new Error('conveneCouncil hook is not configured');
        }
        const res = await councilFn({
          topic,
          threadId: context?.threadId || null,
          seatIds: Array.isArray(args.seatIds) ? args.seatIds : null,
          mode: args.mode || 'standard',
          useRag: args.useRag !== false,
          signal: context?.signal || null,
        });
        const consensus = String(
          res?.consensus ||
            res?.synthesis ||
            res?.finalSynthesis ||
            res?.chairmanSynthesis ||
            res?.stage3?.consensus ||
            res?.stage3?.synthesis ||
            ''
        );
        rawOutput = JSON.stringify({
          ok: res?.ok !== false,
          consensus,
          leaderboard: Array.isArray(res?.leaderboard) ? res.leaderboard : [],
          actionItems: Array.isArray(res?.actionItems) ? res.actionItems : [],
          ...(res?.runId || res?.id ? { runId: res.runId || res.id } : {}),
        });
      } else if (toolName === 'foundry_create') {
        if (!this.foundry) {
          rawOutput = 'ERROR: Artifact Foundry is not configured in this process.';
        } else {
          const fmt = String(args?.format || 'glb').toLowerCase();
          const art = await this.foundry.createArtifact({
            title: args?.title || '',
            subtitle: args?.subtitle || '',
            prompt: args?.prompt || args?.description || args?.subtitle || args?.title || '',
            format: fmt,
            sections: Array.isArray(args?.sections) ? args.sections : [],
            creative: args?.creative || null,
            botId: bot.id,
          });
          rawOutput = JSON.stringify({
            ok: true,
            artifact: {
              id: art.id,
              title: art.title,
              subtitle: art.subtitle || '',
              format: art.format,
              kind: art.kind,
              previewKind: art.previewKind || art.kind,
              size_bytes: art.size_bytes,
              sha256: art.sha256,
              file_path: art.file_path,
              verified: Boolean(art.verified),
              archetype: art.archetype,
              hasWebmPreview: Boolean(art.hasWebmPreview),
            },
          });
        }
      } else if (dispatchMap?.has(toolName)) {
        const target = dispatchMap.get(toolName);
        const res = await this.mcpManager.callTool(target.serverId, target.toolName, args);
        rawOutput = typeof res === 'string' ? res : JSON.stringify(res);
      } else {
        throw new Error(`Unknown or unavailable tool: ${toolName}`);
      }

      const scrubbed = redact(String(rawOutput ?? ''));
      this.#pushActivity(bot.id, { toolName, argsSummary: JSON.stringify(args).slice(0, 120), ok: true, output: scrubbed.slice(0, 400) });
      return scrubbed;
    } catch (err) {
      let msg = redact(err?.message || String(err));
      const wsSlash = workspace.replace(/\\/g, '/');
      msg = msg.replaceAll(workspace, '<workspace>').replaceAll(wsSlash, '<workspace>');
      this.#pushActivity(bot.id, { toolName, argsSummary: JSON.stringify(args).slice(0, 120), ok: false, error: msg });
      return `ERROR: ${msg}`;
    }
  }
}
