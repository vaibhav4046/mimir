import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';

const ATLAS_TYPES = [
  'all',
  'Project',
  'File',
  'Task',
  'Conversation',
  'Bot',
  'Memory',
  'Source',
  'Decision',
  'Skill',
  'Artifact',
  'Timeline event',
  'Evidence',
];

export function RealmProjectMapView({ onNavigate, onSelectBot }) {
  const [mapData, setMapData] = useState(null);
  const [atlasData, setAtlasData] = useState(null);
  const [viewMode, setViewMode] = useState('graph'); // graph | list | timeline
  const [atlasQuery, setAtlasQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef(null);

  const loadAtlas = async (q = atlasQuery, t = typeFilter) => {
    try {
      const qs = new URLSearchParams({ q: q || '', type: t || 'all' });
      const data = await apiFetch(`/v1/memory/atlas?${qs.toString()}`);
      setAtlasData(data);
    } catch {
      // Optional atlas endpoint
    }
  };

  const loadMap = async () => {
    setErr('');
    try {
      const [data] = await Promise.all([apiFetch('/v1/projects/map'), loadAtlas()]);
      setMapData(data);
      if (!selected && data?.nodes?.length) {
        setSelected({ kind: 'node', item: data.nodes[0] });
      }
    } catch (e) {
      setErr(e.message || 'Failed to load Midgard Project Map');
    }
  };

  useEffect(() => {
    loadMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount fetch
  }, []);

  useEffect(() => {
    loadAtlas(atlasQuery, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter change
  }, [atlasQuery, typeFilter]);

  const handleTombstoneDelete = async item => {
    const target = encodeURIComponent(item.memoryKey || item.rawId || item.id);
    await apiFetch(`/v1/memory/${target}`, { method: 'DELETE' });
    if (selected?.item?.id === item.id) setSelected(null);
    await loadAtlas(atlasQuery, typeFilter);
  };

  const handlePointerDown = e => {
    if (e.target.closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  };

  const handlePointerMove = e => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleKeyDown = e => {
    const step = 32;
    if (e.key === 'ArrowLeft') setPan(p => ({ ...p, x: p.x + step }));
    else if (e.key === 'ArrowRight') setPan(p => ({ ...p, x: p.x - step }));
    else if (e.key === 'ArrowUp') setPan(p => ({ ...p, y: p.y + step }));
    else if (e.key === 'ArrowDown') setPan(p => ({ ...p, y: p.y - step }));
    else if (e.key === '+' || e.key === '=') setZoom(z => Math.min(2.2, Number((z + 0.15).toFixed(2))));
    else if (e.key === '-') setZoom(z => Math.max(0.55, Number((z - 0.15).toFixed(2))));
    else if (e.key === '0') {
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  };

  const realms = mapData?.realms || [];
  const nodes = mapData?.nodes || [];
  const edges = mapData?.edges || [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  return (
    <div className="view-scroll" data-testid="map-view">
      <div className="view-container">
        <div className="library-toolbar">
          <div>
            <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="bifrost-portal" size={22} />
              <span>Midgard Nine-Realms Project Map</span>
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 12.5 }}>
              {mapData?.attribution || 'Original Lake-of-Nine Mimir project topology inspired by Norse realms (non-franchise schematic coordinates).'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <div role="group" aria-label="Atlas View Mode" style={{ display: 'inline-flex', gap: 4 }}>
              {[
                { id: 'graph', label: 'Graph View' },
                { id: 'list', label: 'Atlas List' },
                { id: 'timeline', label: 'Timeline' },
              ].map(vm => (
                <button
                  key={vm.id}
                  type="button"
                  className={`btn btn-sm ${viewMode === vm.id ? 'btn-primary' : ''}`}
                  data-testid={`atlas-mode-${vm.id}`}
                  aria-pressed={viewMode === vm.id}
                  onClick={() => setViewMode(vm.id)}
                >
                  {vm.label}
                </button>
              ))}
            </div>
            {viewMode === 'graph' && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => setZoom(z => Math.max(0.55, Number((z - 0.15).toFixed(2))))}>
                  Zoom -
                </button>
                <button type="button" className="btn btn-sm" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>
                  Reset ({Math.round(zoom * 100)}%)
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setZoom(z => Math.min(2.2, Number((z + 0.15).toFixed(2))))}>
                  Zoom +
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={loadMap}>
              Refresh
            </button>
          </div>
        </div>

        <div
          className="card"
          data-testid="yggdrasil-atlas-controls"
          style={{ padding: '8px 12px', marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 280px' }}>
            <input
              type="search"
              className="input"
              data-testid="atlas-search-input"
              aria-label="Search Yggdrasil Memory Atlas"
              placeholder="Search memories, decisions, sources, files..."
              value={atlasQuery}
              onChange={e => setAtlasQuery(e.target.value)}
              style={{ maxWidth: 280, minHeight: 30, padding: '4px 10px', fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {ATLAS_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : ''}`}
                  style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setTypeFilter(t)}
                >
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
          </div>
          {atlasData && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 11.5, color: 'var(--ink-muted)', fontFamily: 'var(--sand-mono)' }}>
              <span>{atlasData.totalNodes} nodes · {atlasData.totalEdges} edges · {atlasData.tombstones?.length || 0} tombstones</span>
              <span className="pill" data-testid="atlas-diagnostics-badge" style={{ fontSize: 10.5 }}>
                {atlasData.diagnostics?.duplicateNodes?.length || 0} duplicates · {atlasData.diagnostics?.staleMemories?.length || 0} stale · {atlasData.diagnostics?.contradictions?.length || 0} conflicts
              </span>
            </div>
          )}
        </div>

        <div className="adaptive-workspace-bar" data-testid="atlas-breadcrumbs" style={{ fontSize: 12 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setTypeFilter('all');
              setAtlasQuery('');
            }}
          >
            Yggdrasil Atlas
          </button>
          <span className="muted">/</span>
          <span className="pill is-cyan">{typeFilter === 'all' ? 'All 11 Entity Types' : typeFilter}</span>
          {selected?.item?.label && (
            <>
              <span className="muted">/</span>
              <span className="pill">{selected.item.label}</span>
            </>
          )}
        </div>

        {err && <div className="tool-card is-error">{err}</div>}

        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', alignItems: 'start' }}>
          {viewMode === 'graph' && (
          <div className="map-stage">
            <div
              className="map-viewport"
              tabIndex={0}
              aria-label="Interactive Nine Realms project canvas. Use mouse drag or arrow keys to pan, +/- to zoom."
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={e => {
                e.preventDefault();
                setZoom(z => {
                  const delta = e.deltaY > 0 ? -0.1 : 0.1;
                  return Math.min(2.2, Math.max(0.55, Number((z + delta).toFixed(2))));
                });
              }}
              onKeyDown={handleKeyDown}
            >
              <div
                className="map-world"
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                }}
              >
                <svg viewBox="0 0 1000 760" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
                  {/* Concentric Yggdrasil lake rings */}
                  <circle cx="500" cy="380" r="145" fill="none" stroke="rgba(58,201,255,0.22)" strokeDasharray="6 6" />
                  <circle cx="500" cy="380" r="295" fill="none" stroke="rgba(230,171,66,0.2)" strokeDasharray="4 8" />
                  {edges.map((ed, i) => {
                    const a = nodeMap.get(ed.from);
                    const b = nodeMap.get(ed.to);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={i}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="rgba(58,201,255,0.38)"
                        strokeWidth="1.5"
                      />
                    );
                  })}
                  {realms.map(r => (
                    <g key={r.id}>
                      <circle cx={r.x} cy={r.y} r={r.radius || 52} fill="rgba(16,23,34,0.6)" stroke={r.tone || '#e6ab42'} strokeWidth="2" />
                      <text x={r.x} y={r.y + (r.radius || 52) + 14} textAnchor="middle" fill={r.tone || '#e6ab42'} fontSize="12" fontFamily="monospace">
                        {r.name}
                      </text>
                    </g>
                  ))}
                </svg>

                {nodes.map(n => {
                  const isSel = selected?.item?.id === n.id;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`map-node ${isSel ? 'is-selected' : ''}`}
                      data-testid={`map-node-${n.id}`}
                      style={{
                        left: `${(n.x / 1000) * 100}%`,
                        top: `${(n.y / 760) * 100}%`,
                        borderColor: isSel ? 'var(--brass)' : n.pinTone || 'var(--rule-strong)',
                      }}
                      onClick={() => setSelected({ kind: 'node', item: n })}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          background: n.pinTone || '#3ac9ff',
                          display: 'inline-block',
                          flex: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                        {n.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '6px 10px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-muted)' }}>
              <span>{realms.length} realms · {nodes.length} mapped workspace/bot/chronicle nodes</span>
              <span>Drag or arrow keys to pan · +/- to zoom</span>
            </div>
          </div>
          )}

          {viewMode === 'list' && (
            <div className="card" data-testid="atlas-list-view" style={{ gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brass)' }}>
                Yggdrasil Memory Atlas — Entities ({atlasData?.nodes?.length || 0})
              </div>
              {!(atlasData?.nodes?.length) ? (
                <div style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>No matching memory or artifact nodes.</div>
              ) : (
                atlasData.nodes.map(item => (
                  <div
                    key={item.id}
                    className="tool-card"
                    style={{ cursor: 'pointer', borderColor: selected?.item?.id === item.id ? 'var(--brass)' : undefined }}
                    onClick={() => setSelected({ kind: 'atlas', item })}
                  >
                    <div className="tool-card-head">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="pill" style={{ fontSize: 10 }}>{item.type}</span>
                        <strong>{item.label}</strong>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`pill ${item.stale ? 'is-crimson' : 'is-emerald'}`} style={{ fontSize: 10 }}>
                          {item.stale ? 'stale' : item.verified ? 'verified' : 'unverified'}
                        </span>
                        {item.deletable && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ minHeight: 22, padding: '1px 7px', fontSize: 10.5 }}
                            onClick={e => {
                              e.stopPropagation();
                              handleTombstoneDelete(item);
                            }}
                          >
                            Tombstone Delete
                          </button>
                        )}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{item.subtitle}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--sand-mono)', color: 'var(--ink-subtle)' }}>
                      source: {item.provenance} · conf: {Math.round((item.confidence ?? 1) * 100)}%
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {viewMode === 'timeline' && (
            <div className="card" data-testid="atlas-timeline-view" style={{ gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--frost)' }}>
                Yggdrasil Chronological Timeline
              </div>
              {[...(atlasData?.nodes || [])]
                .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
                .slice(0, 30)
                .map(item => (
                  <div
                    key={`tl-${item.id}`}
                    className="tool-card"
                    style={{ cursor: 'pointer', borderLeft: '3px solid var(--frost)' }}
                    onClick={() => setSelected({ kind: 'atlas', item })}
                  >
                    <div className="tool-card-head">
                      <span>
                        <span className="pill" style={{ fontSize: 10, marginRight: 6 }}>{item.type}</span>
                        <strong>{item.label}</strong>
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--sand-mono)', color: 'var(--ink-muted)' }}>
                        {item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : 'now'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{item.subtitle}</div>
                  </div>
                ))}
            </div>
          )}

          <aside className="card" style={{ gap: 10 }} data-testid="map-inspector">
            <h3 className="card-title" style={{ margin: 0 }}>
              {selected?.item?.label || 'Inspector'}
            </h3>
            {selected?.item ? (
              <>
                <div className="pill" style={{ alignSelf: 'flex-start' }}>
                  {selected.item.type} · realm: {selected.item.realmId}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                  {selected.item.subtitle}
                </div>
                {selected.item.provenance && (
                  <div style={{ fontSize: 11.5, fontFamily: 'var(--sand-mono)', color: 'var(--ink-subtle)' }}>
                    Provenance: {selected.item.provenance}
                    {typeof selected.item.confidence === 'number' ? ` · Confidence: ${Math.round(selected.item.confidence * 100)}%` : ''}
                  </div>
                )}
                {selected.item.deletable && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-testid="atlas-edit-memory-btn"
                      onClick={async () => {
                        const nextVal = window.prompt(`Update memory "${selected.item.memoryKey || selected.item.label}":`, selected.item.value || selected.item.subtitle || '');
                        if (nextVal === null) return;
                        await apiFetch('/v1/memory', {
                          method: 'POST',
                          body: JSON.stringify({
                            botId: selected.item.botId || 'bot-grok-default',
                            key: selected.item.memoryKey || selected.item.label,
                            value: nextVal,
                          }),
                        });
                        await loadMap();
                      }}
                    >
                      Edit Memory
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleTombstoneDelete(selected.item)}
                    >
                      Tombstone Delete Memory
                    </button>
                  </div>
                )}
                {(selected.item.navTab || selected.item.openTarget?.tab) && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    data-testid="atlas-open-record-btn"
                    onClick={() => {
                      const targetTab = selected.item.navTab || selected.item.openTarget?.tab;
                      if (selected.item.botId || selected.item.openTarget?.botId) {
                        onSelectBot?.(selected.item.botId || selected.item.openTarget?.botId);
                      }
                      onNavigate?.(targetTab);
                    }}
                  >
                    Open in {selected.item.navTab || selected.item.openTarget?.tab}
                  </button>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>
                Select a pin on the map to inspect its branch, bot, or chronicle details.
              </div>
            )}

            <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', width: '100%' }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brass)' }}>
              Repository &amp; Recent Commits
            </div>
            <div style={{ fontSize: 11.5, fontFamily: 'var(--sand-mono)', color: 'var(--ink-muted)' }}>
              Branch: {mapData?.repo?.branch || 'local workspace'} · Worktrees: {mapData?.repo?.worktrees?.length || 1}
            </div>
            {(mapData?.repo?.recentCommits || []).map((c, idx) => (
              <div key={idx} style={{ fontSize: 11.5, fontFamily: 'var(--sand-mono)', color: 'var(--ink)' }}>
                {c}
              </div>
            ))}

            <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', width: '100%' }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--frost)' }}>Realms Directory</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {realms.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="btn btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => setSelected({ kind: 'realm', item: { ...r, label: r.name, type: 'realm', realmId: r.id, subtitle: r.role } })}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
