import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

const triggerText = t =>
  t.type === 'daily' ? `Every day at ${t.dailyAt}` : t.type === 'interval' ? `Every ${t.intervalMinutes >= 60 ? `${t.intervalMinutes / 60} h` : `${t.intervalMinutes} min`}` : t.type === 'file' ? `When ${t.watchPath} changes` : 'When you press Run';
const STEP_MARK = { done: 'Done', running: 'Working…', failed: 'Failed', waiting: 'Waiting' };

/** Describe a job in a sentence → review the steps → save → it runs on its own. */
export function WorkflowsPanel({ bots }) {
  const [data, setData] = useState({ workflows: [], templates: [] });
  const [approvals, setApprovals] = useState([]);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
  const run = (id, resumeRunId) => guard(async () => { await apiFetch(`/v1/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ resumeRunId }) }); await load(); });
  const remove = id => guard(async () => { await apiFetch(`/v1/workflows/${id}`, { method: 'DELETE' }); await load(); });
  const decide = (id, decision) => guard(async () => { await apiFetch(`/v1/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }); await load(); });
  const editStep = (i, patch) => setDraft(d => ({ ...d, steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));

  return (
    <section className="card" data-testid="workflows-panel" aria-labelledby="wf-title">
      <h3 className="card-title" id="wf-title">Workflows</h3>
      <p className="muted">Describe a job once. Mimir splits it into steps, gives each step to the right bot, and runs it on your schedule.</p>
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
              placeholder="Every day at 8am, research competitor pricing, then write a short brief, then draft one reply idea"
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
        <div className="wizard-body" data-testid="wf-draft">
          <label className="field-label">
            Name
            <input className="input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          </label>
          <p><strong>Runs:</strong> {triggerText(draft.trigger)}{draft.triggerNote ? ` — ${draft.triggerNote}` : ''}</p>
          <ol className="wf-steps">
            {draft.steps.map((s, i) => (
              <li key={i}>
                <input className="input" aria-label={`Step ${i + 1}`} value={s.instruction} onChange={e => editStep(i, { instruction: e.target.value })} />
                <select className="select" aria-label={`Who does step ${i + 1}`} value={s.botId} onChange={e => editStep(i, { botId: e.target.value })}>
                  {bots.map(b => <option key={b.id} value={b.id}>{b.name} · {b.role}</option>)}
                </select>
              </li>
            ))}
          </ol>
          <div className="wizard-actions">
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Back</button>
            <button type="button" className="btn btn-primary" data-testid="wf-save" disabled={busy} onClick={save}>Save workflow</button>
          </div>
        </div>
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
                <button type="button" className="btn btn-primary btn-sm" data-testid={`wf-run-${w.id}`} disabled={busy || w.running} onClick={() => run(w.id)}>
                  {w.running ? 'Running…' : 'Run now'}
                </button>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy || w.running} onClick={() => remove(w.id)}>Delete</button>
              </span>
            </header>
            <ol className="wf-steps wf-run">
              {(last?.steps || w.steps).map((s, i) => (
                <li key={i} data-status={s.status || 'waiting'}>
                  <span className="wf-step-mark">{STEP_MARK[s.status] || 'Not run yet'}</span>
                  <span>{s.title}</span>
                  <span className="muted">{s.botName || bots.find(b => b.id === s.botId)?.name}</span>
                  {s.error && <span className="wizard-error">{s.error}</span>}
                </li>
              ))}
            </ol>
            {last?.status === 'done' && (
              <details>
                <summary>Result · {new Date(last.finishedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</summary>
                <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{last.steps.at(-1).output}</pre>
                <span className="muted">Saved to {last.deliverable}</span>
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}
