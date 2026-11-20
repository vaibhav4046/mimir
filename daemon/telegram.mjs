// Telegram bridge: approve or deny Mimir's pending approvals from a phone.
// Long polling only (no webhook, no public URL). The bot token lives in the vault (via tokenStore),
// never in settings, never in a response, never in a log or error message.
import fs from 'node:fs';
import crypto from 'node:crypto';

const TOKEN_RE = /^\d{3,20}:[A-Za-z0-9_-]{10,100}$/; // also keeps path characters out of the request URL
const PAIR_TTL_MS = 5 * 60_000;
const MAX_PAIR_ATTEMPTS = 5;
const STALE_MS = 120_000;
const SUMMARY_CAP = 300;
const MAX_TRACKED = 100;
const MAX_SEND_ATTEMPTS = 3;
const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|auth|cookie|credential|cvv|card|otp|session/i;
const SECRET_TEXT_RES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bBearer\s+\S+/gi,
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const httpError = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** A short, redacted, 300-character-max description of a tool call's arguments. */
export function summarizeArgs(toolName, args, redact = t => t) {
  if (toolName === 'vault_use') return '(hidden: uses a vault secret)';
  const walk = (v, depth = 0) => {
    if (typeof v === 'string') return redact(v);
    if (depth > 4 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice(0, 20).map(x => walk(x, depth + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY_RE.test(k) ? '[hidden]' : walk(x, depth + 1)]));
  };
  let s = '';
  try {
    s = JSON.stringify(walk(args ?? {})) ?? '';
  } catch {
    s = '(unreadable arguments)';
  }
  s = redact(s);
  for (const re of SECRET_TEXT_RES) s = s.replace(re, '[hidden]');
  return cap(s, SUMMARY_CAP);
}

export class TelegramBridge {
  #token = null;
  #abort = null;
  #loop = null;
  #timer = null;
  #offset = 0;
  #failures = 0;
  #fatal = false;
  #startedAt = 0;
  #pair = null; // { digest, expiresAt, attempts }
  #tracked = new Map(); // approval id -> entry
  #attempts = new Map(); // approval id -> failed sends
  #sendChain = Promise.resolve();
  #lastSend = 0;

  constructor({
    baseUrl = 'https://api.telegram.org',
    getSettings,
    tokenStore, // { get(): string, set(token), clear() }
    statePath,
    listPending, // () => pending approvals
    resolveApproval, // (id, decision) => boolean — the same function the UI route calls
    redact = t => t,
    fetchImpl = (...a) => globalThis.fetch(...a),
    pollTimeoutSec = 25,
    backoffBaseMs = 1000,
    backoffMaxMs = 60_000,
    minSendIntervalMs = 1100,
    reconcileMs = 5000,
    pairTtlMs = PAIR_TTL_MS,
    now = Date.now,
  }) {
    Object.assign(this, { baseUrl: String(baseUrl).replace(/\/+$/, ''), getSettings, tokenStore, statePath, listPending, resolveApproval, redact, fetchImpl, pollTimeoutSec, backoffBaseMs, backoffMaxMs, minSendIntervalMs, reconcileMs, pairTtlMs, now });
    this.running = false;
    this.lastError = '';
    this.chatId = null;
    this.botUsername = '';
    this.#loadState();
  }

  // ---- public API -------------------------------------------------------

  status() {
    return {
      connected: this.running && this.#failures === 0 && !this.#fatal,
      configured: Boolean(this.running || this.#fatal || this.tokenStore.get()),
      paired: Boolean(this.chatId),
      botUsername: this.botUsername,
      lastError: this.lastError,
      localOnly: Boolean(this.getSettings().localOnly),
      pairingOpen: Boolean(this.#pair && this.now() < this.#pair.expiresAt),
    };
  }

  /** Validate a token with getMe, save it to the vault, start polling and return a pairing code. */
  async connect(rawToken) {
    this.#assertAllowed();
    const token = String(rawToken || '').trim();
    if (!TOKEN_RE.test(token)) throw httpError(400, 'That does not look like a Telegram bot token. It looks like 123456789:ABC... and BotFather gives it to you.');
    await this.stop();
    this.#token = token;
    let me;
    try {
      me = await this.#call('getMe', {}, AbortSignal.timeout(10_000));
    } catch (err) {
      this.#token = null;
      throw err.telegram ? httpError(400, `Telegram did not accept that token (${err.message}).`) : httpError(502, `Could not reach Telegram: ${err.message}`);
    }
    this.tokenStore.set(token);
    this.chatId = null;
    this.botUsername = String(me?.username || '');
    this.#persist();
    this.#tracked.clear();
    this.#attempts.clear();
    this.lastError = '';
    await this.start();
    return { ...this.newPairingCode(), botUsername: this.botUsername };
  }

  /** Start polling with the saved token. Throws when Local-only mode is on. */
  async start() {
    if (this.#loop) return;
    this.#assertAllowed();
    const token = this.tokenStore.get();
    if (!token) return;
    this.#token = token;
    this.#fatal = false;
    this.#failures = 0;
    this.#offset = 0;
    this.#startedAt = this.now();
    this.#abort = new AbortController();
    this.running = true;
    this.#timer = setInterval(() => this.#reconcile(), this.reconcileMs);
    this.#timer.unref?.();
    this.#loop = this.#pollLoop().finally(() => {
      this.running = false;
    });
    if (this.chatId) this.#reconcile();
  }

  /** Stop polling and wait for the loop to finish. Safe to call repeatedly. */
  async stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#abort?.abort();
    await this.#loop?.catch(() => {});
    this.#loop = null;
    this.#token = null;
    this.#pair = null;
    this.running = false;
  }

  /** Forget the bot completely: token, paired chat, everything. */
  async disconnect() {
    await this.stop();
    this.tokenStore.clear();
    this.chatId = null;
    this.botUsername = '';
    this.lastError = '';
    this.#fatal = false;
    this.#tracked.clear();
    this.#attempts.clear();
    this.#persist();
    return this.status();
  }

  /** Forget the paired phone but keep the bot. */
  unpair() {
    this.chatId = null;
    this.#tracked.clear();
    this.#persist();
    return this.status();
  }

  /** A fresh single-use 6-digit code, valid for five minutes. Replaces any earlier code. */
  newPairingCode() {
    this.#assertAllowed();
    if (!this.running) throw httpError(409, 'Connect a Telegram bot first.', 'TELEGRAM_NOT_CONNECTED');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.#pair = { digest: sha(code), expiresAt: this.now() + this.pairTtlMs, attempts: 0 };
    return { code, expiresAt: new Date(this.#pair.expiresAt).toISOString() };
  }

  /** Feed coordinator broadcast events here. Never throws. */
  onEvent(event, data) {
    try {
      if (event === 'approval:requested' && data?.id) void this.#notify(data);
      else if (event === 'approval:resolved' && data?.id) void this.#onResolved(data);
    } catch (err) {
      this.#setError(err);
    }
  }

  // ---- plumbing ---------------------------------------------------------

  #assertAllowed() {
    if (this.getSettings().localOnly) {
      throw httpError(403, 'Phone approvals need the internet, but Local-only mode is on. Turn Local-only off in Settings to use Telegram.', 'LOCAL_ONLY');
    }
  }

  #scrub(message) {
    let s = String(message ?? '');
    if (this.#token) s = s.split(this.#token).join('***');
    return s.replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot***');
  }

  #setError(err) {
    if (this.#abort?.signal.aborted) return;
    this.lastError = this.#scrub(err?.message || err);
  }

  #loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (Number.isSafeInteger(s.chatId)) this.chatId = s.chatId;
      this.botUsername = String(s.botUsername || '');
    } catch {}
  }

  #persist() {
    try {
      if (!this.chatId && !this.botUsername) fs.rmSync(this.statePath, { force: true });
      else fs.writeFileSync(this.statePath, JSON.stringify({ chatId: this.chatId, botUsername: this.botUsername }), 'utf8');
    } catch (err) {
      this.#setError(err);
    }
  }

  async #call(method, payload, signal) {
    if (!this.#token) throw new Error('not connected');
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/bot${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal || AbortSignal.any([this.#abort?.signal, AbortSignal.timeout(15_000)].filter(Boolean)),
      });
    } catch (err) {
      throw Object.assign(new Error(this.#scrub(err?.cause?.message || err?.message || 'network error')), { network: true, aborted: err?.name === 'AbortError' });
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok || !body?.ok) {
      throw Object.assign(new Error(this.#scrub(body?.description || `HTTP ${res.status}`)), {
        telegram: true,
        status: res.status,
        retryAfter: Number(body?.parameters?.retry_after) || 0,
      });
    }
    return body.result;
  }

  #sleep(ms) {
    return new Promise((resolve, reject) => {
      const signal = this.#abort?.signal;
      if (signal?.aborted) return reject(new Error('stopped'));
      const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(t); reject(new Error('stopped')); };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Outgoing sends and edits are spaced out (Telegram allows about one message a second per chat). */
  #send(method, payload) {
    const run = async () => {
      const wait = this.#lastSend + this.minSendIntervalMs - this.now();
      if (wait > 0) await this.#sleep(wait);
      this.#lastSend = this.now();
      try {
        return await this.#call(method, payload);
      } catch (err) {
        if (err.status === 429 && err.retryAfter) this.#lastSend = this.now() + err.retryAfter * 1000 - this.minSendIntervalMs;
        throw err;
      }
    };
    const p = this.#sendChain.then(run, run);
    this.#sendChain = p.catch(() => {});
    return p;
  }

  async #quiet(promise) {
    try {
      return await promise;
    } catch (err) {
      this.#setError(err);
      return null;
    }
  }

  #answer(id, text, alert = false) {
    return this.#quiet(this.#call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }));
  }

  #edit(entry, text, keyboard = []) {
    if (!entry.messageId) return Promise.resolve(null);
    return this.#quiet(this.#send('editMessageText', { chat_id: entry.chatId, message_id: entry.messageId, text, reply_markup: { inline_keyboard: keyboard } }));
  }

  // ---- polling ----------------------------------------------------------

  async #pollLoop() {
    const signal = this.#abort.signal;
    while (!signal.aborted) {
      if (this.getSettings().localOnly) {
        this.lastError = 'Local-only mode is on, so phone approvals are paused.';
        break;
      }
      try {
        const updates = await this.#call(
          'getUpdates',
          { offset: this.#offset, timeout: this.pollTimeoutSec, allowed_updates: ['message', 'callback_query'] },
          AbortSignal.any([signal, AbortSignal.timeout((this.pollTimeoutSec + 15) * 1000)])
        );
        this.#failures = 0;
        this.lastError = '';
        for (const u of Array.isArray(updates) ? updates : []) {
          this.#offset = Math.max(this.#offset, Number(u.update_id) + 1);
          try {
            await this.#handleUpdate(u);
          } catch (err) {
            this.#setError(err);
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        if ([401, 403, 404].includes(err.status)) {
          this.#fatal = true;
          this.lastError = 'Telegram rejected the bot token. Remove the bot and connect it again in Settings.';
          break;
        }
        this.#failures++;
        const delay = err.retryAfter
          ? Math.min(err.retryAfter * 1000, this.backoffMaxMs)
          : Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** (this.#failures - 1));
        this.lastError = `Cannot reach Telegram (${err.message}). Retrying in ${Math.ceil(delay / 1000)}s.`;
        try {
          await this.#sleep(delay);
        } catch {
          break;
        }
      }
    }
  }

  async #handleUpdate(u) {
    if (u.callback_query) return this.#handleCallback(u.callback_query);
    const m = u.message;
    if (!m || typeof m.text !== 'string') return; // only text and button presses are handled
    if (Number(m.date) * 1000 < this.#startedAt - STALE_MS) return; // backlog from before startup
    const pairMatch = /^\/pair(?:@\w+)?\s+(\S+)\s*$/.exec(m.text.trim());
    if (!pairMatch || m.chat?.type !== 'private') return; // everything else is ignored silently
    const open = this.#pair && this.now() < this.#pair.expiresAt;
    if (!open) return;
    if (this.#tryPair(pairMatch[1], m.chat.id)) {
      await this.#quiet(this.#send('sendMessage', { chat_id: m.chat.id, text: 'Paired. Approval requests from Mimir will appear here.' }));
      this.#reconcile();
    } else {
      await this.#quiet(this.#send('sendMessage', { chat_id: m.chat.id, text: 'That code is not valid or has expired. Make a new one in Mimir Settings.' }));
    }
  }

  #tryPair(code, chatId) {
    const p = this.#pair;
    p.attempts++;
    const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(sha(code), p.digest);
    if (ok || p.attempts >= MAX_PAIR_ATTEMPTS) this.#pair = null;
    if (!ok || !Number.isSafeInteger(chatId)) return false;
    this.chatId = chatId;
    this.#persist();
    return true;
  }

  // ---- approvals --------------------------------------------------------

  #formatApproval(a) {
    const card = a.dialogueCard || {};
    return [
      'Mimir needs your OK',
      `Tool: ${cap(String(a.toolName || 'unknown'), 80)}`,
      a.reason ? `Why: ${cap(String(this.redact(String(a.reason))), SUMMARY_CAP)}` : '',
      `Details: ${summarizeArgs(a.toolName, a.args, this.redact)}`,
      `Risk: ${card.reversibilityLabel || 'Irreversible'}`,
    ].filter(Boolean).join('\n');
  }

  async #notify(a) {
    if (!this.chatId || !this.running || this.#tracked.has(a.id)) return;
    if ((this.#attempts.get(a.id) || 0) >= MAX_SEND_ATTEMPTS || this.getSettings().localOnly) return;
    const entry = {
      id: a.id,
      chatId: this.chatId,
      text: this.#formatApproval(a),
      risky: a.dialogueCard?.reversibility !== 'reversible', // only a known-reversible action skips the confirm step // only a known-reversible action skips the confirm step
      messageId: null,
      done: false,
      confirming: false,
      finalText: null,
    };
    this.#tracked.set(a.id, entry);
    for (const [id, e] of this.#tracked) {
      if (this.#tracked.size <= MAX_TRACKED) break;
      if (e.done) this.#tracked.delete(id);
    }
    const keyboard = [[{ text: 'Approve once', callback_data: `ap:${a.id}` }, { text: 'Deny', callback_data: `dn:${a.id}` }]];
    try {
      const msg = await this.#send('sendMessage', { chat_id: entry.chatId, text: entry.text, reply_markup: { inline_keyboard: keyboard } });
      entry.messageId = msg?.message_id ?? null;
      if (entry.finalText) await this.#edit(entry, entry.finalText);
    } catch (err) {
      this.#tracked.delete(a.id);
      this.#attempts.set(a.id, (this.#attempts.get(a.id) || 0) + 1);
      this.#setError(err);
    }
  }

  async #onResolved({ id, decision, approved }) {
    const entry = this.#tracked.get(id);
    if (!entry || entry.done) return; // done is set first when this bridge resolved it itself
    entry.done = true;
    const ok = typeof approved === 'boolean' ? approved : decision === 'approve-once' || decision === 'allow-session';
    entry.finalText = `${entry.text}\n\nResolved in the app (${ok ? 'approved' : 'denied'}).`;
    await this.#edit(entry, entry.finalText);
  }

  /** Catches approvals that vanished without an event (timeouts) and ones that appeared before pairing. */
  #reconcile() {
    if (!this.running || !this.chatId) return;
    let pending = [];
    try {
      pending = this.listPending() || [];
    } catch (err) {
      return this.#setError(err);
    }
    const live = new Set(pending.map(a => a.id));
    for (const entry of this.#tracked.values()) {
      if (entry.done || !entry.messageId || live.has(entry.id)) continue;
      entry.done = true;
      entry.finalText = `${entry.text}\n\nNo longer pending (resolved in the app, or it timed out).`;
      void this.#edit(entry, entry.finalText);
    }
    for (const a of pending) void this.#notify(a);
  }

  async #handleCallback(cb) {
    const from = cb.from?.id;
    if (!this.chatId || cb.message?.chat?.id !== this.chatId || from !== this.chatId) return; // not the paired phone: no reply
    const [action, id] = String(cb.data || '').split(':');
    const entry = this.#tracked.get(id);
    const live = (this.listPending() || []).some(a => a.id === id);
    if (!['ap', 'cf', 'dn'].includes(action) || !entry || entry.done || !live) {
      if (entry && !entry.done && !live) this.#reconcile();
      return void (await this.#answer(cb.id, 'That approval is no longer pending.', true));
    }
    if (action === 'dn') return this.#decide(entry, cb, 'deny');
    if (action === 'ap' && entry.risky) {
      entry.confirming = true;
      await this.#answer(cb.id, 'High-risk action. Tap Confirm to approve.');
      return void (await this.#edit(entry, `${entry.text}\n\nThis action cannot be undone. Confirm approval?`, [
        [{ text: 'Confirm approve', callback_data: `cf:${id}` }, { text: 'Deny', callback_data: `dn:${id}` }],
      ]));
    }
    if (action === 'cf' && !entry.confirming) return void (await this.#answer(cb.id, 'Tap Approve once first.', true));
    return this.#decide(entry, cb, 'approve-once');
  }

  async #decide(entry, cb, decision) {
    entry.done = true; // before resolving: the approval:resolved event fires synchronously and must not edit twice
    let ok = false;
    try {
      ok = this.resolveApproval(entry.id, decision);
    } catch (err) {
      this.#setError(err);
    }
    if (!ok) {
      entry.finalText = `${entry.text}\n\nNo longer pending (resolved in the app, or it timed out).`;
      await this.#answer(cb.id, 'Already resolved in the app.', true);
      return void (await this.#edit(entry, entry.finalText));
    }
    const approved = decision === 'approve-once';
    entry.finalText = `${entry.text}\n\n${approved ? 'Approved' : 'Denied'} from your phone.`;
    await this.#answer(cb.id, approved ? 'Approved' : 'Denied');
    await this.#edit(entry, entry.finalText);
  }
}
