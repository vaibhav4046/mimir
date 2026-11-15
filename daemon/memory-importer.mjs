import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runChatTurn } from './llm-provider.mjs';

/**
 * Discovers local AI memory / instruction / export files from Antigravity, Claude, and ChatGPT.
 */
export function scanLocalAiMemories() {
  const home = os.homedir();
  const candidates = [];

  const SENSITIVE_OR_NOISE_RE =
    /(credential|secret|token|auth|password|keychain|manifest|last-update|settings\.local|\.claude\.json$)/i;

  const probeDir = (dir, source, exts, maxFiles = 12) => {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (candidates.filter(c => c.source === source).length >= maxFiles) break;
        if (SENSITIVE_OR_NOISE_RE.test(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isFile() && exts.some(ext => ent.name.toLowerCase().endsWith(ext))) {
          const st = fs.statSync(full);
          if (st.size > 0 && st.size <= 2 * 1024 * 1024) {
            candidates.push({
              id: `${source}:${candidates.length}`,
              source,
              name: ent.name,
              path: full,
              size: st.size,
              mtime: st.mtime.toISOString(),
            });
          }
        }
      }
    } catch {}
  };

  // Antigravity artifacts & custom instructions
  probeDir(path.join(home, '.gemini'), 'antigravity', ['.md', '.json', '.txt'], 6);
  probeDir(path.join(home, '.gemini', 'config'), 'antigravity', ['.md', '.json'], 6);
  const agBrain = path.join(home, '.gemini', 'antigravity', 'brain');
  if (fs.existsSync(agBrain)) {
    try {
      const convs = fs.readdirSync(agBrain, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .slice(0, 5);
      for (const conv of convs) {
        probeDir(path.join(agBrain, conv.name), 'antigravity', ['.md', '.txt'], 4);
      }
    } catch {}
  }

  // Claude Code / Claude Desktop exports & instructions
  probeDir(path.join(home, '.claude'), 'claude', ['.md', '.json', '.txt'], 8);
  probeDir(path.join(home, 'AppData', 'Roaming', 'Claude'), 'claude', ['.json', '.md', '.txt'], 6);

  // Common ChatGPT / OpenAI export folders
  probeDir(path.join(home, 'Downloads'), 'chatgpt', ['.json', '.md', '.txt'], 6);

  return candidates;
}

/**
 * Parses raw text or JSON exports from Antigravity, Claude, ChatGPT, or custom notes.
 */
export function parseImportedContent({ source = 'custom', filename = 'memory.txt', text = '' }) {
  const raw = String(text || '').trim();
  if (!raw) return { source, filename, items: [] };

  const items = [];
  if (filename.toLowerCase().endsWith('.json') || raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.conversations)
          ? parsed.conversations
          : Array.isArray(parsed.memories)
            ? parsed.memories
            : [parsed];

      for (const entry of arr.slice(0, 30)) {
        if (typeof entry === 'string') {
          items.push(entry.slice(0, 400));
          continue;
        }
        // Claude export format: { name, summary, chat_messages: [{ text, sender }] }
        if (Array.isArray(entry.chat_messages)) {
          const snippets = entry.chat_messages
            .filter(m => m.sender === 'human')
            .slice(0, 6)
            .map(m => String(m.text || '').slice(0, 220));
          items.push(`${entry.name || 'Claude Chat'}: ${snippets.join(' | ')}`);
          continue;
        }
        // ChatGPT export format: { title, mapping: { id: { message: { author, content: { parts } } } } }
        if (entry.mapping && typeof entry.mapping === 'object') {
          const userMsgs = Object.values(entry.mapping)
            .map(n => n?.message)
            .filter(m => m?.author?.role === 'user' && Array.isArray(m?.content?.parts))
            .slice(0, 6)
            .map(m => m.content.parts.filter(p => typeof p === 'string').join(' ').slice(0, 220));
          items.push(`${entry.title || 'ChatGPT Thread'}: ${userMsgs.join(' | ')}`);
          continue;
        }
        if (entry.content || entry.memory || entry.value || entry.text) {
          items.push(String(entry.content || entry.memory || entry.value || entry.text).slice(0, 400));
          continue;
        }
        items.push(JSON.stringify(entry).slice(0, 350));
      }
      return { source, filename, items: items.filter(Boolean) };
    } catch {}
  }

  const lines = raw
    .split(/\r?\n+/)
    .map(l => l.trim())
    .filter(l => l.length > 3)
    .slice(0, 60);
  for (let i = 0; i < lines.length; i += 3) {
    items.push(lines.slice(i, i + 3).join(' '));
  }
  return { source, filename, items };
}

function heuristicAnalyzeWork(text) {
  const lower = text.toLowerCase();
  const domains = [];
  const tools = { shell: false, fs: true, browser: false, memory: true, vault: false };
  let shape = 'leviathan';
  let color = '#5cc8ff';
  let name = 'Valkyrie Automator';
  let role = 'Forged Work Automator';

  if (/(code|repo|git|test|build|npm|python|api|react|electron|debug|docker|server)/.test(lower)) {
    domains.push('Software Engineering & Builds');
    tools.shell = true;
    shape = 'mjolnir';
    color = '#5cc8ff';
    name = 'Brok Forge-Coder';
    role = 'Code, Test & Build Automator';
  }
  if (/(browser|scrape|website|url|dashboard|chrome|playwright|Monitor|price|page)/.test(lower)) {
    domains.push('Browser & Web Automation');
    tools.browser = true;
    if (domains.length === 1) {
      shape = 'crystal';
      color = '#d9a441';
      name = 'Heimdall Watcher';
      role = 'Web Monitor & Scraper';
    }
  }
  if (/(research|summary|notes|report|paper|docs|markdown|competitor|analyze)/.test(lower)) {
    domains.push('Research & Synthesis');
    tools.browser = true;
    if (domains.length === 1) {
      shape = 'mimir';
      color = '#38b87c';
      name = 'Mimir Lorekeeper';
      role = 'Research & Brief Automator';
    }
  }
  if (/(slack|teams|email|ops|alert|cron|schedule|daily|monitor|log|backup)/.test(lower)) {
    domains.push('Ops & Scheduled Reporting');
    tools.shell = true;
    if (domains.length === 1) {
      shape = 'shield';
      color = '#e85d2a';
      name = 'Tyr Sentinel';
      role = 'Ops & Alert Automator';
    }
  }
  if (domains.length === 0) {
    domains.push('General Desktop Workflow');
    tools.shell = true;
    tools.browser = true;
  }

  return {
    summary: `Detected focus areas (${domains.join(', ')}) across imported AI memory snippets.`,
    detectedDomains: domains,
    extractedMemories: [
      { key: 'imported_domains', value: domains.join(', ') },
      { key: 'work_context', value: text.slice(0, 320).replace(/\s+/g, ' ') },
    ],
    proposedBot: {
      name,
      role,
      shape,
      color,
      tools,
      systemPrompt: `You are ${name} (${role}), forged from the user's imported AI work memories (${domains.join(', ')}). Work context:\n${text.slice(0, 700)}\n\nAutomate tasks concisely using your tools, save durable findings in memory, and verify outputs cleanly.`,
      routineName: `${name} Daily Digest`,
      routinePrompt: `Review the workspace and imported context (${domains.join(', ')}), execute any pending checks or status notes, and write an updated summary in the workspace.`,
      intervalMinutes: 60,
    },
  };
}

function extractJsonBlock(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function analyzeWorkAndProposeBot({ settings, importedItems = [] }) {
  const combined = importedItems
    .flatMap(entry => entry.items || [String(entry)])
    .map(x => String(x).trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 5000);

  if (!combined) {
    return { hasMemory: false, needsQuestions: true };
  }

  const fallback = heuristicAnalyzeWork(combined);

  try {
    const prompt = [
      'Analyze these imported user AI memories/history snippets from Claude/Antigravity/ChatGPT and propose ONE custom automation bot in strict JSON only:',
      '{"summary":"...","detectedDomains":["..."],"extractedMemories":[{"key":"...","value":"..."}],"proposedBot":{"name":"...","role":"...","systemPrompt":"...","routineName":"...","routinePrompt":"...","tools":{"shell":true,"fs":true,"browser":false,"memory":true,"vault":false}}}',
      '\nImported snippets:\n' + combined.slice(0, 2500),
    ].join('\n');

    const res = await runChatTurn({
      settings,
      messages: [
        { role: 'system', content: 'Output strictly valid compact JSON with no markdown prose outside JSON.' },
        { role: 'user', content: prompt },
      ],
      tools: [],
      signal: AbortSignal.timeout(12000),
    });

    const parsed = extractJsonBlock(res.content);
    if (parsed?.proposedBot?.name && parsed?.proposedBot?.systemPrompt) {
      return {
        hasMemory: true,
        analyzedBy: `${res.provider}:${res.model}`,
        summary: String(parsed.summary || fallback.summary),
        detectedDomains: Array.isArray(parsed.detectedDomains) ? parsed.detectedDomains : fallback.detectedDomains,
        extractedMemories: Array.isArray(parsed.extractedMemories) && parsed.extractedMemories.length
          ? parsed.extractedMemories.slice(0, 6)
          : fallback.extractedMemories,
        proposedBot: {
          ...fallback.proposedBot,
          ...parsed.proposedBot,
          tools: { ...fallback.proposedBot.tools, ...(parsed.proposedBot.tools || {}) },
        },
      };
    }
  } catch {}

  return { hasMemory: true, analyzedBy: 'local-heuristic', ...fallback };
}

export async function synthesizeBotFromAnswers({ settings, answers }) {
  const domains = answers?.q1Domains || ['Engineering & Coding'];
  const tasks = answers?.q2Tasks || ['Automate recurring checks'];
  const toolChoices = answers?.q3Tools || ['Read & write workspace files', 'Remember facts across sessions'];
  const cadenceChoices = answers?.q4Schedule || ['Run starter automation now'];
  const botName = String(answers?.botName || '').trim() || 'Atreus Automator';
  const note = String(answers?.customNote || '').trim();

  const joinedTools = toolChoices.join(' ').toLowerCase();
  const tools = {
    shell: /shell|command|terminal/.test(joinedTools),
    fs: /file|workspace|read|write/.test(joinedTools) || true,
    browser: /browser|web|chromium|scrape/.test(joinedTools),
    memory: /memory|remember/.test(joinedTools) || true,
    vault: /vault|secret|login/.test(joinedTools),
  };

  const joinedCadence = cadenceChoices.join(' ').toLowerCase();
  const createRoutine = /hourly|daily|schedule|routine/.test(joinedCadence);
  const intervalMinutes = /hourly/.test(joinedCadence) ? 60 : /daily/.test(joinedCadence) ? 1440 : 0;
  const notifySlack = /slack/.test(joinedCadence);
  const notifyTeams = /teams/.test(joinedCadence);

  let shape = 'leviathan';
  let color = '#5cc8ff';
  const dLow = domains.join(' ').toLowerCase();
  if (/research|doc|summary/.test(dLow)) { shape = 'mimir'; color = '#38b87c'; }
  else if (/browser|web|scrape/.test(dLow)) { shape = 'crystal'; color = '#d9a441'; }
  else if (/ops|system|log/.test(dLow)) { shape = 'shield'; color = '#e85d2a'; }
  else if (/content|team|email/.test(dLow)) { shape = 'yggdrasil'; color = '#d9a441'; }

  const memories = [
    { key: 'forge_domains', value: domains.join(', ') },
    { key: 'forge_tasks', value: tasks.join('; ') },
    { key: 'forge_tools', value: toolChoices.join(', ') },
    { key: 'forge_cadence', value: cadenceChoices.join(', ') },
  ];
  if (note) memories.push({ key: 'user_note', value: note });

  const starterTaskPrompt = [
    `You have just been forged to automate the user's selected workflow (${domains.join(', ')}).`,
    `Target tasks: ${tasks.join('; ')}.`,
    note ? `Extra context: ${note}.` : '',
    'Perform the first concrete setup action in your workspace now (using available tools like fs_list / fs_write / memory_save or browser_open) and present a concise action report.',
  ].filter(Boolean).join('\n');

  let systemPrompt = `You are ${botName}, a custom Norse-forged automation agent specializing in: ${domains.join(', ')}.\nRecurring goals: ${tasks.join('; ')}.\n${note ? `User guidance: ${note}\n` : ''}Execute real steps via tools, verify every result honestly, and persist key facts in memory.`;

  try {
    const refined = await runChatTurn({
      settings,
      messages: [
        { role: 'system', content: 'Write a crisp, concise 3-sentence system prompt for an automation agent. Output plain text only.' },
        { role: 'user', content: `Name: ${botName}. Domains: ${domains.join(', ')}. Tasks: ${tasks.join('; ')}. Notes: ${note || 'none'}.` },
      ],
      tools: [],
      signal: AbortSignal.timeout(8000),
    });
    if (refined.content?.trim().length > 25) {
      systemPrompt = refined.content.trim();
    }
  } catch {}

  return {
    botConfig: {
      name: botName,
      role: `Forged Automator • ${domains[0] || 'Custom'}`,
      shape,
      color,
      tools,
      systemPrompt,
      isTeamBot: notifySlack || notifyTeams,
    },
    memories,
    starterTaskPrompt,
    routineConfig: createRoutine
      ? {
          name: `${botName} Schedule`,
          prompt: `Run automated task check for: ${tasks.join('; ')}. Summarize results concisely.`,
          intervalMinutes,
          enabled: true,
          notifySlack,
          notifyTeams,
        }
      : null,
  };
}
