import React, { useEffect, useRef, useState } from 'react';
import { BotAvatar } from './BotAvatar.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'team', label: 'Team' },
  { id: 'map', label: 'Map' },
];
const STATUS_WORD = { done: 'Done', running: 'Working…', failed: 'Failed', waiting: 'Waiting' };
const RUN_WORD = { done: 'Finished', running: 'Running', failed: 'Stopped with a problem' };

/** Same grouping the engine uses: a step marked `parallel` shares a stage with the one before. */
export function stagesOf(steps = []) {
  const stages = [];
  steps.forEach((s, i) => {
    if (i > 0 && s.parallel) stages.at(-1).push(i);
    else stages.push([i]);
  });
  return stages;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const stepMs = (s, now) => (s.startedAt ? (s.finishedAt ? new Date(s.finishedAt) : now) - new Date(s.startedAt) : NaN);
const clock = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function StepOutput({ step }) {
  if (!step) return null;
  return (
    <div className="run-output" data-testid="run-step-output">
      <strong>{step.title} · {step.botName}</strong>
      {step.error && <span className="wizard-error">{step.error}</span>}
      {step.output ? <pre className="code-block">{step.output}</pre> : <span className="muted">{step.status === 'running' ? 'Still working on it…' : 'No result yet.'}</span>}
      {step.file && <span className="muted">Saved to {step.file}</span>}
    </div>
  );
}

function RunMap({ run, stages, selected, onSelect }) {
  const colW = 190;
  const rowH = 74;
  const nodeW = 150;
  const nodeH = 50;
  const rows = Math.max(1, ...stages.map(s => s.length));
  const cols = stages.length + 2; // "You" + stages + "Result"
  const width = cols * colW;
  const height = rows * rowH + 20;
  const yOf = (count, n) => (height - count * rowH) / 2 + n * rowH + (rowH - nodeH) / 2;
  const columns = [
    [{ key: 'start', label: 'You', sub: 'asked for this', status: 'done' }],
    ...stages.map(stage => stage.map(i => ({ key: `s${i}`, index: i, label: run.steps[i].botName, sub: run.steps[i].title, status: run.steps[i].status }))),
    [{ key: 'end', label: 'Result', sub: run.status === 'done' ? 'ready' : run.status === 'failed' ? 'not finished' : 'in progress', status: run.status === 'done' ? 'done' : run.status === 'failed' ? 'failed' : 'waiting' }],
  ];
  const edges = [];
  for (let c = 0; c < columns.length - 1; c++) {
    columns[c].forEach((a, ai) => {
      columns[c + 1].forEach((b, bi) => {
        edges.push({
          key: `${a.key}-${b.key}`,
          x1: c * colW + 20 + nodeW,
          y1: yOf(columns[c].length, ai) + nodeH / 2,
          x2: (c + 1) * colW + 20,
          y2: yOf(columns[c + 1].length, bi) + nodeH / 2,
          live: a.status === 'done' && b.status !== 'waiting',
        });
      });
    });
  }
  return (
    <div className="run-map-scroll">
      <svg className="run-map" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', minWidth: Math.min(width, 520), maxWidth: width }} role="img" aria-label={`Who hands work to whom in ${run.workflowName}`} data-testid="run-map">
        {edges.map(e => (
          <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className={e.live ? 'run-edge is-live' : 'run-edge'} />
        ))}
        {columns.map((col, c) =>
          col.map((n, ni) => {
            const x = c * colW + 20;
            const y = yOf(col.length, ni);
            const clickable = n.index !== undefined;
            return (
              <g
                key={n.key}
                className={`run-node is-${n.status}${selected === n.index && clickable ? ' is-selected' : ''}`}
                transform={`translate(${x},${y})`}
                {...(clickable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `${n.label}: ${n.sub}. ${STATUS_WORD[n.status]}`,
                      onClick: () => onSelect(n.index),
                      onKeyDown: ev => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onSelect(n.index);
                        }
                      },
                    }
                  : {})}
              >
                <rect width={nodeW} height={nodeH} />
                <text x={10} y={20} className="run-node-name">{n.label}</text>
                <text x={10} y={37} className="run-node-sub">{n.sub.length > 22 ? `${n.sub.slice(0, 21)}…` : n.sub}</text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/**
 * Watch one workflow run: what stage it is in, what each teammate did, and who handed work to
 * whom. Everything shown is read from the run record the engine saves; nothing is simulated.
 */
export function TeamRunView({ run, bots = [], onClose }) {
  const [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const feedRef = useRef(null);
  const running = run.status === 'running';

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const eventCount = run.events?.length || 0;
  useEffect(() => {
    if (tab === 'activity' && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [tab, eventCount]);

  const stages = stagesOf(run.steps);
  const doneCount = run.steps.filter(s => s.status === 'done').length;
  const percent = Math.round((doneCount / run.steps.length) * 100);
  const botOf = id => bots.find(b => b.id === id);
  const members = [...new Map(run.steps.map(s => [s.botId, s])).keys()].map(botId => {
    const mine = run.steps.filter(s => s.botId === botId);
    const active = mine.find(s => s.status === 'running');
    const failed = mine.find(s => s.status === 'failed');
    const finished = mine.filter(s => s.status === 'done');
    return {
      botId,
      bot: botOf(botId),
      name: mine[0].botName,
      state: active ? 'running' : failed ? 'failed' : finished.length === mine.length ? 'done' : 'waiting',
      line: active ? `Working on: ${active.title}` : failed ? `Could not finish: ${failed.title}` : finished.length === mine.length ? `Finished ${finished.length} step${finished.length === 1 ? '' : 's'}` : `Waiting for an earlier step`,
      ms: mine.reduce((sum, s) => sum + (Number.isFinite(stepMs(s, now)) ? stepMs(s, now) : 0), 0),
      steps: mine,
    };
  });
  const totalMs = (run.finishedAt ? new Date(run.finishedAt) : now) - new Date(run.startedAt);

  return (
    <section className="run-view" data-testid="team-run-view" aria-label={`Run of ${run.workflowName}`}>
      <header className="run-head">
        <div>
          <strong>{run.workflowName}</strong>
          <span className={`status-pill run-status is-${run.status}`}>{RUN_WORD[run.status] || run.status}</span>
          <span className="muted">{doneCount} of {run.steps.length} steps done · {formatDuration(totalMs)}</span>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </header>
      <div className="run-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Steps finished">
        <div className={`is-${run.status}`} style={{ width: `${percent}%` }} />
      </div>

      <div className="run-tabs" role="tablist" aria-label="Run details">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'run-tab is-on' : 'run-tab'} data-testid={`run-tab-${t.id}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'activity' && eventCount > 0 ? ` ${eventCount}` : ''}
            {t.id === 'team' ? ` ${members.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="run-body" role="tabpanel">
          {run.error && <div role="alert" className="wizard-error">{run.error}</div>}
          <ol className="run-stages">
            {stages.map((stage, n) => (
              <li key={n}>
                <span className="run-stage-label">Stage {n + 1}{stage.length > 1 ? ` · ${stage.length} at the same time` : ''}</span>
                {stage.map(i => {
                  const s = run.steps[i];
                  return (
                    <button key={i} type="button" className={`run-step is-${s.status}${selected === i ? ' is-selected' : ''}`} onClick={() => setSelected(selected === i ? null : i)} aria-expanded={selected === i}>
                      <span className="run-dot" aria-hidden="true" />
                      <span className="run-step-title">{s.title}</span>
                      <span className="muted">{s.botName}</span>
                      <span className="run-step-state">{STATUS_WORD[s.status]}{Number.isFinite(stepMs(s, now)) ? ` · ${formatDuration(stepMs(s, now))}` : ''}</span>
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>
          {selected !== null ? <StepOutput step={run.steps[selected]} /> : run.status === 'done' && <StepOutput step={run.steps.at(-1)} />}
          <div className="run-roster">
            {members.map(m => (
              <span key={m.botId} className={`run-face is-${m.state}`} title={`${m.name}: ${m.line}`}>
                <BotAvatar bot={m.bot} shape={m.bot?.shape} color={m.bot?.color} size={22} state={m.state === 'running' ? 'running' : 'idle'} />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="run-body run-feed" role="tabpanel" ref={feedRef} data-testid="run-activity">
          {eventCount === 0 && <span className="muted">This run was recorded before activity tracking existed. Run it again to see each step as it happens.</span>}
          {(run.events || []).map((e, i) => (
            <div key={i} className={`run-event is-${e.kind}`}>
              <time dateTime={e.at}>{clock(e.at)}</time>
              <span className="work-color-sq" style={{ background: botOf(e.botId)?.color || 'var(--ink-subtle)' }} aria-hidden="true" />
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'team' && (
        <div className="run-body run-members" role="tabpanel">
          {members.map(m => (
            <article key={m.botId} className={`run-member is-${m.state}`}>
              <BotAvatar bot={m.bot} shape={m.bot?.shape} color={m.bot?.color} size={30} state={m.state === 'running' ? 'running' : 'idle'} />
              <div>
                <strong>{m.name}</strong> <span className="muted">{m.bot?.role || ''}</span>
                <div>{m.line}{m.ms > 0 ? ` · ${formatDuration(m.ms)}` : ''}</div>
                {m.steps.filter(s => s.output).map(s => (
                  <details key={s.title}>
                    <summary>{s.title}</summary>
                    <pre className="code-block">{s.output}</pre>
                  </details>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'map' && (
        <div className="run-body" role="tabpanel">
          <p className="muted">Work moves left to right. Boxes in one column run at the same time. Pick a box to read what that teammate produced.</p>
          <RunMap run={run} stages={stages} selected={selected} onSelect={i => setSelected(selected === i ? null : i)} />
          {selected !== null && <StepOutput step={run.steps[selected]} />}
        </div>
      )}
    </section>
  );
}
