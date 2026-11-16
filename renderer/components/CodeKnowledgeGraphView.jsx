import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';

const MAX_VISIBLE = 120;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 58;
const GAP_X = 26;
const GAP_Y = 22;
const COLS = 6;
const TYPE_COLORS = {
  Project: '#d4a44c', Folder: '#c3a76e', File: '#4cc5e3', Function: '#83c38b',
  Class: '#b895e8', Dependency: '#db9b7e', Concept: '#c6c8cf'
};
const typeColor = type => TYPE_COLORS[type] || '#8db9cb';

export function CodeKnowledgeGraphView() {
  const [graph, setGraph] = useState(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('All');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRelated, setShowRelated] = useState(true);

  const reload = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch('/v1/projects/knowledge-graph');
      if (!Array.isArray(result.nodes) || !Array.isArray(result.edges)) throw new Error('Invalid graph payload');
      setGraph(result);
      setSelectedId(previous => result.nodes.some(n => n.id === previous) ? previous : (result.nodes.find(n => n.id === 'project:root')?.id || result.nodes[0]?.id || ''));
    } catch (e) {
      setError(e.message || 'Code graph unavailable');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const byId = useMemo(() => new Map((graph?.nodes || []).map(n => [n.id, n])), [graph]);
  const edges = graph?.edges || [];
  const kinds = useMemo(() => ['All', ...new Set((graph?.nodes || []).map(n => n.type))].sort(), [graph]);

  const visible = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    let matches = graph.nodes.filter(n => (kind === 'All' || n.type === kind)
      && (!q || [n.label, n.path, n.type, n.summary, n.layer].some(v => String(v || '').toLowerCase().includes(q))));
    if (q && showRelated) {
      const frontier = new Set(matches.map(n => n.id));
      const ids = new Set(frontier);
      for (const edge of edges) {
        if (frontier.has(edge.from)) ids.add(edge.to);
        if (frontier.has(edge.to)) ids.add(edge.from);
      }
      matches = graph.nodes.filter(n => ids.has(n.id));
    }
    // Prioritize files and folders for readable initial navigation.
    if (!q && kind === 'All') {
      matches = [...matches].sort((a, b) => {
        const rank = n => ({ Project: 0, Folder: 1, File: 2, Class: 3, Function: 4, Dependency: 5 }[n.type] ?? 6);
        return rank(a) - rank(b) || String(a.path || a.label).localeCompare(String(b.path || b.label));
      });
    }
    return matches;
  }, [graph, query, kind, edges, showRelated]);

  const rendered = visible.slice(0, MAX_VISIBLE);
  const renderedIds = new Set(rendered.map(n => n.id));
  const positions = new Map(rendered.map((n, i) => [n.id, {
    x: 30 + (i % COLS) * (NODE_WIDTH + GAP_X),
    y: 34 + Math.floor(i / COLS) * (NODE_HEIGHT + GAP_Y)
  }]));
  const rows = Math.ceil(rendered.length / COLS);
  const width = 30 + COLS * (NODE_WIDTH + GAP_X);
  const height = Math.max(360, rows * (NODE_HEIGHT + GAP_Y) + 40);
  const drawnEdges = edges.filter(e => renderedIds.has(e.from) && renderedIds.has(e.to)).slice(0, 1200);
  const selected = byId.get(selectedId);
  const incoming = edges.filter(e => e.to === selectedId).slice(0, 60);
  const outgoing = edges.filter(e => e.from === selectedId).slice(0, 60);

  return (
    <section data-testid="code-knowledge-graph" style={{ display: 'grid', gap: 12, padding: '12px 0' }}>
      <div className="card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: '0 0 5px', color: 'var(--brass)' }}>Yggdrasil — Code Intelligence</h3>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 12 }}>
              Searchable local graph of files, symbols, imports and dependencies. Click a node to inspect evidence and connections.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={reload} disabled={busy}>
            {busy ? 'Scanning…' : 'Refresh graph'}
          </button>
        </div>
        {graph && (
          <div style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 12, color: 'var(--ink-muted)' }}>
            <span>{graph.stats?.nodes ?? graph.nodes.length} nodes</span>
            <span>{graph.stats?.edges ?? graph.edges.length} relationships</span>
            <span>{graph.stats?.files ?? '—'} files</span>
            <span>Source: {graph.source === 'understand-anything' ? 'Understand Anything plugin' : 'Mimir local scanner'}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="search" className="input" placeholder="Search a component, file, function, feature…" aria-label="Search code graph"
            value={query} onChange={e => setQuery(e.target.value)} style={{ minWidth: 260, flex: '1 1 260px' }} />
          <select className="input" value={kind} onChange={e => setKind(e.target.value)} aria-label="Filter code node type" style={{ width: 150 }}>
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, gap: 5 }}>
            <input type="checkbox" checked={showRelated} onChange={e => setShowRelated(e.target.checked)} />
            Include neighbors
          </label>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
          Showing {rendered.length} of {visible.length} matching nodes.
          {visible.length > MAX_VISIBLE ? ' Refine search to explore the remaining nodes.' : ''}
        </div>
        {error && <div className="tool-card is-error">{error}</div>}
      </div>

      {graph && (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)', alignItems: 'start' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflow: 'auto', maxHeight: 620, width: '100%', background: 'rgba(13,20,27,.65)' }} aria-label="Interactive code knowledge graph">
              <div style={{ position: 'relative', width, height }}>
                <svg aria-hidden="true" width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {drawnEdges.map((edge, i) => {
                    const a = positions.get(edge.from);
                    const b = positions.get(edge.to);
                    if (!a || !b) return null;
                    const linked = edge.from === selectedId || edge.to === selectedId;
                    return <line key={i} x1={a.x + NODE_WIDTH / 2} y1={a.y + NODE_HEIGHT / 2}
                      x2={b.x + NODE_WIDTH / 2} y2={b.y + NODE_HEIGHT / 2}
                      stroke={linked ? '#e4b761' : 'rgba(89,151,167,.16)'} strokeWidth={linked ? 2 : 1} />;
                  })}
                </svg>
                {rendered.map(n => {
                  const p = positions.get(n.id);
                  return (
                    <button key={n.id} type="button" onClick={() => setSelectedId(n.id)}
                      title={[n.path, n.summary].filter(Boolean).join('\n')}
                      aria-pressed={selectedId === n.id}
                      style={{
                        position: 'absolute', left: p.x, top: p.y, width: NODE_WIDTH, height: NODE_HEIGHT,
                        border: '1px solid ' + typeColor(n.type),
                        outline: selectedId === n.id ? '2px solid #e4b761' : 'none',
                        borderRadius: 8, textAlign: 'left', padding: '6px 9px',
                        background: selectedId === n.id ? '#25363c' : '#15232e',
                        color: '#f1f5f4', cursor: 'pointer', overflow: 'hidden'
                      }}>
                      <span style={{ display: 'block', fontSize: 10, color: typeColor(n.type) }}>{n.type} · {n.layer || 'Core'}</span>
                      <span style={{ display: 'block', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <aside className="card" style={{ minWidth: 0, padding: 14, display: 'grid', gap: 10 }}>
            <strong>Node inspector</strong>
            {selected ? (
              <>
                <div style={{ overflowWrap: 'anywhere', color: 'var(--frost)' }}>{selected.label}</div>
                <div style={{ color: 'var(--ink-muted)', fontSize: 11.5 }}>
                  {selected.type} · {selected.layer || 'Unclassified'}
                </div>
                {selected.path && <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11.5 }}>
                  {selected.path}{selected.line ? ':' + selected.line : ''}
                </code>}
                {selected.summary && <p style={{ margin: 0, fontSize: 12.5 }}>{selected.summary}</p>}
                <strong style={{ fontSize: 12 }}>Uses / contains ({outgoing.length})</strong>
                {outgoing.map((edge, i) => (
                  <button key={'out-' + i} className="btn btn-sm" type="button" onClick={() => setSelectedId(edge.to)}
                    style={{ textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {edge.relation}: {byId.get(edge.to)?.label || edge.to}
                  </button>
                ))}
                <strong style={{ fontSize: 12 }}>Used by / belongs to ({incoming.length})</strong>
                {incoming.map((edge, i) => (
                  <button key={'in-' + i} className="btn btn-sm" type="button" onClick={() => setSelectedId(edge.from)}
                    style={{ textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {edge.relation}: {byId.get(edge.from)?.label || edge.from}
                  </button>
                ))}
              </>
            ) : <p style={{ fontSize: 12 }}>Select a node in the graph.</p>}
          </aside>
        </div>
      )}
      {graph?.provenance?.limitations && (
        <p style={{ color: 'var(--ink-muted)', fontSize: 11.5, margin: 0 }}>
          Analysis boundary: {graph.provenance.limitations}
        </p>
      )}
    </section>
  );
}
