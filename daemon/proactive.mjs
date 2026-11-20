import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Mimir 24/7 proactive engine: the single scheduler for routines.
 *
 * Guarantees (single host, while the coordinator process is running):
 *  - Every run is journaled to the store BEFORE it executes, so a crash leaves evidence.
 *  - Runs left "running" by a previous process are marked interrupted and retried on boot.
 *  - Time the host was asleep/off is coalesced: a missed slot fires once, never N times.
 *  - A daily slot fires at most once per local day; failures retry with backoff, then dead-letter.
 *  - Pause, quiet hours and a daily run budget are checked before any run starts.
 *
 * Delivery is at-least-once: an interrupted run is re-executed from the start. Actions with
 * external side effects stay behind the runner's approval gate, which is what prevents duplicates.
 *
 * ponytail: single-host journal in store.json. Multi-worker hosts should move run claims onto the
 * Rust WAL queue (rust-bridge enqueue/claim with idempotency_key = slotKey).
 */

const MINUTE = 60_000;
const MAX_RUN_HISTORY = 200;
const MAX_FEED = 100;
const DEFAULTS = {
  paused: false,
  quietHours: null, // { start: 'HH:MM', end: 'HH:MM' } local time, or null
  maxRunsPerDay: 48,
  digestAt: '08:00', // local time, '' disables the daily digest
  retryBaseMs: MINUTE,
  fileCooldownMs: MINUTE,
};
const FILE_DEBOUNCE_MS = 2000;
const ROUTINE_QUEUE = 'routines';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseHHMM(value) {
  if (typeof value !== 'string' || !HHMM.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function localDayKey(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

function localTimeToday(ms, minutes) {
  const d = new Date(ms);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

export function isInQuietHours(ms, quietHours) {
  const start = parseHHMM(quietHours?.start);
  const end = parseHHMM(quietHours?.end);
  if (start === null || end === null || start === end) return false;
  const now = minutesOfDay(ms);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export class ProactiveEngine {
  constructor({ store, routines, broadcast, rustBridge = null, getPendingApprovals = () => [] }) {
    this.rustBridge = rustBridge;
    this.watchers = new Map(); // routineId -> { path, handle }
    this.watchErrors = new Map(); // routineId -> path that failed to watch
    this.fileEvents = new Map(); // routineId -> ms of latest change
    this.store = store;
    this.routines = routines;
    this.broadcast = broadcast;
    this.getPendingApprovals = getPendingApprovals;
    this.bootId = crypto.randomBytes(6).toString('hex');
    this.bootedAt = new Date().toISOString();
    this.lastTickAt = null;
    this.timer = null;
    this.ticking = false;
  }

  get state() {
    const s = this.store.state;
    if (!s.proactive) s.proactive = { config: {}, runs: [], feed: [], lastDigestDay: null, budgetAlertDay: null };
    return s.proactive;
  }

  getConfig() {
    return { ...DEFAULTS, ...this.state.config };
  }

  updateConfig(patch = {}) {
    const next = { ...this.state.config };
    if ('paused' in patch) next.paused = Boolean(patch.paused);
    if ('maxRunsPerDay' in patch) {
      const n = Number(patch.maxRunsPerDay);
      if (!Number.isInteger(n) || n < 0 || n > 1000) throw badRequest('maxRunsPerDay must be an integer 0-1000');
      next.maxRunsPerDay = n;
    }
    if ('digestAt' in patch) {
      if (patch.digestAt !== '' && parseHHMM(patch.digestAt) === null) throw badRequest('digestAt must be HH:MM or empty');
      next.digestAt = patch.digestAt;
    }
    if ('quietHours' in patch) {
      const q = patch.quietHours;
      if (q === null) next.quietHours = null;
      else if (parseHHMM(q?.start) === null || parseHHMM(q?.end) === null) throw badRequest('quietHours needs start and end as HH:MM');
      else next.quietHours = { start: q.start, end: q.end };
    }
    this.state.config = next;
    this.store.save();
    this.broadcast?.('proactive:updated', this.getStatus());
    return this.getConfig();
  }

  pause(reason = 'manual') {
    if (this.getConfig().paused) return;
    this.state.config = { ...this.state.config, paused: true };
    this.#pushFeed('alert', 'Proactive runs paused', `Paused by ${reason}. Nothing scheduled will start until resumed.`);
    this.store.save();
    this.broadcast?.('proactive:updated', this.getStatus());
  }

  #pushFeed(kind, title, body) {
    const item = { id: `feed-${crypto.randomBytes(5).toString('hex')}`, kind, title, body, at: new Date().toISOString(), read: false };
    this.state.feed.unshift(item);
    if (this.state.feed.length > MAX_FEED) this.state.feed.length = MAX_FEED;
    this.broadcast?.('proactive:feed', item);
    return item;
  }

  markFeedRead() {
    for (const f of this.state.feed) f.read = true;
    this.store.save();
  }

  #lastRunFor(routineId) {
    return this.state.runs.find(r => r.routineId === routineId) || null;
  }

  #runsOnDay(dayKey) {
    return this.state.runs.filter(r => localDayKey(Date.parse(r.startedAt)) === dayKey).length;
  }

  /** When the routine's schedule next wants a fresh run (ms), or null when it has no schedule. */
  nextDueAt(routine, now) {
    if (!routine.enabled) return null;
    const slot = this.#dailySlot(routine, now);
    if (slot) {
      // A routine created after the slot waits for the next one instead of firing as a "catch-up".
      const owed = routine.lastSlotKey !== slot.key && Date.parse(routine.createdAt || 0) <= slot.at;
      return owed ? slot.at : slot.nextAt;
    }
    if (routine.intervalMinutes > 0) {
      const last = routine.lastRunAt ? Date.parse(routine.lastRunAt) : 0;
      return last + routine.intervalMinutes * MINUTE;
    }
    return null;
  }

  /**
   * Most recent daily occurrence at or before `now` (today's, or yesterday's before today's time).
   * Looking back one occurrence is what lets a slot that fell inside quiet hours or a sleep that
   * crossed midnight still run once afterwards.
   */
  #dailySlot(routine, now) {
    const minutes = parseHHMM(routine.dailyAt);
    if (minutes === null) return null;
    const shiftDays = (ms, days) => {
      const d = new Date(ms);
      d.setDate(d.getDate() + days);
      return d.getTime();
    };
    // `weekdays` (0 = Sunday ... 6 = Saturday) limits the schedule to those days; empty means every day.
    const days = Array.isArray(routine.weekdays) && routine.weekdays.length ? routine.weekdays : null;
    const allowed = ms => !days || days.includes(new Date(ms).getDay());
    const todayAt = localTimeToday(now, minutes);
    let at = todayAt <= now ? todayAt : shiftDays(todayAt, -1);
    for (let i = 0; i < 7 && !allowed(at); i += 1) at = shiftDays(at, -1);
    let nextAt = shiftDays(at, 1);
    for (let i = 0; i < 7 && !allowed(nextAt); i += 1) nextAt = shiftDays(nextAt, 1);
    return { at, nextAt, key: `${routine.id}:d:${localDayKey(at)}` };
  }

  #slotKey(routine, now) {
    const slot = this.#dailySlot(routine, now);
    if (slot) return slot.key;
    return `${routine.id}:i:${Math.floor(now / (routine.intervalMinutes * MINUTE))}`;
  }

  /** Runs left "running" by a dead process can never finish; hand them back to the retry path. */
  #recoverInterrupted(now) {
    let recovered = 0;
    for (const run of this.state.runs) {
      if (run.status !== 'running' || run.bootId === this.bootId) continue;
      run.status = 'interrupted';
      run.finishedAt = new Date(now).toISOString();
      run.error = 'Coordinator stopped while this run was in progress';
      run.nextRetryAt = now;
      // Routines with outside side effects can opt out of the automatic re-run (at-most-once).
      const routine = this.routines.listRoutines().find(r => r.id === run.routineId);
      if (routine?.retryInterrupted === false) run.noRetry = true;
      recovered += 1;
    }
    if (recovered) {
      this.#pushFeed('alert', 'Recovered interrupted runs', `${recovered} run(s) were cut off by a restart and are queued to retry.`);
      this.store.save();
    }
    return recovered;
  }

  /** Decide what should start right now. Pure with respect to time: everything derives from `now`. */
  #plan(now) {
    const cfg = this.getConfig();
    const due = [];
    for (const routine of this.routines.listRoutines()) {
      if (!routine.enabled || this.routines.inFlight.has(routine.id)) continue;
      const last = this.#lastRunFor(routine.id);
      if (last?.status === 'running') continue;
      const maxAttempts = Math.max(1, Number(routine.maxAttempts) || 3);
      if (last && (last.status === 'failed' || last.status === 'interrupted')) {
        if (last.attempt < maxAttempts && !last.noRetry) {
          if (last.nextRetryAt <= now) due.push({ routine, slotKey: last.slotKey, attempt: last.attempt + 1, maxAttempts });
          continue;
        }
        this.#deadLetter(routine, last);
        continue;
      }
      const nextAt = this.nextDueAt(routine, now);
      if (nextAt !== null && nextAt <= now) {
        due.push({ routine, slotKey: this.#slotKey(routine, now), attempt: 1, maxAttempts });
        continue;
      }
      const fileSlot = this.#fileTriggerSlot(routine, now);
      if (fileSlot) due.push({ routine, slotKey: fileSlot, attempt: 1, maxAttempts });
    }
    return { cfg, due };
  }

  /** Keep one fs.watch per routine with a watchPath; record the time of the latest change. */
  #syncWatchers() {
    const wanted = new Map(this.routines.listRoutines().filter(r => r.enabled && r.watchPath).map(r => [r.id, r.watchPath]));
    for (const [id, w] of this.watchers) {
      if (wanted.get(id) === w.path) continue;
      w.handle.close();
      this.watchers.delete(id);
      this.fileEvents.delete(id);
    }
    for (const [id, watchPath] of wanted) {
      if (this.watchers.has(id) || this.watchErrors.get(id) === watchPath) continue;
      try {
        const handle = fs.watch(watchPath, () => this.fileEvents.set(id, Date.now()));
        handle.on('error', () => {
          try { handle.close(); } catch {}
          this.watchers.delete(id);
        });
        handle.unref?.();
        this.watchers.set(id, { path: watchPath, handle });
      } catch (err) {
        this.watchErrors.set(id, watchPath); // alert once per bad path, not every tick
        this.#pushFeed('alert', 'File trigger could not start', `Cannot watch "${watchPath}": ${err.message}`);
        this.store.save();
      }
    }
  }

  /**
   * A change fires once the path has been quiet for the debounce window. The cooldown stops a
   * routine that writes into its own watched folder from re-triggering itself in a tight loop.
   */
  #fileTriggerSlot(routine, now) {
    const changedAt = this.fileEvents.get(routine.id);
    if (!changedAt || now - changedAt < FILE_DEBOUNCE_MS) return null;
    const last = routine.lastRunAt ? Date.parse(routine.lastRunAt) : 0;
    if (now - last < this.getConfig().fileCooldownMs) return null;
    this.fileEvents.delete(routine.id);
    return `${routine.id}:f:${changedAt}`;
  }

  /**
   * Claim the slot in the Rust WAL ledger when it is running, so two coordinator processes sharing
   * a data dir cannot both run the same slot. Returns 'taken', a claimed task id, or null when the
   * ledger is unavailable (single-process journal still applies).
   */
  async #claimSlot(slotKey, attempt, routineId) {
    if (!this.rustBridge?.isRunning()) return null;
    const workerId = `mimir-${this.bootId}`;
    try {
      const out = await this.rustBridge.enqueueTask({
        idempotency_key: `routine:${slotKey}#${attempt}`,
        queue: ROUTINE_QUEUE,
        kind: 'routine_run',
        max_attempts: 1,
        payload: { routineId, slotKey, attempt },
      });
      if (out.deduplicated) return 'taken';
      // Tasks orphaned by a crash between enqueue and claim for this same slot are closed out as superseded.
      for (let i = 0; i < 5; i++) {
        const claimed = (await this.rustBridge.claimTask(workerId, { queue: ROUTINE_QUEUE, leaseMs: 30 * MINUTE })).task;
        if (!claimed) return null;
        if (claimed.id === out.task.id) return claimed.id;
        if (claimed.payload?.routineId === routineId && claimed.payload?.slotKey === slotKey) {
          await this.rustBridge.completeTask(claimed.id, workerId, { superseded: true });
        } else {
          await this.rustBridge.failTask(claimed.id, workerId, 'released foreign task').catch(() => {});
          return null;
        }
      }
      return null;
    } catch {
      return null; // ledger trouble must never block a scheduled run
    }
  }

  async #settleSlot(taskId, run) {
    if (!taskId) return;
    const workerId = `mimir-${this.bootId}`;
    try {
      if (run.status === 'ok') await this.rustBridge.completeTask(taskId, workerId, { runId: run.id });
      else await this.rustBridge.failTask(taskId, workerId, run.error || run.status);
    } catch {
      // The store journal is the source of truth for the UI; the ledger entry just expires.
    }
  }

  #deadLetter(routine, run) {
    run.status = 'dead';
    const dlq = this.store.state.routineDlq || (this.store.state.routineDlq = []);
    dlq.unshift({
      id: `dlq-${crypto.randomBytes(4).toString('hex')}`,
      routineId: routine.id,
      channel: 'run',
      error: run.error || 'failed',
      failedAt: new Date().toISOString(),
    });
    if (dlq.length > 50) dlq.length = 50;
    this.#pushFeed('alert', `Routine "${routine.name}" gave up`, `Failed ${run.attempt} time(s): ${run.error || 'unknown error'}. It will try again at its next scheduled slot.`);
    this.store.save();
  }

  async #execute({ routine, slotKey, attempt, maxAttempts }, now) {
    const run = {
      id: `run-${crypto.randomBytes(5).toString('hex')}`,
      routineId: routine.id,
      routineName: routine.name,
      slotKey,
      attempt,
      status: 'running',
      bootId: this.bootId,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
      error: null,
      threadId: null,
    };
    this.state.runs.unshift(run);
    if (this.state.runs.length > MAX_RUN_HISTORY) this.state.runs.length = MAX_RUN_HISTORY;
    routine.lastSlotKey = slotKey;
    this.store.save(); // journal first: a crash from here on is recoverable

    const claim = await this.#claimSlot(slotKey, attempt, routine.id);
    if (claim === 'taken') {
      run.status = 'skipped';
      run.error = 'Slot already claimed by another coordinator process';
      run.finishedAt = new Date().toISOString();
      routine.lastRunAt = run.startedAt; // the slot did run elsewhere; do not re-plan it every tick
      this.store.save();
      return run;
    }
    this.broadcast?.('proactive:run', run);

    let result;
    try {
      result = await this.routines.runRoutineNow(routine.id);
    } catch (err) {
      result = { ok: false, error: err?.message || String(err) };
    }
    run.finishedAt = new Date().toISOString();
    run.threadId = result.threadId || null;
    if (result.ok) {
      run.status = 'ok';
    } else {
      run.status = 'failed';
      run.error = String(result.error || 'failed').slice(0, 500);
      run.nextRetryAt = now + this.getConfig().retryBaseMs * 2 ** (attempt - 1);
    }
    await this.#settleSlot(claim, run);
    if (run.status === 'failed' && attempt >= maxAttempts) this.#deadLetter(routine, run);
    this.store.save();
    this.broadcast?.('proactive:run', run);
    return run;
  }

  #maybeDigest(now, cfg) {
    const at = parseHHMM(cfg.digestAt);
    const day = localDayKey(now);
    if (at === null || this.state.lastDigestDay === day || minutesOfDay(now) < at) return null;
    this.state.lastDigestDay = day;
    const since = now - 24 * 60 * MINUTE;
    const recent = this.state.runs.filter(r => Date.parse(r.startedAt) >= since);
    const count = status => recent.filter(r => r.status === status).length;
    const approvals = this.getPendingApprovals().length;
    const routines = this.routines.listRoutines();
    const scheduled = routines.filter(r => r.enabled && this.nextDueAt(r, now) !== null);
    const lines = [
      `Last 24h: ${count('ok')} ok, ${count('failed') + count('interrupted')} failed/interrupted, ${count('dead')} gave up.`,
      `${scheduled.length} routine(s) scheduled, ${routines.length - scheduled.length} manual or paused.`,
    ];
    if (approvals) lines.push(`${approvals} action(s) are waiting for your approval.`);
    const dlq = (this.store.state.routineDlq || []).length;
    if (dlq) lines.push(`${dlq} item(s) in the dead-letter queue need a look.`);
    if (!scheduled.length) lines.push('Nothing is scheduled. Add a routine with an interval or a daily time to put Mimir to work.');
    const item = this.#pushFeed('digest', `Daily digest for ${day}`, lines.join('\n'));
    this.store.save();
    return item;
  }

  /** One scheduler pass. Safe to call at any cadence; `now` is injectable for tests. */
  async tick(now = Date.now()) {
    if (this.ticking) return { skipped: 'tick already in progress', started: [] };
    this.ticking = true;
    try {
      this.lastTickAt = new Date(now).toISOString();
      this.#recoverInterrupted(now);
      this.#syncWatchers();
      const { cfg, due } = this.#plan(now);
      this.#maybeDigest(now, cfg);
      if (cfg.paused) return { skipped: 'paused', started: [] };
      if (isInQuietHours(now, cfg.quietHours)) return { skipped: 'quiet hours', started: [] };

      const day = localDayKey(now);
      const runnable = due.slice(0, Math.max(0, cfg.maxRunsPerDay - this.#runsOnDay(day)));
      if (due.length > runnable.length && this.state.budgetAlertDay !== day) {
        this.state.budgetAlertDay = day;
        this.#pushFeed('alert', 'Daily run budget reached', `${cfg.maxRunsPerDay} runs used today; ${due.length - runnable.length} due run(s) are held until tomorrow.`);
        this.store.save();
      }
      // Sequential on purpose: one small local model, and the runner has its own concurrency gate.
      const started = [];
      for (const job of runnable) started.push(await this.#execute(job, now));
      return { started: started.filter(r => r.status !== 'skipped') };
    } finally {
      this.ticking = false;
    }
  }

  start(pollMs = 30_000) {
    this.stop();
    this.tick().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const w of this.watchers.values()) w.handle.close();
    this.watchers.clear();
  }

  getStatus(now = Date.now()) {
    const cfg = this.getConfig();
    return {
      ...cfg,
      host: 'desktop', // runs only while this machine is awake and the coordinator is up
      schedulerRunning: Boolean(this.timer),
      inQuietHours: isInQuietHours(now, cfg.quietHours),
      bootedAt: this.bootedAt,
      lastTickAt: this.lastTickAt,
      runsToday: this.#runsOnDay(localDayKey(now)),
      upcoming: this.routines
        .listRoutines()
        .map(r => ({ routineId: r.id, name: r.name, nextAt: this.nextDueAt(r, now) }))
        .filter(u => u.nextAt !== null)
        .sort((a, b) => a.nextAt - b.nextAt)
        .map(u => ({ ...u, nextAt: new Date(Math.max(u.nextAt, now)).toISOString() })),
    };
  }

  getOverview() {
    return { status: this.getStatus(), runs: this.state.runs.slice(0, 50), feed: this.state.feed.slice(0, 50) };
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
