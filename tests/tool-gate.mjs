/**
 * Bench-only (not wired into the app: it did not improve accuracy, see docs/tool-gate-bench.json). Does this request show any sign of needing a tool? If not, a small local model is better off
 * with no tools at all: offered a tool, it tends to use one ("remember this", "convene a council")
 * on a plain question. Fails open: anything long, empty or ambiguous keeps the tools.
 */
const FILES = /\b(files?|folders?|director(?:y|ies)|workspace|documents?|downloadable|notes?|reports?|\S+\.(?:md|txt|json|js|mjs|ts|tsx|py|csv|html|pdf|docx?|xlsx?|yml|yaml|log))\b/i;
const MEMORY = /\b(remember|recall|remind me|what did i (?:tell|say|ask)|my (?:notes|memory|files|knowledge|docs))\b/i;
const WEB = /\b(online|internet|web ?(?:site|page|search)?|google|browse|url|latest|most recent|news|look (?:it |that )?up|find out|search (?:for|the|my))\b|https?:\/\/|www\.|\b[\w-]+\.(?:com|org|io|net|dev|ai)\b/i;
const ACTION = /\b(run|execute|install|npm|pip|git|command|terminal|shell|script|deploy|delete|download|upload|schedule|email|slack|calendar)\b/i;
const TEAM = /@[\w-]+|\b(?:ask the team|have the team|delegate|assign (?:this|it) to)\b/i;
const KNOWLEDGE = /\b(knowledge base|knowledge)\b/i;

const LONG_TEXT = 600;

export function needsToolsGate(userText) {
  const text = String(userText || '').trim();
  if (text.length < 2 || text.length > LONG_TEXT) return true;
  return [FILES, MEMORY, WEB, ACTION, TEAM, KNOWLEDGE].some(re => re.test(text));
}
