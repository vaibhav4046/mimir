import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { CouncilRuneSvg } from './Icons.jsx';

const SAMPLE_TOPICS = [
  'Should we route routine coding turns to qwen3:1.7b + Reflexion or qwen3.5:4b on 6GB VRAM?',
  'Audit our sandboxed tool approval gates for privilege-escalation edge cases.',
  'Design an offline-first voice + CRAG knowledge retrieval workflow.',
];

function seatKey(seat) {
  return seat?.seatId || seat?.id || '';
}

function normalizeStage(stageRaw) {
  const s = String(stageRaw || '').toLowerCase();
  if (s.includes('1') || s.includes('opinion')) return 1;
  if (s.includes('2') || s.includes('rank') || s.includes('critique') || s.includes('borda')) return 2;
  if (s.includes('3') || s.includes('synth') || s.includes('chair') || s.includes('done')) return 3;
  return 0;
}

export function BoardMeetingView({
  activeBot,
  activeThreadId,
  councilSteps = [],
  onDispatchToChat,
  onNavigate,
}) {
  const [seats, setSeats] = useState([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [chairmanSeatId, setChairmanSeatId] = useState('');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('standard');
  const [useRag, setUseRag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeRun, setActiveRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [liveStartTs, setLiveStartTs] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [seatRes, histRes] = await Promise.all([
        apiFetch('/v1/council/seats').catch(() => ({ seats: [] })),
        apiFetch('/v1/council/history').catch(() => ({ runs: [] })),
      ]);
      const seatList = Array.isArray(seatRes) ? seatRes : seatRes?.seats || [];
      const histList = Array.isArray(histRes) ? histRes : histRes?.runs || histRes?.history || [];
      setSeats(seatList);
      setHistory(histList);
      if (seatList.length > 0) {
        setSelectedSeatIds(prev => (prev.length > 0 ? prev : seatList.slice(0, 6).map(seatKey).filter(Boolean)));
        setChairmanSeatId(prev => prev || seatKey(seatList[0]));
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load council state.');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const liveSteps = useMemo(() => {
    const slice = liveStartTs > 0 ? councilSteps.filter(s => (s.receivedAt || 0) >= liveStartTs) : councilSteps;
    if (activeRun?.runId || activeRun?.id) {
      const targetId = activeRun.runId || activeRun.id;
      const matching = councilSteps.filter(s => s.runId === targetId);
      if (matching.length > 0) return matching;
    }
    return slice;
  }, [councilSteps, liveStartTs, activeRun]);

  const liveStage = useMemo(() => {
    if (activeRun?.synthesis || activeRun?.consensus) return 3;
    let maxStage = 0;
    for (const s of liveSteps) {
      const n = normalizeStage(s.stage);
      if (n > maxStage) maxStage = n;
    }
    return maxStage;
  }, [activeRun, liveSteps]);

  const liveOpinions = useMemo(() => {
    if (Array.isArray(activeRun?.opinions) && activeRun.opinions.length > 0) {
      return activeRun.opinions;
    }
    const map = new Map();
    for (const s of liveSteps) {
      if (Array.isArray(s.opinions)) {
        for (const op of s.opinions) {
          map.set(op.seatId || op.name, op);
        }
      } else if (s.opinion) {
        map.set(s.opinion.seatId || s.opinion.name, s.opinion);
      }
    }
    return Array.from(map.values());
  }, [activeRun, liveSteps]);

  const liveLeaderboard = useMemo(() => {
    if (Array.isArray(activeRun?.leaderboard) && activeRun.leaderboard.length > 0) {
      return activeRun.leaderboard;
    }
    for (let i = liveSteps.length - 1; i >= 0; i--) {
      if (Array.isArray(liveSteps[i].leaderboard)) return liveSteps[i].leaderboard;
    }
    return [];
  }, [activeRun, liveSteps]);

  const toggleSeat = id => {
    setSelectedSeatIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleConvene = async e => {
    e.preventDefault();
    if (!topic.trim() || busy) return;
    setBusy(true);
    setErrorMsg('');
    setActiveRun(null);
    setLiveStartTs(Date.now());
    try {
      const res = await apiFetch('/v1/council/run', {
        method: 'POST',
        body: JSON.stringify({
          topic: topic.trim(),
          threadId: activeThreadId || null,
          seatIds: selectedSeatIds.length > 0 ? selectedSeatIds : undefined,
          chairmanSeatId: chairmanSeatId || undefined,
          mode,
          useRag,
        }),
      });
      const runObj = res?.run || res;
      setActiveRun(runObj);
      const histRes = await apiFetch('/v1/council/history').catch(() => null);
      if (histRes) {
        const histList = Array.isArray(histRes) ? histRes : histRes?.runs || histRes?.history || [];
        setHistory(histList);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Council session failed.');
    } finally {
      setBusy(false);
    }
  };

  const synthesisText = activeRun?.synthesis || activeRun?.consensus || '';
  const dissentsRaw = activeRun?.minorityDissents ?? activeRun?.dissents ?? activeRun?.dissent ?? null;
  const dissentList = Array.isArray(dissentsRaw)
    ? dissentsRaw
    : typeof dissentsRaw === 'string' && dissentsRaw.trim()
      ? [dissentsRaw.trim()]
      : [];
  const citations = Array.isArray(activeRun?.citations) ? activeRun.citations : [];
  const actionItems = Array.isArray(activeRun?.actionItems) ? activeRun.actionItems : [];
  const peerMatrix = activeRun?.peerMatrix || activeRun?.rankings || null;
  const lastLiveStep = liveSteps[liveSteps.length - 1];

  return (
    <div className="view-scroll" data-testid="council-view">
      <div className="view-container council-chamber">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CouncilRuneSvg size={20} />
              <span>Boardroom · Model Council</span>
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              Convene bots and local/BYOK models for parallel Stage 1 opinions, anonymized Stage 2 Borda ranking, and Chairman synthesis.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={loadData}>
              Refresh Seats
            </button>
            {onNavigate && (
              <button type="button" className="btn btn-sm" onClick={() => onNavigate('chat')}>
                Back to Chat
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="card" style={{ borderColor: 'var(--err)', background: 'var(--err-soft)', padding: 10 }} role="alert">
            <strong>{errorMsg}</strong>
          </div>
        )}

        <form className="card" onSubmit={handleConvene}>
          <label className="field-label">
            Council Topic
            <textarea
              className="textarea"
              rows={2}
              placeholder="Pose an architecture question, code audit, or strategic trade-off for the council..."
              value={topic}
              onChange={e => setTopic(e.target.value)}
            />
          </label>

          {!topic.trim() && (
            <div className="chip-list">
              {SAMPLE_TOPICS.map(sample => (
                <button
                  key={sample}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setTopic(sample)}
                >
                  {sample.length > 52 ? `${sample.slice(0, 52)}...` : sample}
                </button>
              ))}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 6 }}>
              Councilors ({selectedSeatIds.length} selected of {seats.length})
            </div>
            {seats.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>
                No seats reported yet. Click Refresh Seats or ensure the daemon is running.
              </div>
            ) : (
              <div className="council-seat-grid" role="group" aria-label="Council Seats">
                {seats.map(seat => {
                  const id = seatKey(seat);
                  const isSelected = selectedSeatIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`council-seat-chip ${isSelected ? 'active' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => toggleSeat(id)}
                    >
                      <span className="council-seat-name">{seat.name || seat.label || id}</span>
                      <span className="council-seat-meta">
                        {seat.model || seat.provider || 'local'} · {seat.role || seat.perspective || 'Councilor'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="council-controls-row">
            <label className="field-label" style={{ flex: '1 1 200px', minWidth: 0 }}>
              Chairman
              <select
                className="select"
                value={chairmanSeatId}
                onChange={e => setChairmanSeatId(e.target.value)}
              >
                {seats.map(seat => {
                  const id = seatKey(seat);
                  return (
                    <option key={id} value={id}>
                      {seat.name || id} ({seat.model || 'local'})
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="field-label" style={{ flex: '0 1 150px', minWidth: 0 }}>
              Mode
              <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
                <option value="standard">Standard (3-Stage)</option>
                <option value="fast">Fast Parallel</option>
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
              <input
                type="checkbox"
                checked={useRag}
                onChange={e => setUseRag(e.target.checked)}
              />
              <span>CRAG + Web Grounding</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              data-testid="council-convene-btn"
              disabled={busy || !topic.trim() || (seats.length > 0 && selectedSeatIds.length === 0)}
            >
              <CouncilRuneSvg size={15} />
              <span>{busy ? 'Convening Council...' : 'Convene Council'}</span>
            </button>
          </div>
        </form>

        {(busy || activeRun || liveSteps.length > 0) && (
          <div className="card">
            <div className="council-stage-rail" aria-label="Council stages">
              {[
                { num: 1, label: 'Stage 1 · Parallel Opinions' },
                { num: 2, label: 'Stage 2 · Anonymized Peer Rank' },
                { num: 3, label: 'Stage 3 · Chairman Synthesis' },
              ].map(st => {
                const done = liveStage > st.num || (!busy && Boolean(synthesisText) && liveStage >= st.num);
                const active = busy && (liveStage === st.num || (liveStage === 0 && st.num === 1));
                return (
                  <div
                    key={st.num}
                    className={`council-stage-pill ${done ? 'is-done' : active ? 'is-active' : ''}`}
                  >
                    <span>{st.label}</span>
                  </div>
                );
              })}
            </div>
            {busy && (
              <div style={{ fontSize: 12, color: 'var(--frost)' }}>
                {lastLiveStep?.detail || lastLiveStep?.stage || 'Gathering Stage 1 council opinions (bounded concurrency <= 3)...'}
              </div>
            )}
          </div>
        )}

        {liveOpinions.length > 0 && (
          <section className="card">
            <h3 className="card-title">Stage 1 · Parallel Opinions ({liveOpinions.length})</h3>
            <div className="council-opinions-grid">
              {liveOpinions.map((op, idx) => {
                const failed = op.ok === false || Boolean(op.error);
                return (
                <article key={op.seatId || op.name || idx} className="council-opinion-card">
                  <div className="council-opinion-head">
                    <div>
                      <strong>{op.name || op.seatId || `Councilor ${idx + 1}`}</strong>
                      <div style={{ fontSize: 11, color: 'var(--ink-subtle)' }}>{op.model || 'local'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {op.latencyMs != null && <span className="status-pill">{op.latencyMs}ms</span>}
                      <span
                        className="status-pill"
                        style={{
                          color: failed ? 'var(--err)' : 'var(--ok)',
                          borderColor: failed ? 'var(--err)' : 'var(--ok)',
                        }}
                      >
                        {failed ? 'Error' : 'Responded'}
                      </span>
                    </div>
                  </div>
                  <div className="council-opinion-body">
                    {op.response || op.content || op.error || '(No output)'}
                  </div>
                </article>
                );
              })}
            </div>
          </section>
        )}

        {(liveLeaderboard.length > 0 || peerMatrix) && (
          <section className="card">
            <h3 className="card-title">Stage 2 · Anonymized Peer Ranking &amp; Borda Leaderboard</h3>
            {liveLeaderboard.length > 0 && (
              <div className="council-table-wrap">
                <table className="council-matrix-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Blind Label</th>
                      <th>Councilor</th>
                      <th>Model</th>
                      <th>Borda Score</th>
                      <th>Avg Rank</th>
                      <th>Peer Critiques</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveLeaderboard.map((row, idx) => (
                      <tr key={row.seatId || row.label || idx} className={idx === 0 ? 'is-winner' : ''}>
                        <td>#{idx + 1}</td>
                        <td><code>{row.label || `Response ${String.fromCharCode(65 + idx)}`}</code></td>
                        <td><strong>{row.name || row.seatId}</strong></td>
                        <td>{row.model || 'local'}</td>
                        <td><strong style={{ color: 'var(--brass)' }}>{row.bordaScore ?? row.score ?? '—'}</strong></td>
                        <td>{row.avgRank != null ? Number(row.avgRank).toFixed(2) : '—'}</td>
                        <td style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                          {Array.isArray(row.critiques) && row.critiques.length > 0 ? row.critiques.join(' · ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {Array.isArray(peerMatrix) && peerMatrix.length > 0 && (
              <details className="tool-card-details" style={{ marginTop: 6 }}>
                <summary>Inspect Peer Reviewer Rankings ({peerMatrix.length})</summary>
                <div className="council-table-wrap" style={{ marginTop: 6 }}>
                  <table className="council-matrix-table">
                    <thead>
                      <tr>
                        <th>Reviewer</th>
                        <th>Ranking Order</th>
                        <th>Critique Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peerMatrix.map((pm, idx) => (
                        <tr key={idx}>
                          <td>{pm.reviewerName || pm.reviewerSeatId || `Judge ${idx + 1}`}</td>
                          <td><code>{Array.isArray(pm.ranking) ? pm.ranking.join(' > ') : String(pm.ranking || '—')}</code></td>
                          <td>{pm.rationale || pm.critique || pm.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        )}

        {(synthesisText || actionItems.length > 0 || dissentList.length > 0) && (
          <section className="card council-synthesis-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                Stage 3 · Chairman Final Synthesis
              </h3>
              {(activeRun?.chairmanName || activeRun?.chairman?.name) && (
                <span className="status-pill" style={{ borderColor: 'var(--brass)', color: 'var(--brass)' }}>
                  Chair: {activeRun.chairmanName || activeRun.chairman.name}
                </span>
              )}
            </div>

            {synthesisText && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{synthesisText}</div>
            )}

            {dissentList.length > 0 && (
              <div className="council-dissent-box">
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--warn)' }}>
                  Minority Dissent
                </div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {dissentList.map((d, i) => (
                    <li key={i} style={{ fontSize: 12.5 }}>
                      {typeof d === 'string' ? d : d.summary || d.point || JSON.stringify(d)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {citations.length > 0 && (
              <div className="chip-list">
                {citations.map((c, i) => (
                  <span key={i} className="chip">
                    {c.title || c.source || `Citation ${i + 1}`}
                    {c.url ? ` · ${c.url}` : ''}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actionItems.length > 0 ? (
                actionItems.map((item, idx) => (
                  <div key={idx} className="council-action-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title || `Action ${idx + 1}`}</div>
                      {item.ownerRole && (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)' }}>Owner: {item.ownerRole}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onDispatchToChat?.(item.prompt || `${item.title}${item.ownerRole ? ` (as ${item.ownerRole})` : ''}`)}
                    >
                      Dispatch Action to Chat
                    </button>
                  </div>
                ))
              ) : (
                synthesisText && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        onDispatchToChat?.(
                          `Execute the Boardroom consensus for "${activeRun?.topic || topic}" with ${activeBot?.name || 'Mimir'}:\n\n${synthesisText.slice(0, 800)}`
                        )
                      }
                    >
                      Dispatch Action to Chat
                    </button>
                  </div>
                )
              )}
            </div>
          </section>
        )}

        <section className="card">
          <h3 className="card-title">Past Meetings ({history.length})</h3>
          {history.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)' }}>
              No council meetings recorded yet. Convene one above.
            </div>
          ) : (
            <div className="council-history-list">
              {history.map((run, idx) => {
                const runId = run.id || run.runId || idx;
                return (
                  <div key={runId} className="council-history-item">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {run.topic || 'Untitled Meeting'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)' }}>
                        {run.createdAt ? new Date(run.createdAt).toLocaleString() : ''} · {(run.opinions || []).length} seat(s)
                        {run.leaderboard?.[0]?.name ? ` · Top: ${run.leaderboard[0].name}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setActiveRun(run)}
                    >
                      Inspect
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
