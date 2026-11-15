import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';
import { ProactivePanel } from './ProactivePanel.jsx';
import { WorkflowsPanel } from './WorkflowsPanel.jsx';

export function RoutinesView({ routines, recordings, bots, onRefresh, onOpenThread }) {
  const [form, setForm] = useState({
    name: '',
    botId: bots[0]?.id || 'bot-grok-default',
    prompt: '',
    intervalMinutes: 60,
    dailyAt: '',
    watchPath: '',
    retryInterrupted: true,
    notifySlack: false,
    notifyTeams: false,
  });
  const [runningId, setRunningId] = useState(null);
  const [skillPreview, setSkillPreview] = useState(null);

  const compileSkill = async recId => {
    const out = await apiFetch(`/v1/recordings/${encodeURIComponent(recId)}/compile-skill`, {
      method: 'POST',
      body: '{}',
    });
    setSkillPreview(out);
    await onRefresh();
  };

  const createRoutine = async e => {
    e.preventDefault();
    if (!form.name.trim() || !form.prompt.trim()) return;
    await apiFetch('/v1/routines', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setForm(f => ({ ...f, name: '', prompt: '' }));
    await onRefresh();
  };

  const runNow = async id => {
    setRunningId(id);
    try {
      const res = await apiFetch(`/v1/routines/${encodeURIComponent(id)}/run`, { method: 'POST', body: '{}' });
      await onRefresh();
      if (res.threadId) onOpenThread(res.threadId);
    } finally {
      setRunningId(null);
    }
  };

  const toggleEnabled = async r => {
    await apiFetch('/v1/routines', {
      method: 'POST',
      body: JSON.stringify({ ...r, enabled: !r.enabled }),
    });
    await onRefresh();
  };

  const deleteRoutine = async id => {
    await apiFetch(`/v1/routines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  };

  const promoteRecording = async recId => {
    await apiFetch(`/v1/recordings/${encodeURIComponent(recId)}/to-routine`, {
      method: 'POST',
      body: JSON.stringify({ intervalMinutes: 0 }),
    });
    await onRefresh();
  };

  const deleteRecording = async id => {
    await apiFetch(`/v1/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  };

  return (
    <div className="view-scroll" data-testid="routines-view">
      <div className="view-container">
        <div>
          <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="ui" name="routines" size={22} />
            <span>Scheduled tasks &amp; recordings</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Run tasks on a schedule, post updates to Slack or Microsoft Teams, or turn a recorded task into a schedule.
          </p>
        </div>

        <WorkflowsPanel bots={bots} />

        <ProactivePanel refreshKey={routines} onOpenThread={onOpenThread} />

        <form className="card" onSubmit={createRoutine}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="gjallarhorn" size={18} />
            <span>New scheduled task</span>
          </h3>
          <div className="grid-2">
            <label className="field-label">
              Task name
              <input className="input" required placeholder="Daily summary" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="field-label">
              Who runs it
              <select className="select" value={form.botId} onChange={e => setForm(f => ({ ...f, botId: e.target.value }))}>
                {bots.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.isTeamBot ? '(Team)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Repeat every (minutes, 0 = only when you click Run)
              <input
                type="number"
                min="0"
                className="input"
                value={form.intervalMinutes}
                onChange={e => setForm(f => ({ ...f, intervalMinutes: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="field-label">
              Or daily at (local time, overrides interval)
              <input type="time" className="input" data-testid="routine-daily-at" value={form.dailyAt} onChange={e => setForm(f => ({ ...f, dailyAt: e.target.value }))} />
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Or run when this file/folder changes (full path)
              <input className="input" data-testid="routine-watch-path" placeholder="D:\inbox" value={form.watchPath} onChange={e => setForm(f => ({ ...f, watchPath: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 18 }}>
              <input type="checkbox" checked={!form.retryInterrupted} onChange={e => setForm(f => ({ ...f, retryInterrupted: !e.target.checked }))} />
              Never auto-rerun if cut off by a restart (use for routines that send, buy or delete)
            </label>
          </div>

          <div className="grid-2">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={form.notifySlack} onChange={e => setForm(f => ({ ...f, notifySlack: e.target.checked }))} />
                Notify Slack
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={form.notifyTeams} onChange={e => setForm(f => ({ ...f, notifyTeams: e.target.checked }))} />
                Notify Teams
              </label>
            </div>
          </div>

          <label className="field-label">
            What it should do
            <textarea className="textarea" required rows={3} placeholder="Check my folder and write a short update..." value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} />
          </label>

          <div>
            <button type="submit" className="btn btn-primary">
              Save task
            </button>
          </div>
        </form>

        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="ui" name="routines" size={18} />
            <span>Scheduled tasks ({routines.length})</span>
          </h3>
          {routines.length === 0 ? (
            <div style={{ color: 'var(--sand-text-subtle)' }}>No scheduled tasks yet.</div>
          ) : (
            routines.map(r => (
              <div
                key={r.id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--sand-bg)',
                  border: '1px solid var(--sand-border)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <strong>{r.name}</strong>{' '}
                    <span className="status-pill">
                      {r.dailyAt ? `Daily ${r.dailyAt}` : r.intervalMinutes > 0 ? `Every ${r.intervalMinutes}m` : r.watchPath ? `On change: ${r.watchPath}` : 'Manual'} • {r.lastStatus}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => runNow(r.id)} disabled={runningId === r.id}>
                      {runningId === r.id ? 'Running...' : 'Run Now'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => toggleEnabled(r)}>
                      {r.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteRoutine(r.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--sand-text-muted)' }}>{r.prompt}</div>
                {r.lastSummary && <div className="code-block" style={{ fontSize: 11.5 }}>{r.lastSummary}</div>}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="scroll" size={18} />
            <span>Recorded tasks ({recordings.length})</span>
          </h3>
          {recordings.length === 0 ? (
            <div style={{ color: 'var(--sand-text-subtle)' }}>Click &quot;Record a task&quot; in Chat to save steps Mimir can repeat later.</div>
          ) : (
            recordings.map(rec => (
              <div
                key={rec.id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--sand-bg)',
                  border: '1px solid var(--sand-border)',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div>
                    <strong>{rec.name}</strong> ({rec.steps.length} steps)
                  </div>
                  {rec.skillLogicalPath && (
                    <span className="pill" style={{ fontSize: 11, width: 'fit-content' }}>
                      Skill saved: <code>{rec.skillLogicalPath}</code>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid={`compile-skill-btn-${rec.id}`}
                    onClick={() => compileSkill(rec.id)}
                  >
                    Save as reusable skill
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => promoteRecording(rec.id)}>
                    Schedule this
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteRecording(rec.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
          {skillPreview?.content && (
            <div className="card" style={{ padding: 12, gap: 6, borderColor: 'var(--brass)' }} data-testid="compiled-skill-preview">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 12.5, color: 'var(--brass)' }}>
                  Saved skill · <code>{skillPreview.logicalPath}</code>
                </strong>
                <button type="button" className="btn btn-sm" onClick={() => setSkillPreview(null)}>
                  Close
                </button>
              </div>
              <pre className="tool-output-pre">{skillPreview.content}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
