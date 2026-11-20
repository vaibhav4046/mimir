import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { TeamRunView } from './TeamRunView.jsx';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const daysText = days => {
  if (!days?.length) return 'day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'weekday';
  return days.map(d => DAY_NAMES[d]).join(', ');
};
const triggerText = t =>
  t.type === 'daily'
    ? t.weekdays?.length ? `Every ${daysText(t.weekdays)} at ${t.dailyAt}` : `Every day at ${t.dailyAt}`
    : t.type === 'interval' ? `Every ${t.intervalMinutes >= 60 ? `${t.intervalMinutes / 60} h` : `${t.intervalMinutes} min`}`
    : t.type === 'file' ? `When ${t.watchPath} changes` : 'When you press Run';
const STEP_MARK = { done: 'Done', running: 'Working…', failed: 'Failed', waiting: 'Waiting', skipped: 'Skipped' };
const CONDITION_LABEL = {
  '': 'Always run this step',
  previous_mentions: 'Only if the earlier results mention…',
  previous_lacks: 'Only if the earlier results do not mention…',
  previous_nonempty: 'Only if the earlier steps produced something',
};

const blankStep = botId => ({ title: '', instruction: '', botId, parallel: false });

/** Everything about one workflow in one form: used for a new draft and for editing a saved workflow. */
function WorkflowEditor({ draft, setDraft, bots, busy, onSave, onCancel, saveLabel }) {
  const setStep = (i, patch) => setDraft(d => ({ ...d, steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));
  const move = (i, by) => setDraft(d => {
    const steps = [...d.steps];
    const j = i + by;
    if (j < 0 || j >= steps.length) return d;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...d, steps };
  });
  const remove = i => setDraft(d => ({ ...d, steps: d.steps.filter((_, n) => n !== i) }));
  const add = () => setDraft(d => ({ ...d, steps: [...d.steps, blankStep(d.steps.at(-1)?.botId || bots[0]?.id)] }));
  const trigger = draft.trigger || { type: 'manual' };
  const setTrigger = patch => setDraft(d => ({ ...d, trigger: { ...d.trigger, ...patch } }));
  const notify = draft.notify || { slack: false, teams: false, email: '' };
  const setNotify = patch => setDraft(d => ({ ...d, notify: { ...(d.notify || { slack: false, teams: false, email: '' }), ...patch } }));
  const toggleDay = d => {
    const days = new Set(trigger.weekdays || []);
    if (days.has(d)) days.delete(d); else days.add(d);
    setTrigger({ weekdays: [...days].sort((a, b) => a - b) });
  };
  const changeType = type => setDraft(d => ({
    ...d,
    trigger: type === 'daily' ? { type, dailyAt: d.trigger?.dailyAt || '09:00', weekdays: d.trigger?.weekdays || [] }
      : type === 'interval' ? { type, intervalMinutes: d.trigger?.intervalMinutes || 60 }
      : type === 'file' ? { type, watchPath: d.trigger?.watchPath || '' } : { type: 'manual' },
  }));

  return (
    <div className="wizard-body" data-testid="wf-draft">
      <label className="field-label">
        Name
        <input className="input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      </label>

      <fieldset className="wf-when">
        <legend>When should it run?</legend>
        <select className="select" aria-label="When should it run" data-testid="wf-trigger" value={trigger.type} onChange={e => changeType(e.target.value)}>
          <option value="manual">Only when I press Run</option>
          <option value="daily">On a schedule (days and time)</option>
          <option value="interval">Every few minutes or hours</option>
          <option value="file">When a folder changes</option>
        </select>
        {trigger.type === 'daily' && (
          <div className="wf-schedule">
            <input type="time" className="input" aria-label="Time of day" data-testid="wf-time" value={trigger.dailyAt || '09:00'} onChange={e => setTrigger({ dailyAt: e.target.value })} />
            <div role="group" aria-label="Days of the week" className="chip-list">
              {DAY_ORDER.map(d => (
                <button key={d} type="button" className="chip" data-testid={`wf-weekday-${d}`} aria-pressed={(trigger.weekdays || []).includes(d)} onClick={() => toggleDay(d)}>
                  {DAY_NAMES[d]}
                </button>
              ))}
            </div>
            <span className="muted">{trigger.weekdays?.length ? `Runs every ${daysText(trigger.weekdays)}.` : 'No day picked: runs every day.'}</span>
          </div>
        )}
        {trigger.type === 'interval' && (
          <label className="field-label">
            Every (minutes, at least 5)
            <input type="number" min={5} className="input" aria-label="Minutes between runs" value={trigger.intervalMinutes || 60} onChange={e => setTrigger({ intervalMinutes: Number(e.target.value) })} />
          </label>
        )}
        {trigger.type === 'file' && (
          <label className="field-label">
            Folder to watch
            <input className="input" aria-label="Folder to watch" value={trigger.watchPath || ''} onChange={e => setTrigger({ watchPath: e.target.value })} />
          </label>
        )}
        {draft.triggerNote && <p className="muted">{draft.triggerNote}</p>}
      </fieldset>

      <ol className="wf-steps">
        {draft.steps.map((s, i) => (
          <li key={i}>
            <input className="input" aria-label={`Step ${i + 1}`} value={s.instruction} onChange={e => setStep(i, { instruction: e.target.value })} />
            <select className="select" aria-label={`Who does step ${i + 1}`} value={s.botId} onChange={e => setStep(i, { botId: e.target.value })}>
              {bots.map(b => <option key={b.id} value={b.id}>{b.name} · {b.role}</option>)}
            </select>
            {i > 0 && (
              <>
                <label className="wf-together">
                  <input type="checkbox" checked={Boolean(s.parallel)} data-testid={`wf-together-${i}`} onChange={e => setStep(i, { parallel: e.target.checked })} />
                  Do at the same time as the step above
                </label>
                <select className="select" aria-label={`Condition for step ${i + 1}`} data-testid={`wf-cond-${i}`} value={s.condition?.when || ''}
                  onChange={e => setStep(i, { condition: e.target.value ? { when: e.target.value, text: s.condition?.text || '', otherwise: s.condition?.otherwise || 'skip' } : null })}>
                  {Object.entries(CONDITION_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                {(s.condition?.when === 'previous_mentions' || s.condition?.when === 'previous_lacks') && (
                  <input className="input" aria-label={`Phrase for step ${i + 1}`} placeholder="phrase, e.g. price cut" value={s.condition.text || ''} onChange={e => setStep(i, { condition: { ...s.condition, text: e.target.value } })} />
                )}
                {s.condition && (
                  <select className="select" aria-label={`If the condition is not met, step ${i + 1}`} value={s.condition.otherwise || 'skip'} onChange={e => setStep(i, { condition: { ...s.condition, otherwise: e.target.value } })}>
                    <option value="skip">If not met: skip this step and carry on</option>
                    <option value="stop">If not met: stop the workflow here</option>
                  </select>
                )}
              </>
            )}
            <span className="wf-actions">
              <button type="button" className="btn btn-sm" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-sm" aria-label={`Move step ${i + 1} down`} disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-sm" aria-label={`Remove step ${i + 1}`} data-testid={`wf-remove-${i}`} disabled={draft.steps.length < 2} onClick={() => remove(i)}>Remove</button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-sm" data-testid="wf-add-step" disabled={draft.steps.length >= 8} onClick={add}>Add a step</button>

      <fieldset className="wf-notify">
        <legend>When it finishes</legend>
        <label><input type="checkbox" data-testid="wf-notify-slack" checked={Boolean(notify.slack)} onChange={e => setNotify({ slack: e.target.checked })} /> Post the result to Slack</label>
        <label><input type="checkbox" data-testid="wf-notify-teams" checked={Boolean(notify.teams)} onChange={e => setNotify({ teams: e.target.checked })} /> Post the result to Teams</label>
        <span className="muted">Uses the Slack and Teams webhook addresses from Settings. Nothing is posted if none is set.</span>
        <label className="field-label">
          Prepare an email draft to
          <input className="input" type="email" data-testid="wf-notify-email" placeholder="name@example.com" value={notify.email || ''} onChange={e => setNotify({ email: e.target.value })} />
        </label>
        <span className="muted">Mimir opens the draft in your mail app and never sends email itself.</span>
      </fieldset>

      <div className="wizard-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>{saveLabel === 'Save changes' ? 'Cancel' : 'Back'}</button>
        <button type="button" className="btn btn-primary" data-testid="wf-save" disabled={busy} onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  );
}

/** Describe a job in a sentence → review the steps → save → it runs on its own. Saved workflows can be edited. */
export function WorkflowsPanel({ bots }) {
  const [data, setData] = useState({ workflows: [], templates: [] });
  const [approvals, setApprovals] = useState([]);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [watching, setWatching] = useState(null); // workflow id whose run is open

  const load = useCallback(async () => {
    try {
      const [w, a] = await Promise.all([apiFetch('/v1/workflows'), apiFetch('/v1/approvals')]);
      setData(w);
      setApprovals(a);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  const anyRunning = data.workflows.some(w => w.running);
  useEffect(() => {
    load();
    const id = setInterval(load, anyRunning ? 2000 : 15000);
    return () => clearInterval(id);
  }, [load, anyRunning]);

  const guard = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const build = () => guard(async () => setDraft(await apiFetch('/v1/workflows/draft', { method: 'POST', body: JSON.stringify({ description: text }) })));
  const save = () =>
    guard(async () => {
      await apiFetch('/v1/workflows', { method: 'POST', body: JSON.stringify(draft) });
      setDraft(null);
      setText('');
      await load();
    });
  const edit = w => setDraft({ id: w.id, name: w.name, description: w.description, enabled: w.enabled, trigger: w.trigger, notify: w.notify || { slack: false, teams: false, email: '' }, steps: w.steps.map(s => ({ ...s })) });
  const run = (id, resumeRunId) => guard(async () => { setWatching(id); await apiFetch(`/v1/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ resumeRunId }) }); await load(); });
  const remove = id => guard(async () => { await apiFetch(`/v1/workflows/${id}`, { method: 'DELETE' }); await load(); });
  const decide = (id, decision) => guard(async () => { await apiFetch(`/v1/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }); await load(); });

  return (
    <section className="card" data-testid="workflows-panel" aria-labelledby="wf-title">
      <h3 className="card-title" id="wf-title">Workflows</h3>
      <p className="muted">Describe a job once. Mimir splits it into steps, gives each step to the right teammate, and runs it on your schedule. Steps can run one after another, at the same time, or only when an earlier result says so.</p>
      {error && <div role="alert" className="wizard-error">{error}</div>}

      {approvals.length > 0 && (
        <div className="wf-approvals" data-testid="wf-approvals">
          <strong>Waiting for your OK ({approvals.length})</strong>
          {approvals.map(a => (
            <div key={a.id} className="wf-approval-row">
              <span>{a.dialogueCard?.title || a.toolName}: {a.dialogueCard?.subtitle || a.reason}</span>
              <span className="wf-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(a.id, 'approve-once')}>Approve</button>
                <button type="button" className="btn btn-sm" onClick={() => decide(a.id, 'deny')}>Deny</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {!draft && (
        <>
          <label className="field-label">
            What should happen?
            <textarea
              className="textarea"
              rows={3}
              data-testid="wf-describe"
              placeholder="Every weekday at 8am, research competitor pricing, then at the same time check our own prices, then write a short brief"
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </label>
          <div className="chip-list">
            {data.templates.map(t => (
              <button key={t.id} type="button" className="chip" onClick={() => setText(t.description)}>{t.name}</button>
            ))}
          </div>
          <div>
            <button type="button" className="btn btn-primary" data-testid="wf-build" disabled={busy || text.trim().length < 12} onClick={build}>
              {busy ? 'Planning…' : 'Build workflow'}
            </button>
          </div>
        </>
      )}

      {draft && (
        <WorkflowEditor draft={draft} setDraft={setDraft} bots={bots} busy={busy} onSave={save} onCancel={() => setDraft(null)} saveLabel={draft.id ? 'Save changes' : 'Save workflow'} />
      )}

      {data.workflows.map(w => {
        const last = w.lastRun;
        return (
          <article key={w.id} className="wf-item" data-testid={`wf-${w.id}`}>
            <header>
              <strong>{w.name}</strong>
              <span className="status-pill">{triggerText(w.trigger)}</span>
              <span className="wf-actions">
                {last?.status === 'failed' && !w.running && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(w.id, last.id)}>Resume from failed step</button>
                )}
                {last && (
                  <button type="button" className="btn btn-sm" data-testid={`wf-watch-${w.id}`} aria-expanded={watching === w.id} onClick={() => setWatching(watching === w.id ? null : w.id)}>
                    {watching === w.id ? 'Hide details' : w.running ? 'Watch it work' : 'See last run'}
                  </button>
                )}
                <button type="button" className="btn btn-sm" data-testid={`wf-edit-${w.id}`} disabled={busy || w.running || Boolean(draft)} onClick={() => edit(w)}>Edit</button>
                <button type="button" className="btn btn-primary btn-sm" data-testid={`wf-run-${w.id}`} disabled={busy || w.running} onClick={() => run(w.id)}>
                  {w.running ? 'Running…' : 'Run now'}
                </button>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy || w.running} onClick={() => remove(w.id)}>Delete</button>
              </span>
            </header>
            {watching === w.id && last && <TeamRunView run={last} bots={bots} onClose={() => setWatching(null)} />}
            {!(watching === w.id && last) && (<>
            <ol className="wf-steps wf-run">
              {(last?.steps || w.steps).map((s, i) => (
                <li key={i} data-status={s.status || 'waiting'}>
                  <span className="wf-step-mark">{STEP_MARK[s.status] || 'Not run yet'}</span>
                  <span>{s.title}</span>
                  <span className="muted">{s.botName || bots.find(b => b.id === s.botId)?.name}</span>
                  {s.status === 'skipped' && s.note && <span className="muted">{s.note}</span>}
                  {s.error && <span className="wizard-error">{s.error}</span>}
                </li>
              ))}
            </ol>
            {last?.status === 'done' && (
              <details>
                <summary>Result · {new Date(last.finishedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</summary>
                <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{[...last.steps].reverse().find(s => s.status === 'done')?.output || last.stopped || ''}</pre>
                {last.deliverable && <span className="muted">Saved to {last.deliverable}</span>}
                {last.emailDraft && <p><a href={last.emailDraft.mailto} data-testid={`wf-email-${w.id}`}>Open the email draft to {last.emailDraft.to}</a></p>}
              </details>
            )}
            </>)}
          </article>
        );
      })}
    </section>
  );
}
