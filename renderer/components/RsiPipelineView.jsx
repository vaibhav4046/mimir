import React, { useEffect, useState } from 'react';
import { apiFetch, fetchArtifactBlob } from '../api.js';
import { CloseCrossSvg, RsiScaleSvg } from './Icons.jsx';
import { MimirAsset } from './MimirAsset.jsx';

export function RsiPipelineView({ activeBotId, settings, modelStatus, onSettingsSaved, onProbeModels }) {
  const [rsiState, setRsiState] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [ragGraph, setRagGraph] = useState(null);
  const [agiState, setAgiState] = useState(null);
  const [evalReport, setEvalReport] = useState(null);
  const [cragQuery, setCragQuery] = useState('');
  const [cragWebFallback, setCragWebFallback] = useState(true);
  const [cragResult, setCragResult] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [manualRule, setManualRule] = useState('');
  const [targetModelName, setTargetModelName] = useState('mimir-rsi:latest');
  const [baseModelName, setBaseModelName] = useState(settings?.ollamaModel || 'qwen3:1.7b');
  const [pullModelName, setPullModelName] = useState('qwen3:4b');
  const [workerDraft, setWorkerDraft] = useState((settings?.workerNodes || []).join(', '));
  const [dispatchPrompt, setDispatchPrompt] = useState('Report system health and current working status.');
  const [researchQuery, setResearchQuery] = useState('Compare Mimir local Qwen3-1.7B tool curation and tamper-evident receipts against ungrounded chat loops.');
  const [researchOffline, setResearchOffline] = useState(true);
  const [researchResult, setResearchResult] = useState(null);
  const [researchPacks, setResearchPacks] = useState([]);
  const [selectedPackId, setSelectedPackId] = useState('all');
  const [batchTopicsDraft, setBatchTopicsDraft] = useState('');
  const [campaignResult, setCampaignResult] = useState(null);
  const [automationState, setAutomationState] = useState(null);
  const [brutalReport, setBrutalReport] = useState(null);
  const [benchResult, setBenchResult] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState('');

  const loadAll = async () => {
    try {
      const [rState, mState, gState, aState, eState, pState] = await Promise.all([
        apiFetch(`/v1/rsi/state?botId=${encodeURIComponent(activeBotId || '')}`),
        apiFetch('/v1/metrics'),
        apiFetch('/v1/rag/graph').catch(() => null),
        apiFetch('/v1/agi/state').catch(() => null),
        apiFetch('/v1/agi/eval').catch(() => null),
        apiFetch('/v1/research/packs').catch(() => null),
      ]);
      setRsiState(rState);
      setMetrics(mState);
      setRagGraph(gState);
      setAgiState(aState);
      setEvalReport(aState?.evalReport || aState?.latestEval || aState?.eval || eState || null);
      if (pState?.packs) setResearchPacks(pState.packs);
      if (pState?.automation) setAutomationState(pState.automation);
      if (pState?.campaigns?.[0]) setCampaignResult(prev => prev || pState.campaigns[0]);
      if (pState?.latestBrutalReport) setBrutalReport(prev => prev || pState.latestBrutalReport);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  useEffect(() => {
    loadAll();
  }, [activeBotId]);

  const handleCragQuery = async e => {
    e.preventDefault();
    if (!cragQuery.trim()) return;
    setBusy('crag');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/rag/query', {
        method: 'POST',
        body: JSON.stringify({ query: cragQuery.trim(), topK: 5, useWebFallback: cragWebFallback }),
      });
      setCragResult(res);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRunEval = async () => {
    setBusy('eval');
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch('/v1/agi/eval', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setEvalReport(res);
      setStatusMsg('Live local eval probe completed.');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleWebSearch = async e => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setBusy('search');
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch('/v1/rsi/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim(), maxResults: 5 }),
      });
      setStatusMsg(`Indexed ${res.indexedDocs} doc(s) from ${res.results?.length || 0} live results for "${res.query}".`);
      setSearchQuery('');
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleUrlIngest = async e => {
    e.preventDefault();
    if (!ingestUrl.trim()) return;
    setBusy('url');
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch('/v1/rsi/knowledge/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: ingestUrl.trim() }),
      });
      setStatusMsg(`Indexed "${res.doc?.title || ingestUrl}" (${res.chunksAdded} chunks).`);
      setIngestUrl('');
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleNoteIngest = async e => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setBusy('note');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/rsi/knowledge/ingest-note', {
        method: 'POST',
        body: JSON.stringify({ title: noteTitle.trim() || '2026 Project Fact', content: noteBody.trim() }),
      });
      setStatusMsg(`Added ${res.chunksAdded} chunks to 2026 Knowledge Index.`);
      setNoteTitle('');
      setNoteBody('');
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleAddRule = async e => {
    e.preventDefault();
    if (!manualRule.trim()) return;
    await apiFetch('/v1/rsi/rules', {
      method: 'POST',
      body: JSON.stringify({ botId: activeBotId || '', toolName: 'user-guidance', lesson: manualRule.trim() }),
    });
    setManualRule('');
    await loadAll();
  };

  const handleCompileModel = async () => {
    setBusy('compile');
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch('/v1/rsi/compile-model', {
        method: 'POST',
        body: JSON.stringify({
          botId: activeBotId,
          baseModel: baseModelName,
          targetModelName,
        }),
      });
      setStatusMsg(`Compiled Ollama model "${res.modelName}" from ${res.baseModel}. Switch default model in Settings or Bot Configure to use it.`);
      await onProbeModels?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handlePullModel = async e => {
    e.preventDefault();
    if (!pullModelName.trim()) return;
    setBusy('pull');
    setErrorMsg('');
    setStatusMsg(`Pulling ${pullModelName.trim()} from Ollama library (may take a few minutes)...`);
    try {
      const res = await apiFetch('/v1/rsi/pull-model', {
        method: 'POST',
        body: JSON.stringify({ model: pullModelName.trim() }),
      });
      setStatusMsg(`Successfully pulled Ollama model: ${res.model}`);
      await onProbeModels?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleSaveWorkersAndProbe = async () => {
    setBusy('probe');
    setErrorMsg('');
    try {
      const urls = workerDraft
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const updated = await apiFetch('/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ workerNodes: urls }),
      });
      onSettingsSaved?.(updated);
      const res = await apiFetch('/v1/workers/probe', {
        method: 'POST',
        body: JSON.stringify({ urls }),
      });
      setStatusMsg(`Probed ${res.workers?.length || 0} horizontal peer node(s).`);
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleDispatchScaled = async () => {
    if (!dispatchPrompt.trim()) return;
    setBusy('dispatch');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/workers/dispatch', {
        method: 'POST',
        body: JSON.stringify({ botId: activeBotId, userText: dispatchPrompt.trim(), priority: 2 }),
      });
      setStatusMsg(`Task executed via ${res.dispatchedTo} (thread ${res.threadId}).`);
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRunDeepResearch = async e => {
    e?.preventDefault();
    if (!researchQuery.trim()) return;
    setBusy('research');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/research/run', {
        method: 'POST',
        body: JSON.stringify({
          query: researchQuery.trim(),
          mode: researchOffline ? 'offline' : 'live',
          botId: activeBotId,
          exportFormats: ['md', 'docx', 'pdf'],
        }),
      });
      setResearchResult(res);
      setStatusMsg(`Deep research finished (${res.evidenceSpans?.length || 0} cited sources, receipt ${String(res.receipt?.eventHash || '').slice(0, 10)}).`);
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRunResearchCampaign = async () => {
    setBusy('campaign');
    setErrorMsg('');
    try {
      const topics = batchTopicsDraft
        .split(/[|\n;]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const res = await apiFetch('/v1/research/campaign', {
        method: 'POST',
        body: JSON.stringify({
          packId: selectedPackId,
          topics,
          mode: researchOffline ? 'offline' : 'live',
          maxSourcesPerTopic: 6,
          ingestIntoKnowledge: true,
          exportFormats: ['md', 'docx', 'pdf', 'csv'],
          botId: activeBotId,
        }),
      });
      setCampaignResult(res);
      setStatusMsg(
        `Multi-domain harvest finished: ${res.totalSources} unique verified sources across ${res.topicsCount} topics (${res.knowledgeIngestion?.chunksAdded || 0} KB chunks ingested).`
      );
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleExportDocument = async (sourceObj, isCampaign, fmt) => {
    setBusy(`export-${fmt}`);
    setErrorMsg('');
    try {
      let doc = (sourceObj?.artifacts || []).find(a => String(a?.format || '').toLowerCase() === fmt);
      if (!doc) {
        const res = await apiFetch('/v1/research/export', {
          method: 'POST',
          body: JSON.stringify({
            runId: !isCampaign ? sourceObj?.id : null,
            campaignId: isCampaign ? sourceObj?.id : null,
            title: isCampaign
              ? `Research Campaign - ${sourceObj?.packId || 'ALL'}`
              : `Research Report - ${sourceObj?.query || researchQuery}`,
            reportMarkdown: sourceObj?.reportMarkdown || sourceObj?.reportText || '',
            sections: sourceObj?.sections || [],
            rows: sourceObj?.tableRows || [],
            formats: [fmt],
            botId: activeBotId,
          }),
        });
        doc = res.documents?.[0];
      }
      if (doc?.id) {
        const blob = await fetchArtifactBlob(doc.id, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mimir-research.${fmt}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        setStatusMsg(`Exported and downloaded research report as .${fmt.toUpperCase()}.`);
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleAutomateResearch = async () => {
    setBusy('automate');
    setErrorMsg('');
    try {
      const topics = batchTopicsDraft
        .split(/[|\n;]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const res = await apiFetch('/v1/research/automate', {
        method: 'POST',
        body: JSON.stringify({
          enabled: true,
          intervalMinutes: 60,
          packId: selectedPackId,
          topics,
          mode: researchOffline ? 'offline' : 'live',
          botId: activeBotId,
          runNow: true,
        }),
      });
      if (res.automation) setAutomationState(res.automation);
      if (res.campaign) setCampaignResult(res.campaign);
      setStatusMsg(
        `Scheduled Auto-Harvester routine every ${res.automation?.intervalMinutes || 60}m & harvested ${res.campaign?.totalSources || 0} sources.`
      );
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRunBrutalStressSuite = async () => {
    setBusy('brutal');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/research/brutal-test', {
        method: 'POST',
        body: JSON.stringify({ botId: activeBotId }),
      });
      setBrutalReport(res);
      setStatusMsg(
        `Brutal Stress Test: ${res.passedCount}/${res.totalChecks} checks PASSED (${res.summaryMetrics?.sourcesHarvested || 0} sources, ${res.summaryMetrics?.knowledgeChunksAdded || 0} KB chunks).`
      );
      await loadAll();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRunLoadBenchmark = async () => {
    setBusy('benchmark');
    setErrorMsg('');
    try {
      const res = await apiFetch('/v1/metrics/benchmark');
      setBenchResult(res);
      setStatusMsg(`Multi-user fair queue benchmark completed across ${res.tiers?.length || 0} concurrency tiers.`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const stats = rsiState?.stats || {};
  const counters = metrics?.counters || {};
  const graphNodesCount = Array.isArray(ragGraph?.nodes) ? ragGraph.nodes.length : (ragGraph?.nodes ?? ragGraph?.nodeCount ?? 0);
  const graphEdgesCount = Array.isArray(ragGraph?.edges) ? ragGraph.edges.length : (ragGraph?.edges ?? ragGraph?.edgeCount ?? 0);
  const graphSampleEntities = Array.isArray(ragGraph?.topEntities)
    ? ragGraph.topEntities
    : Array.isArray(ragGraph?.nodes)
      ? ragGraph.nodes.slice(0, 12)
      : [];
  const evalObj = evalReport || agiState?.evalReport || agiState?.latestEval || agiState?.eval || null;
  const evalComparisonRows = Array.isArray(evalObj?.comparison) ? evalObj.comparison : [];
  const evalBenchRows = Array.isArray(evalObj?.benchmarked) ? evalObj.benchmarked : [];

  return (
    <div className="view-scroll" data-testid="rsi-view">
      <div className="view-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <RsiScaleSvg size={18} />
              <span>Knowledge, RSI &amp; Scaling</span>
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              CRAG + LightRAG retrieval, learned error rules, local eval harness (<code>{settings?.ollamaModel || 'qwen3:1.7b'}</code>), and worker pool telemetry.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={loadAll}>
            Refresh
          </button>
        </div>

        {statusMsg && (
          <div className="card" style={{ borderColor: 'var(--ok)', background: 'var(--ok-soft)', padding: 10 }}>
            <strong>{statusMsg}</strong>
          </div>
        )}
        {errorMsg && (
          <div className="card" style={{ borderColor: 'var(--err)', background: 'var(--err-soft)', padding: 10 }}>
            <strong>Error: {errorMsg}</strong>
          </div>
        )}

        {/* Section 1: Live 2026 Knowledge Base + LightRAG & CRAG */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="scroll" size={18} />
              <span>1. 2026 Knowledge &amp; LightRAG Graph ({stats.knowledgeDocs || 0} docs / {stats.knowledgeChunks || 0} chunks)</span>
            </h3>
            <div className="chip-list">
              <span className="chip" data-testid="rag-graph-nodes">Graph Nodes: {graphNodesCount}</span>
              <span className="chip" data-testid="rag-graph-edges">Graph Edges: {graphEdgesCount}</span>
            </div>
          </div>

          {graphSampleEntities.length > 0 && (
            <div className="chip-list">
              {graphSampleEntities.slice(0, 10).map((ent, idx) => (
                <span key={idx} className="chip">
                  {typeof ent === 'string' ? ent : ent.label || ent.name || ent.id}
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleCragQuery} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: '1 1 220px' }}
              placeholder="Test CRAG + Self-RAG retrieval query..."
              value={cragQuery}
              onChange={e => setCragQuery(e.target.value)}
              data-testid="crag-query-input"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={cragWebFallback}
                onChange={e => setCragWebFallback(e.target.checked)}
              />
              <span>Web fallback</span>
            </label>
            <button type="submit" className="btn btn-primary btn-sm" data-testid="crag-query-btn" disabled={busy === 'crag'}>
              {busy === 'crag' ? 'Evaluating...' : 'Test CRAG'}
            </button>
          </form>

          {cragResult && (
            <div className="crag-result-box" data-testid="crag-result">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  className="status-pill crag-grade-pill"
                  data-grade={cragResult.grade || 'AMBIGUOUS'}
                >
                  CRAG: {cragResult.grade || 'N/A'}
                </span>
                {cragResult.confidence != null && (
                  <span className="status-pill">
                    Confidence: {Math.round(Number(cragResult.confidence) * 100)}%
                  </span>
                )}
                {cragResult.webUsed && <span className="status-pill">Web Fallback Used</span>}
              </div>
              {Array.isArray(cragResult.graphEntities) && cragResult.graphEntities.length > 0 && (
                <div className="chip-list">
                  {cragResult.graphEntities.map((ge, i) => (
                    <span key={i} className="chip">{typeof ge === 'string' ? ge : ge.label || ge.name || ge.id}</span>
                  ))}
                </div>
              )}
              {(cragResult.citations?.length > 0 || cragResult.contextBlock) && (
                <pre className="tool-output-pre">
                  {cragResult.contextBlock || JSON.stringify(cragResult.citations, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className="grid-2">
            <form onSubmit={handleWebSearch} style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Search 2026 web..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                data-testid="rsi-search-input"
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'search'}>
                {busy === 'search' ? '...' : 'Fetch 2026'}
              </button>
            </form>

            <form onSubmit={handleUrlIngest} style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Ingest URL..."
                value={ingestUrl}
                onChange={e => setIngestUrl(e.target.value)}
              />
              <button type="submit" className="btn btn-sm" disabled={busy === 'url'}>
                {busy === 'url' ? '...' : 'Scrape URL'}
              </button>
            </form>
          </div>

          <form onSubmit={handleNoteIngest} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder="Note title..."
              value={noteTitle}
              onChange={e => setNoteTitle(e.target.value)}
            />
            <input
              className="input"
              style={{ flex: '2 1 260px' }}
              placeholder="Paste 2026 fact or changelog..."
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
            />
            <button type="submit" className="btn btn-sm" disabled={busy === 'note'}>
              Index Note
            </button>
          </form>

          {(rsiState?.docs || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {rsiState.docs.map(doc => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    background: 'var(--bg-rail)',
                    border: '1px solid var(--rule)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                      {String(doc.title || '').startsWith(doc.yearTag || '2026') ? doc.title : `[${doc.yearTag}] ${doc.title}`} ({doc.chunkCount} {doc.chunkCount === 1 ? 'chunk' : 'chunks'})
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.url || doc.preview}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    title="Delete indexed doc"
                    onClick={async () => {
                      await apiFetch(`/v1/rsi/knowledge/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
                      await loadAll();
                    }}
                  >
                    <CloseCrossSvg size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: RSI Learned Rules + SFT / DPO Post-Training Compilation */}
        <div className="grid-2">
          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="well-of-wisdom" size={18} />
              <span>2. Learned Error Rules ({rsiState?.rules?.length || 0})</span>
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>
              Failed tool calls automatically distill corrective rules into future prompts.
            </p>
            <form onSubmit={handleAddRule} style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="Teach explicit rule..."
                value={manualRule}
                onChange={e => setManualRule(e.target.value)}
                data-testid="rsi-rule-input"
              />
              <button type="submit" className="btn btn-sm">Add Rule</button>
            </form>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {(rsiState?.rules || []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>No rules learned yet.</div>
              ) : (
                rsiState.rules.map(r => (
                  <div key={r.id} style={{ padding: '7px 10px', background: 'var(--bg-rail)', border: '1px solid var(--rule)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                      <strong style={{ color: 'var(--brass)' }}>{r.toolName} (hits: {r.hits})</strong>
                      <button
                        type="button"
                        className="btn btn-icon btn-sm"
                        style={{ width: 22, height: 22 }}
                        onClick={async () => {
                          await apiFetch(`/v1/rsi/rules/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
                          await loadAll();
                        }}
                      >
                        <CloseCrossSvg size={11} />
                      </button>
                    </div>
                    <div style={{ fontSize: 12 }}>{r.lesson}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="yggdrasil-seed" size={18} />
              <span>3. Post-Training &amp; Ollama Modelfile</span>
            </h3>
            <div className="chip-list">
              <span className="chip">SFT: {stats.sftCount || 0}</span>
              <span className="chip">DPO: {stats.dpoCount || 0}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>
              Exports SFT/DPO JSONL traces and compiles learned rules into a local Ollama variant.
            </p>
            <div className="grid-2">
              <label className="field-label">
                Base Model
                <input className="input" value={baseModelName} onChange={e => setBaseModelName(e.target.value)} />
              </label>
              <label className="field-label">
                Compiled Tag
                <input className="input" value={targetModelName} onChange={e => setTargetModelName(e.target.value)} />
              </label>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCompileModel} disabled={busy === 'compile'}>
              {busy === 'compile' ? 'Compiling...' : 'Compile Ollama Modelfile'}
            </button>

            <form onSubmit={handlePullModel} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input
                className="input"
                placeholder="Pull tag (e.g. qwen3:4b, llama3.2)"
                value={pullModelName}
                onChange={e => setPullModelName(e.target.value)}
              />
              <button type="submit" className="btn btn-sm" disabled={busy === 'pull'}>
                {busy === 'pull' ? 'Pulling...' : 'Pull Model'}
              </button>
            </form>
            <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)' }}>
              Installed: {(modelStatus?.ollama?.models || []).join(', ') || 'probing...'}
            </div>
          </div>
        </div>

        {/* Section 4: Raw vs Harnessed Local Eval Comparison */}
        <div className="card" data-testid="eval-comparison-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              4. Raw vs Harnessed Local Model Eval
            </h3>
            <button type="button" className="btn btn-sm" onClick={handleRunEval} disabled={busy === 'eval'}>
              {busy === 'eval' ? 'Running Eval...' : 'Run Live Eval'}
            </button>
          </div>

          {evalComparisonRows.length > 0 ? (
            <div className="eval-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>Task / Model</th>
                    <th>Raw Baseline</th>
                    <th>Harnessed (TTC + Reflexion)</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {evalComparisonRows.map((row, idx) => (
                    <tr key={row.id || row.taskId || row.model || idx}>
                      <td><strong>{row.taskId || row.id || row.model || `Task ${idx + 1}`}</strong></td>
                      <td>{row.baselineScore != null ? `${row.baselineScore}%` : row.baselinePassed ? 'PASS' : 'FAIL'}</td>
                      <td>{row.harnessedScore != null ? `${row.harnessedScore}%` : row.harnessedPassed ? 'PASS' : 'FAIL'}</td>
                      <td>{row.delta || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : evalObj?.baseline && evalObj?.harnessed ? (
            <div className="eval-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Model</th>
                    <th>Passed</th>
                    <th>Score</th>
                    <th>Avg TTFT</th>
                    <th>Tok/s</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { mode: 'Raw Baseline', data: evalObj.baseline },
                    { mode: 'Harnessed (TTC + Reflexion)', data: evalObj.harnessed },
                  ].map(entry => (
                    <tr key={entry.mode}>
                      <td><strong>{entry.mode}</strong></td>
                      <td><code>{entry.data.model || 'qwen3:1.7b'}</code></td>
                      <td>{entry.data.passedCount ?? '—'} / {entry.data.totalTasks ?? '—'}</td>
                      <td><strong>{entry.data.scorePct ?? '—'}%</strong></td>
                      <td>{entry.data.avgTtftMs != null ? `${entry.data.avgTtftMs} ms` : '—'}</td>
                      <td>{entry.data.avgTokPerSec ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : evalBenchRows.length > 0 ? (
            <div className="eval-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Mode</th>
                    <th>Passed</th>
                    <th>Score</th>
                    <th>Avg TTFT</th>
                    <th>Tok/s</th>
                  </tr>
                </thead>
                <tbody>
                  {evalBenchRows.map((b, idx) => (
                    <tr key={`${b.model || 'm'}-${b.mode || idx}`}>
                      <td><code>{b.model}</code></td>
                      <td>{b.mode || (b.harnessed ? 'baseline -> harnessed' : 'baseline')}</td>
                      <td>
                        {b.baseline && b.harnessed
                          ? `${b.baseline.passedCount}/${b.baseline.totalTasks} -> ${b.harnessed.passedCount}/${b.harnessed.totalTasks}`
                          : `${b.passedCount ?? 0} / ${b.totalTasks ?? 0}`}
                      </td>
                      <td>
                        <strong>
                          {b.baseline && b.harnessed
                            ? `${b.baseline.scorePct}% -> ${b.harnessed.scorePct}%`
                            : `${b.scorePct ?? 0}%`}
                        </strong>
                      </td>
                      <td>{b.avgTtftMs != null ? `${b.avgTtftMs} ms` : '—'}</td>
                      <td>{b.avgTokPerSec ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)' }}>
              No live eval recorded yet. Click Run Live Eval to benchmark installed local models honestly.
            </div>
          )}

          {evalObj?.disclaimer && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)' }}>{evalObj.disclaimer}</div>
          )}
        </div>

        {/* Section 5: Scaling Telemetry & Worker Pool */}
        <div className="card" data-testid="scale-telemetry-card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="dwarven-gear" size={18} />
            <span>5. Worker Pool, Circuit Breaker &amp; Federation</span>
          </h3>
          <div className="grid-3">
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Worker Pool / Priority</span>
              <strong>Active {metrics?.activeCount ?? 0} / {metrics?.maxConcurrent ?? 3} (Queued: {metrics?.queuedCount ?? 0})</strong>
            </div>
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Rate Bucket / Depth</span>
              <strong>Tokens: {metrics?.availableTokens ?? 0} / {metrics?.rateLimitPerMinute ?? 40} (Cap: {metrics?.maxQueueDepth ?? 64})</strong>
            </div>
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Circuit Breaker / Cache</span>
              <strong>{metrics?.circuitState || 'CLOSED'} | Cache hits: {counters.cacheHits ?? 0}</strong>
            </div>
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Completed / Failed</span>
              <strong>Completed: {counters.completed ?? 0} | Failed: {counters.failed ?? 0}</strong>
            </div>
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Latency Telemetry</span>
              <strong>Avg {counters.avgLatencyMs ?? 0}ms | Err {counters.errorRatePct ?? 0}%</strong>
            </div>
            <div className="tool-card">
              <span style={{ color: 'var(--ink-subtle)' }}>Horizontal Dispatches</span>
              <strong>Remote delegated: {counters.dispatchedHorizontal ?? 0}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field-label" style={{ flex: '2 1 280px' }}>
              Horizontal Peer Coordinator URLs (comma-separated)
              <input
                className="input"
                placeholder="http://127.0.0.1:4568, http://192.168.1.50:4567"
                value={workerDraft}
                onChange={e => setWorkerDraft(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-sm" onClick={handleSaveWorkersAndProbe} disabled={busy === 'probe'}>
              {busy === 'probe' ? 'Probing...' : 'Save & Probe Peers'}
            </button>
          </div>

          {(metrics?.workerNodes || []).length > 0 && (
            <div className="chip-list">
              {metrics.workerNodes.map(w => (
                <span key={w.url} className="chip" style={{ borderColor: w.ok ? 'var(--ok)' : 'var(--err)' }}>
                  {w.url}: {w.ok ? `ONLINE (${w.latencyMs}ms)` : `OFFLINE (${w.error || w.status})`}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={dispatchPrompt}
              onChange={e => setDispatchPrompt(e.target.value)}
            />
            <button type="button" className="btn btn-sm" onClick={handleDispatchScaled} disabled={busy === 'dispatch'}>
              {busy === 'dispatch' ? 'Running...' : 'Dispatch Scaled Task'}
            </button>
          </div>
        </div>

        {/* Section 6: Deep Research & Grounded Citation Studio */}
        <div className="card" data-testid="deep-research-studio">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="odin-ravens" size={18} />
              <span>6. Deep Research &amp; Grounded Citation Studio</span>
            </h3>
            {researchResult && (
              <div className="chip-list">
                <span className={`pill ${researchResult.citationCheck?.valid ? 'is-emerald' : 'is-crimson'}`}>
                  {researchResult.citationCheck?.valid ? 'Citations Valid' : 'Citation Warning'}
                </span>
                <span className="chip">
                  Cited: {researchResult.citationCheck?.citedSourceIds?.length || 0} / {researchResult.evidenceSpans?.length || 0}
                </span>
                <span className="chip">
                  Contradictions: {researchResult.contradictions?.length || 0}
                </span>
                <span className="chip">
                  Gaps: {researchResult.gaps?.length || 0}
                </span>
                {researchResult.receipt?.eventHash && (
                  <span className="chip">
                    Receipt: <code>{String(researchResult.receipt.eventHash).slice(0, 12)}</code>
                  </span>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleRunDeepResearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: '1 1 280px' }}
              placeholder="Ask a multi-part research question..."
              value={researchQuery}
              onChange={e => setResearchQuery(e.target.value)}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={researchOffline}
                onChange={e => setResearchOffline(e.target.checked)}
              />
              Offline corpus only
            </label>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              data-testid="run-deep-research-btn"
              disabled={busy === 'research'}
            >
              {busy === 'research' ? 'Researching...' : 'Run Grounded Research'}
            </button>
          </form>

          {researchResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <pre
                data-testid="deep-research-synthesis"
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-soft, rgba(255,255,255,0.03))',
                  border: '1px solid var(--rule)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 220,
                  overflow: 'auto',
                }}
              >
                {researchResult.reportText}
              </pre>
              {(researchResult.evidenceSpans || []).length > 0 && (
                <div className="chip-list">
                  {researchResult.evidenceSpans.map(span => (
                    <span key={span.sourceId} className="chip" title={span.quote}>
                      [{span.sourceId}] {span.title} ({span.quality?.overallScore ?? '—'})
                    </span>
                  ))}
                </div>
              )}
              <div className="research-doc-pills" data-testid="rsi-research-export-bar">
                {['md', 'docx', 'pdf', 'pptx', 'xlsx', 'csv', 'html', 'json', 'zip'].map(fmt => (
                  <button
                    key={fmt}
                    type="button"
                    className={`research-doc-pill ${fmt === 'md' || fmt === 'docx' || fmt === 'pdf' ? 'is-primary' : ''}`}
                    disabled={Boolean(busy)}
                    onClick={() => handleExportDocument(researchResult, false, fmt)}
                  >
                    {busy === `export-${fmt}` ? '...' : `.${fmt.toUpperCase()}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Autonomous Multi-Domain Data Harvester, Routine Automation & Brutal Stress Suite */}
          <div
            style={{
              marginTop: 10,
              paddingTop: 12,
              borderTop: '1px solid var(--rule)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>Autonomous Multi-Topic Harvester &amp; Brutal Verification</strong>
              <span
                data-testid="research-automation-status"
                className={`pill ${automationState?.enabled ? 'is-emerald' : 'is-slate'}`}
              >
                {automationState?.enabled
                  ? `Auto-Harvester ACTIVE (${automationState.intervalMinutes || 60}m · pack=${automationState.packId || 'all'})`
                  : 'Auto-Harvester IDLE'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="select"
                data-testid="research-pack-select"
                aria-label="Research domain pack"
                style={{ minWidth: 240 }}
                value={selectedPackId}
                onChange={e => setSelectedPackId(e.target.value)}
              >
                <option value="all">All 6 Domains Mega Sweep (24 Topics)</option>
                {(researchPacks || []).map(pack => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name} ({pack.topics?.length || 0} topics)
                  </option>
                ))}
              </select>
              <input
                className="input"
                data-testid="batch-research-topics-input"
                style={{ flex: '1 1 220px' }}
                placeholder="Optional custom topics separated by | (leave blank for pack sweep)"
                value={batchTopicsDraft}
                onChange={e => setBatchTopicsDraft(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="run-batch-research-btn"
                onClick={handleRunResearchCampaign}
                disabled={Boolean(busy)}
              >
                {busy === 'campaign' ? 'Harvesting Data...' : 'Gather Multi-Topic Data Pack'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="automate-research-routine-btn"
                onClick={handleAutomateResearch}
                disabled={Boolean(busy)}
              >
                {busy === 'automate' ? 'Scheduling & Harvesting...' : 'Automate Harvester Routine (60m + Run Now)'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                data-testid="run-brutal-research-test-btn"
                onClick={handleRunBrutalStressSuite}
                disabled={Boolean(busy)}
              >
                {busy === 'brutal' ? 'Running Torture Suite...' : 'Run Brutal Stress Test (8/8 Torture Suite)'}
              </button>
            </div>

            {campaignResult && (
              <div
                data-testid="research-dataset-table"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-soft, rgba(255,255,255,0.03))',
                  border: '1px solid var(--rule)',
                }}
              >
                <div className="chip-list">
                  <span className="pill is-emerald">Harvested: {campaignResult.totalSources} unique sources</span>
                  <span className="chip">Topics Swept: {campaignResult.topicsCount}</span>
                  <span className="chip">KB Chunks Ingested: {campaignResult.knowledgeIngestion?.chunksAdded ?? 0}</span>
                  <span className="chip">
                    LightRAG Graph: {campaignResult.knowledgeIngestion?.graph?.nodes ?? 0} nodes / {campaignResult.knowledgeIngestion?.graph?.edges ?? 0} edges
                  </span>
                  {campaignResult.files?.csvPath && (
                    <span className="chip" title={campaignResult.files.csvPath}>
                      Saved CSV: <code>research-harvester-latest.csv</code>
                    </span>
                  )}
                </div>

                <div className="research-doc-pills" data-testid="rsi-campaign-export-bar">
                  {['md', 'docx', 'pdf', 'pptx', 'xlsx', 'csv', 'html', 'json', 'zip'].map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      className={`research-doc-pill ${fmt === 'md' || fmt === 'docx' || fmt === 'pdf' ? 'is-primary' : ''}`}
                      disabled={Boolean(busy)}
                      onClick={() => handleExportDocument(campaignResult, true, fmt)}
                    >
                      {busy === `export-${fmt}` ? '...' : `.${fmt.toUpperCase()}`}
                    </button>
                  ))}
                </div>

                <div style={{ maxHeight: 220, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rule)' }}>
                        <th style={{ padding: '4px 6px' }}>Row</th>
                        <th style={{ padding: '4px 6px' }}>Domain</th>
                        <th style={{ padding: '4px 6px' }}>Title</th>
                        <th style={{ padding: '4px 6px' }}>Metrics</th>
                        <th style={{ padding: '4px 6px' }}>Score</th>
                        <th style={{ padding: '4px 6px' }}>SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(campaignResult.datasetRows || []).slice(0, 24).map(row => (
                        <tr key={row.rowId} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{row.rowId}</td>
                          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{row.domainType}</td>
                          <td style={{ padding: '4px 6px' }} title={row.quote}>{row.title}</td>
                          <td style={{ padding: '4px 6px' }}>{(row.metrics || []).join(', ') || '—'}</td>
                          <td style={{ padding: '4px 6px' }}>{row.overallScore}</td>
                          <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{String(row.sha256 || '').slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {brutalReport && (
              <div
                data-testid="brutal-research-report"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-soft, rgba(255,255,255,0.03))',
                  border: `1px solid ${brutalReport.ok ? 'var(--ok, #10b981)' : 'var(--err, #ef4444)'}`,
                }}
              >
                <div className="chip-list">
                  <span className={`pill ${brutalReport.ok ? 'is-emerald' : 'is-crimson'}`}>
                    {brutalReport.passedCount}/{brutalReport.totalChecks} {brutalReport.ok ? 'PASSED' : 'FAILED'}
                  </span>
                  <span className="chip">Sources: {brutalReport.summaryMetrics?.sourcesHarvested ?? 0}</span>
                  <span className="chip">KB Chunks: {brutalReport.summaryMetrics?.knowledgeChunksAdded ?? 0}</span>
                  <span className="chip">Graph Nodes: {brutalReport.summaryMetrics?.graphNodes ?? 0}</span>
                  <span className="chip">Ledger Valid: {String(Boolean(brutalReport.summaryMetrics?.ledgerVerified))}</span>
                  {brutalReport.receipt?.eventHash && (
                    <span className="chip">
                      Receipt: <code>{String(brutalReport.receipt.eventHash).slice(0, 12)}</code>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(brutalReport.checks || []).map(chk => (
                    <div
                      key={chk.id}
                      data-testid={`brutal-check-${chk.id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <span>
                        <strong style={{ color: chk.passed ? 'var(--ok, #34d399)' : 'var(--err, #f87171)', marginRight: 8 }}>
                          {chk.passed ? 'PASS' : 'FAIL'}
                        </strong>
                        {chk.name}
                      </span>
                      <span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {chk.error
                          ? chk.error
                          : Object.entries(chk.metrics || {})
                              .map(([k, v]) => `${k}=${v}`)
                              .join(' · ')}{' '}
                        ({chk.durationMs}ms)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 7: Multi-User Fair Queue & Load Benchmark */}
        <div className="card" data-testid="multi-user-benchmark-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="bifrost-portal" size={18} />
              <span>7. Multi-User Fair Queue &amp; Concurrency Benchmark</span>
            </h3>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              data-testid="run-load-benchmark-btn"
              onClick={handleRunLoadBenchmark}
              disabled={busy === 'benchmark'}
            >
              {busy === 'benchmark' ? 'Benchmarking...' : 'Run 1/2/4/8-User Load Benchmark'}
            </button>
          </div>

          {benchResult?.tiers?.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="model-table">
                <thead>
                  <tr>
                    <th>Active Users</th>
                    <th>Jobs Done</th>
                    <th>Throughput (jobs/s)</th>
                    <th>p50 Wait</th>
                    <th>p95 Wait</th>
                    <th>Cross-User Leakage</th>
                  </tr>
                </thead>
                <tbody>
                  {benchResult.tiers.map(t => (
                    <tr key={t.activeUsers}>
                      <td><strong>{t.activeUsers}</strong></td>
                      <td>{t.jobsCompleted}</td>
                      <td>{t.throughputJobsPerSec}</td>
                      <td>{t.p50WaitMs} ms</td>
                      <td>{t.p95WaitMs} ms</td>
                      <td>{t.crossUserLeakage === 0 && t.allUsersServed ? '0 (isolated)' : `${t.crossUserLeakage}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)' }}>
              Click Run 1/2/4/8-User Load Benchmark to measure fair queue isolation and latency under concurrent tenants.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
