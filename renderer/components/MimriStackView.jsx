import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

export function MimriStackView() {
  const [overview, setOverview] = useState(null);
  const [busyKey, setBusyKey] = useState('');
  const [acpCli, setAcpCli] = useState('claude-code');
  const [appPrompt, setAppPrompt] = useState('Autonomous Sprint & Cost Telemetry Console');
  const [appBundle, setAppBundle] = useState(null);
  const [appCodeTab, setAppCodeTab] = useState('preview');
  const [lastAllRun, setLastAllRun] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  const loadStatus = async () => {
    try {
      const data = await apiFetch('/v1/mimri/status');
      setOverview(data);
    } catch (e) {
      setErrMsg(e?.message || 'Failed to load Mimri stack status');
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const runAction = async (key, endpoint, payload = {}) => {
    setBusyKey(key);
    setErrMsg('');
    try {
      const out = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (out.webAppBundle) setAppBundle(out.webAppBundle);
      if (key === 'all-phases') setLastAllRun(out);
      if (key === 'app-builder' && out.sandpack_preview_html) setAppBundle(out);
      await loadStatus();
      return out;
    } catch (e) {
      setErrMsg(e?.message || `Action ${key} failed`);
      return null;
    } finally {
      setBusyKey('');
    }
  };

  const caps = overview?.capabilities || [];
  const capMap = Object.fromEntries(caps.map(c => [c.id, c]));
  const verifiedCount = caps.filter(c => c.status === 'VERIFIED').length;
  const traces = overview?.traces || { spanCount: 0, promptTokens: 0, spans: [] };
  const phaseStatus = overview?.phaseStatus || {};

  const pillarGroups = [
    { name: '1. Coding Agents', ids: ['cli-agent', 'acp-aggregator', 'async-sentry', 'pr-reviewer', 'app-builder'] },
    { name: '2. Benchmarks & RL', ids: ['swe-eval', 'cua-eval', 'dsl-eval'] },
    { name: '3. Agent Infra', ids: ['sandbox-pool', 'persistent-memory', 'crawl4ai', 'mcp-hub', 'phoenix-otel'] },
    { name: '4. Voice AI', ids: ['livekit-voice'] },
  ];

  const triggerForCap = id => {
    if (id === 'cli-agent') return () => runAction(id, '/v1/mimri/coding/cli-run', { simulatedTokens: 36400 });
    if (id === 'acp-aggregator') return () => runAction(id, '/v1/mimri/coding/acp-spawn', { cli: acpCli, prompt: 'Verify workspace' });
    if (id === 'async-sentry') return () => runAction(id, '/v1/mimri/coding/async-sentry', { source: 'sentry', confidenceThreshold: 0.8 });
    if (id === 'pr-reviewer') return () => runAction(id, '/v1/mimri/coding/pr-review', { prNumber: 108, simulateFailure: false });
    if (id === 'app-builder') return () => runAction(id, '/v1/mimri/coding/app-builder', { prompt: appPrompt, appName: 'mimri-telemetry-app' });
    if (id === 'swe-eval') return () => runAction(id, '/v1/mimri/evals/swe-bench', { fixPatch: true });
    if (id === 'cua-eval') return () => runAction(id, '/v1/mimri/evals/computer-use', {});
    if (id === 'dsl-eval') return () => runAction(id, '/v1/mimri/evals/reasoning-dsl', {});
    if (id === 'sandbox-pool') return () => runAction(id, '/v1/mimri/infra/sandbox-run', { language: 'python', code: 'print(sum(range(1, 11)))' });
    if (id === 'persistent-memory') return () => runAction(id, '/v1/mimri/infra/memory-sync', {});
    if (id === 'crawl4ai') return () => runAction(id, '/v1/mimri/infra/crawl4ai', {});
    if (id === 'mcp-hub') return () => runAction(id, '/v1/mimri/infra/mcp-hub', { tool: 'github.pr_metadata' });
    if (id === 'livekit-voice') return () => runAction(id, '/v1/mimri/voice/room-turn', { bargeInActive: false });
    return () => loadStatus();
  };

  const renderCapSummary = cap => {
    const r = cap?.lastResult;
    if (!r) return 'Ready to exercise live';
    if (cap.id === 'cli-agent') return `Compacted=${String(r.compaction?.compacted)} (${r.compaction?.tokens_before} -> ${r.compaction?.tokens_after} tok) · ${r.subagent_searches?.length || 0} async searches`;
    if (cap.id === 'acp-aggregator') return `Session ${r.session_id} · ${r.agent} (${r.mode})`;
    if (cap.id === 'async-sentry') return `Confidence=${r.confidence} (>=${r.confidence_threshold}) · PR=${r.pr_branch || 'none'}`;
    if (cap.id === 'pr-reviewer') return `Verdict=${r.verdict} · inline_comments=${r.inline_comments?.length ?? 0}`;
    if (cap.id === 'app-builder') return `Generated ${r.app_name} (${(r.file_names || []).join(', ')})`;
    if (cap.id === 'swe-eval') return `${r.task_id} · passed=${String(r.passed)} (${r.mode})`;
    if (cap.id === 'cua-eval') return `goal_reached=${String(r.goal_reached)} · coords=${r.grounded_coords_pct}%`;
    if (cap.id === 'dsl-eval') return `ARC-AGI Grid=${String(r.grid?.passed)} · MimriDSL=${r.dsl?.actual}`;
    if (cap.id === 'sandbox-pool') return `exit=${r.exit_code} (${r.mode}) · stdout="${String(r.stdout || '').trim()}"`;
    if (cap.id === 'persistent-memory') return `pgvector/trgm hits=${r.hits?.length || 0} · MEMORY.md synced`;
    if (cap.id === 'crawl4ai') return `Markdown=${r.markdown?.length || 0} chars · title="${r.extracted?.title || ''}"`;
    if (cap.id === 'mcp-hub') return `Mounted ${(r.servers || []).length} servers · ${(r.tools || []).length} tools`;
    if (cap.id === 'livekit-voice') return `isolated_tracks=${String(r.per_speaker_tracks_isolated)} · should_speak=${String(r.turn_decision?.should_speak)}`;
    return 'Active';
  };

  return (
    <div className="overview-shell" data-testid="mimri-stack-view">
      <section className="card overview-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--frost)' }}>
              Mimri 2026 Unified Architecture · Phases 1–4 Complete
            </div>
            <h2 style={{ margin: '4px 0 6px', fontSize: 20 }}>
              14-Capability Stack Control Plane ({verifiedCount}/14 Verified)
            </h2>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Monorepo: <code>mimri/</code> ({overview?.filesPresent ?? 0}/{overview?.filesExpected ?? 18} core modules on disk) · Postgres+pgvector · Redis+ARQ · gVisor Sandbox · FastMCP+Crawl4AI · Arize Phoenix OTel · LiveKit+Pipecat
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {['phase1', 'phase2', 'phase3', 'phase4'].map((pk, idx) => (
              <span
                key={pk}
                className={`pill ${phaseStatus[pk] === 'VERIFIED' ? 'is-ok' : 'is-gold'}`}
                data-testid={`phase-badge-${idx + 1}`}
              >
                P{idx + 1}: {phaseStatus[pk] || 'READY'}
              </span>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              data-testid="run-all-mimri-phases-btn"
              disabled={busyKey === 'all-phases'}
              onClick={() => runAction('all-phases', '/v1/mimri/run-all-phases', {})}
            >
              {busyKey === 'all-phases' ? 'Executing Phases 1–4...' : 'Run All 4 Phases (14/14 Live)'}
            </button>
          </div>
        </div>

        {lastAllRun && (
          <div className="mimri-banner-ok" data-testid="mimri-all-phases-notice" role="status">
            Verified {lastAllRun.verifiedCount}/14 capabilities live · PR={lastAllRun.highlights?.prVerdict} · SWE={String(lastAllRun.highlights?.swePassed)} · DSL={lastAllRun.highlights?.dslOutput} · OTel Spans={lastAllRun.highlights?.otelSpanCount}
          </div>
        )}
        {errMsg && <div className="err-banner">{errMsg}</div>}
      </section>

      <div className="mimri-pillars-grid">
        {pillarGroups.map(group => (
          <section key={group.name} className="card mimri-pillar-card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', paddingBottom: 6 }}>
              <strong>{group.name}</strong>
              <span className="pill">{group.ids.length} capabilities</span>
            </div>
            <div className="mimri-cap-list">
              {group.ids.map(id => {
                const cap = capMap[id];
                if (!cap) return null;
                return (
                  <div key={id} className="mimri-cap-row" data-testid={`mimri-cap-${id}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                        #{cap.num} {cap.title}
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span className="pill" style={{ fontSize: 9.5 }}>P{cap.phase}</span>
                        <span className={`pill ${cap.status === 'VERIFIED' ? 'is-ok' : ''}`} style={{ fontSize: 9.5 }}>
                          {cap.status}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--frost)' }}>{cap.stack}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{renderCapSummary(cap)}</div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {id === 'acp-aggregator' && (
                        <select
                          aria-label="Select ACP CLI agent"
                          className="input input-sm"
                          value={acpCli}
                          onChange={e => setAcpCli(e.target.value)}
                          style={{ width: 130, fontSize: 11 }}
                        >
                          <option value="claude-code">claude-code</option>
                          <option value="codex">codex</option>
                          <option value="opencode">opencode</option>
                          <option value="mimri-cli">mimri-cli</option>
                        </select>
                      )}
                      {id === 'app-builder' && (
                        <input
                          type="text"
                          className="input input-sm"
                          value={appPrompt}
                          onChange={e => setAppPrompt(e.target.value)}
                          placeholder="Full-stack app prompt"
                          style={{ flex: '1 1 180px', fontSize: 11 }}
                        />
                      )}
                      {id !== 'phoenix-otel' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          data-testid={`mimri-run-${id}`}
                          disabled={busyKey === id}
                          onClick={triggerForCap(id)}
                        >
                          {busyKey === id ? 'Running...' : 'Run Live'}
                        </button>
                      )}
                      {id === 'livekit-voice' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          data-testid="mimri-voice-bargein-btn"
                          disabled={busyKey === 'voice-barge'}
                          onClick={() => runAction('voice-barge', '/v1/mimri/voice/room-turn', { bargeInActive: true })}
                        >
                          Test Barge-In
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mimri-bottom-grid">
        <section className="card" style={{ padding: 12, gap: 8 }} data-testid="mimri-sandpack-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>#5 Live Sandpack Full-Stack App Builder</strong>
            <div style={{ display: 'flex', gap: 4 }}>
              {['preview', 'frontend/App.jsx', 'backend/main.py', 'Dockerfile', 'vercel.json'].map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={`btn btn-sm ${appCodeTab === tab ? 'btn-primary' : ''}`}
                  onClick={() => setAppCodeTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {!appBundle ? (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Click <strong>Run All 4 Phases</strong> or <strong>#5 Web App Builder -&gt; Run Live</strong> to render live Sandpack interactive app + FastAPI + Dockerfile + Vercel config.
            </div>
          ) : appCodeTab === 'preview' ? (
            <iframe
              title="Mimri Sandpack Live Preview"
              data-testid="mimri-sandpack-iframe"
              sandbox="allow-scripts"
              srcDoc={appBundle.sandpack_preview_html}
              style={{ width: '100%', height: 220, border: '1px solid var(--rule)', background: '#0c1424' }}
            />
          ) : (
            <pre className="mimri-code-pre">{appBundle.files?.[appCodeTab] || ''}</pre>
          )}
        </section>

        <section className="card" style={{ padding: 12, gap: 8 }} data-testid="mimri-phoenix-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>#13 Arize Phoenix · OpenInference Traces ({traces.spanCount})</strong>
            <span className="pill is-ok">{traces.exporter || 'OTLP Ready'}</span>
          </div>
          <div className="mimri-trace-list">
            {(traces.spans || []).slice(0, 8).map(sp => (
              <div key={sp.spanId} className="mimri-trace-row">
                <span className="pill" style={{ fontSize: 9.5 }}>{sp.spanKind}</span>
                <span style={{ fontWeight: 600, fontSize: 11.5 }}>{sp.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5cf2b4' }}>{sp.status} · {sp.durationMs}ms</span>
              </div>
            ))}
            {(!traces.spans || traces.spans.length === 0) && (
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No OpenInference spans recorded yet — run any capability above.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
