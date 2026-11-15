import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';

const RUN_TONE = { skipped: 'var(--ink-muted)', ok: 'var(--ink-accent, #3ac9ff)', running: '#e6ab42', failed: '#e06c5a', interrupted: '#e06c5a', dead: '#e06c5a' };
const fmt = iso => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never');

/**
 * Original Mimir artwork: a pixel-stepped watch ring around a well-eye. Purely decorative, so it is
 * hidden from assistive tech; the text pill next to it carries the state.
 */
function WatchSigil({ state }) {
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg className="watch-sigil" data-state={state} data-testid="watch-sigil" viewBox="0 0 32 32" width="26" height="26" shapeRendering="crispEdges" aria-hidden="true">
      <g className="sigil-ring" fill="currentColor">
        {ticks.map(deg => (
          <rect key={deg} x="15" y="1" width="2" height={deg % 90 === 0 ? 5 : 3} transform={`rotate(${deg} 16 16)`} />
        ))}
      </g>
      <path fill="none" stroke="currentColor" strokeWidth="2" d="M9 16h2v-2h2v-2h6v2h2v2h2M9 16h2v2h2v2h6v-2h2v-2" />
      <rect className="sigil-eye" x="14" y="14" width="4" height="4" fill="currentColor" />
    </svg>
  );
}

/** Live view of the 24/7 scheduler: host truthfulness, controls, upcoming runs, run journal and feed. */
export function ProactivePanel({ refreshKey, onOpenThread }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [quietDraft, setQuietDraft] = useState(null);
  const [maxRunsDraft, setMaxRunsDraft] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch('/v1/proactive'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  const saveConfig = async patch => {
    try {
      await apiFetch('/v1/proactive/config', { method: 'POST', body: JSON.stringify(patch) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!data) {
    return (
      <div className="card" data-testid="proactive-panel">
        {error ? `Proactive engine unreachable: ${error}` : 'Loading proactive engine…'}
      </div>
    );
  }

  const { status, runs, feed } = data;
  const quiet = quietDraft || status.quietHours || { start: '', end: '' };
  // Both ends are needed before the server will accept quiet hours, so hold a half-filled pair locally.
  const changeQuiet = async (key, value) => {
    const next = { ...quiet, [key]: value };
    setQuietDraft(next);
    if (next.start && next.end) {
      await saveConfig({ quietHours: next });
      setQuietDraft(null);
    }
  };
  const isRunning = runs.some(r => r.status === 'running');
  const sigilState = status.paused ? 'paused' : status.inQuietHours ? 'quiet' : isRunning ? 'running' : status.schedulerRunning ? 'watching' : 'idle';
  const stateLabel = status.paused ? 'Paused' : status.inQuietHours ? 'Quiet hours' : status.schedulerRunning ? 'Watching' : 'Scheduler off';

  return (
    <div className="card" data-testid="proactive-panel">
      <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MimirAsset category="characters" name="mimir-head" size={22} />
          <span>Mimir 24/7 Watch</span>
          <WatchSigil state={sigilState} />
          <span className="status-pill" data-testid="proactive-state">{stateLabel}</span>
        </span>
        <button
          type="button"
          className={status.paused ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
          data-testid="proactive-pause-toggle"
          onClick={() => saveConfig({ paused: !status.paused })}
        >
          {status.paused ? 'Resume scheduled runs' : 'Pause all scheduled runs'}
        </button>
      </h3>

      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)' }}>
        Runs on this computer only while it is awake and the coordinator is running. Missed slots run once on wake-up. {status.runsToday}/
        {status.maxRunsPerDay} runs used today · last check {fmt(status.lastTickAt)}.
      </p>
      {error && <div role="alert" style={{ color: '#e06c5a', fontSize: 12.5 }}>{error}</div>}

      <div className="grid-2">
        <label className="field-label">
          Quiet hours start
          <input type="time" className="input" value={quiet.start} onChange={e => changeQuiet('start', e.target.value)} />
        </label>
        <label className="field-label">
          Quiet hours end
          <input type="time" className="input" value={quiet.end} onChange={e => changeQuiet('end', e.target.value)} />
        </label>
        <label className="field-label">
          Daily digest at
          <input type="time" className="input" value={status.digestAt} onChange={e => saveConfig({ digestAt: e.target.value })} />
        </label>
        <label className="field-label">
          Max runs per day
          <input
            type="number"
            min="0"
            max="1000"
            className="input"
            value={maxRunsDraft ?? status.maxRunsPerDay}
            onChange={e => setMaxRunsDraft(e.target.value)}
            onBlur={e => {
              const n = Number(e.target.value);
              setMaxRunsDraft(null);
              if (!Number.isNaN(n) && n !== status.maxRunsPerDay) saveConfig({ maxRunsPerDay: n });
            }}
          />
        </label>
      </div>
      {status.quietHours && (
        <div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setQuietDraft(null);
              saveConfig({ quietHours: null });
            }}
          >
            Clear quiet hours
          </button>
        </div>
      )}

      <div>
        <strong style={{ fontSize: 12.5 }}>Up next</strong>
        {status.upcoming.length === 0 ? (
          <div style={{ color: 'var(--sand-text-subtle)', fontSize: 12.5 }}>Nothing scheduled. Give a routine an interval or a daily time.</div>
        ) : (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {status.upcoming.slice(0, 5).map(u => (
              <li key={u.routineId}>{u.name} — {fmt(u.nextAt)}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid-2">
        <div>
          <strong style={{ fontSize: 12.5 }}>Feed</strong>
          {feed.length === 0 ? (
            <div style={{ color: 'var(--sand-text-subtle)', fontSize: 12.5 }}>No digests or alerts yet.</div>
          ) : (
            feed.slice(0, 6).map(f => (
              <div key={f.id} className="code-block" style={{ fontSize: 11.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                <strong>{f.title}</strong> · {fmt(f.at)}
                {'\n'}
                {f.body}
              </div>
            ))
          )}
        </div>
        <div>
          <strong style={{ fontSize: 12.5 }}>Run journal</strong>
          {runs.length === 0 ? (
            <div style={{ color: 'var(--sand-text-subtle)', fontSize: 12.5 }}>No scheduled runs recorded yet.</div>
          ) : (
            runs.slice(0, 8).map(r => (
              <div key={r.id} className="proactive-row-enter" style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: RUN_TONE[r.status] || 'inherit', fontWeight: 600 }}>{r.status}</span>
                <span>{r.routineName}</span>
                <span style={{ color: 'var(--ink-muted)' }}>try {r.attempt} · {fmt(r.startedAt)}</span>
                {r.threadId && (
                  <button type="button" className="btn btn-sm" onClick={() => onOpenThread(r.threadId)}>Open</button>
                )}
                {r.error && <span style={{ color: 'var(--ink-muted)', flexBasis: '100%' }}>{r.error}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
