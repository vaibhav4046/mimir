import React, { useState } from 'react';

const ALLOWED_TYPES = new Set([
  'rich_text',
  'source_inspector',
  'comparison_table',
  'chart',
  'checklist',
  'interactive_form',
  'activity_timeline',
  'code_editor',
  'browser_preview',
  'artifact_preview',
  'image_canvas',
  'video_timeline',
  'audio_player',
  'approval_dialog',
  'task_receipt',
  'yggdrasil_graph_preview',
]);

export function IntelligentUiRenderer({ spec, onAction, apiBase = '' }) {
  const [formState, setFormState] = useState({});
  const [busyAction, setBusyAction] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  if (!spec || !Array.isArray(spec.blocks)) return null;

  const triggerAction = async (actionId, payload = {}) => {
    if (!onAction) return;
    setBusyAction(actionId);
    setActionNotice('');
    try {
      const out = await onAction({ actionId, payload, surface: spec.surface, roleId: spec.assignedRoleId || 'mimir' });
      if (out?.gate?.decision === 'DENY') {
        setActionNotice(`Blocked by safety check: ${out.gate.reason}`);
      } else if (out?.gate?.decision === 'REQUIRE_APPROVAL') {
        setActionNotice(`Approval required: ${out.gate.reason}`);
      }
    } catch (err) {
      setActionNotice(err?.message || 'Action failed');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="iui-root" data-testid="intelligent-ui-spec" data-surface={spec.surface}>
      <div className="iui-header">
        <div>
          <span className="status-pill" style={{ borderColor: 'var(--frost)', color: 'var(--frost)', marginRight: 8 }}>
            {String(spec.surface || 'chat').toUpperCase()}
          </span>
          <strong style={{ fontSize: 13 }}>{spec.title}</strong>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(spec.actions || []).map(act => (
            <button
              key={act.id}
              type="button"
              className={`btn btn-sm ${act.variant === 'primary' ? 'btn-primary' : ''}`}
              disabled={busyAction === act.actionId}
              onClick={() => triggerAction(act.actionId, act.payload)}
              data-testid={`iui-action-${act.actionId}`}
            >
              {act.label}
            </button>
          ))}
        </div>
      </div>

      {actionNotice && (
        <div className="iui-notice" role="status" data-testid="iui-action-notice">
          {actionNotice}
        </div>
      )}

      <div className="iui-blocks">
        {spec.blocks.map(block => {
          if (!ALLOWED_TYPES.has(block.type)) {
            return (
              <div key={block.id} className="iui-block iui-rejected" data-testid="iui-rejected-block">
                Blocked unapproved UI block type: {String(block.type)}
              </div>
            );
          }

          const d = block.data || {};
          return (
            <section key={block.id} className={`iui-block iui-type-${block.type}`} data-testid={`iui-block-${block.type}`}>
              {block.title && <h4 className="iui-block-title">{block.title}</h4>}

              {block.type === 'rich_text' && (
                <div>
                  <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{String(d.markdown || '')}</p>
                  {Array.isArray(d.citations) && d.citations.length > 0 && (
                    <div className="iui-citation-row">
                      {d.citations.map(c => (
                        <span key={c.index} className="status-pill" title={c.snippet || c.url}>
                          [{c.index}] {c.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {block.type === 'source_inspector' && (
                <div className="iui-list">
                  {(d.sources || []).map((src, i) => (
                    <div key={src.id || i} className="iui-row-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong>[{i + 1}] {src.title}</strong>
                        <span className="status-pill" style={{ color: src.verified ? 'var(--ok)' : 'var(--warn)' }}>
                          {src.verified ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                      {src.url && <div style={{ fontSize: 11, color: 'var(--frost)', wordBreak: 'break-all' }}>{src.url}</div>}
                      {src.excerpt && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{src.excerpt}</div>}
                    </div>
                  ))}
                </div>
              )}

              {block.type === 'comparison_table' && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="iui-table">
                    <thead>
                      <tr>
                        {(d.columns || []).map(col => <th key={col}>{col}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(d.rows || []).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {(d.columns || []).map(col => <td key={col}>{String(row[col] ?? '')}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {block.type === 'chart' && (
                <div className="iui-chart">
                  {(() => {
                    const series = Array.isArray(d.series) ? d.series : [];
                    const maxVal = Math.max(1, ...series.map(s => Number(s.value || 0)));
                    return series.map((item, idx) => {
                      const pct = Math.round((Number(item.value || 0) / maxVal) * 100);
                      return (
                        <div key={idx} className="iui-chart-row">
                          <span className="iui-chart-label">{String(item.label || idx + 1)}</span>
                          <div className="iui-chart-bar-bg">
                            <div className="iui-chart-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="iui-chart-val">{String(item.value ?? 0)}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

              {block.type === 'checklist' && (
                <div className="iui-list">
                  {(d.items || []).map(item => (
                    <label key={item.id} className="iui-check-item">
                      <input
                        type="checkbox"
                        checked={Boolean(item.checked)}
                        onChange={() => triggerAction('toggle_checklist_item', { itemId: item.id, checked: !item.checked })}
                        data-testid={`iui-check-${item.id}`}
                      />
                      <span style={{ textDecoration: item.checked ? 'line-through' : 'none', opacity: item.checked ? 0.7 : 1 }}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {block.type === 'interactive_form' && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    triggerAction('submit_form', { fields: formState, requiresApproval: Boolean(d.requiresApproval) });
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {(d.fields || []).map(f => (
                    <label key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span>{f.label || f.name}</span>
                      <input
                        className="input"
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={formState[f.name] ?? f.defaultValue ?? ''}
                        onChange={e => setFormState(prev => ({ ...prev, [f.name]: e.target.value }))}
                      />
                    </label>
                  ))}
                  <div>
                    <button type="submit" className="btn btn-primary btn-sm">Submit</button>
                  </div>
                </form>
              )}

              {block.type === 'activity_timeline' && (
                <div className="iui-list">
                  {(d.events || []).map(ev => (
                    <div key={ev.id} className="iui-timeline-row">
                      <span className="status-pill">{ev.status}</span>
                      <span>{ev.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {block.type === 'code_editor' && (
                <div className="iui-list">
                  {(d.files || []).map((file, idx) => (
                    <div key={idx} className="iui-code-card">
                      <div className="iui-code-head">
                        <span>{file.path}</span>
                        <span>{file.language}</span>
                      </div>
                      <pre className="iui-code-pre"><code>{file.content}</code></pre>
                    </div>
                  ))}
                </div>
              )}

              {block.type === 'browser_preview' && (
                <div className="iui-row-card">
                  <div><strong>URL:</strong> {d.url}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{d.title} · {d.status}</div>
                </div>
              )}

              {block.type === 'image_canvas' && (
                <div className="iui-row-card">
                  {d.url ? <img src={d.url.startsWith('/') ? `${apiBase}${d.url}` : d.url} alt={block.title || 'Generated visual'} style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6 }} /> : null}
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>{String(d.format || '').toUpperCase()} · {d.sizeBytes || 0} bytes</div>
                </div>
              )}

              {block.type === 'video_timeline' && (
                <div className="iui-row-card">
                  {d.url ? <video controls src={d.url.startsWith('/') ? `${apiBase}${d.url}` : d.url} style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 6 }} /> : null}
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Duration: {d.durationSec || 0}s · {String(d.format || 'MP4').toUpperCase()}</div>
                </div>
              )}

              {block.type === 'audio_player' && (
                <div className="iui-row-card">
                  {d.url ? <audio controls src={d.url.startsWith('/') ? `${apiBase}${d.url}` : d.url} style={{ width: '100%' }} /> : null}
                </div>
              )}

              {block.type === 'artifact_preview' && (
                <div className="iui-row-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <strong>{block.title || d.artifactId}</strong>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{String(d.format || '').toUpperCase()} · {d.bytes || 0} bytes</div>
                  </div>
                  {d.url && (
                    <a className="btn btn-sm" href={d.url.startsWith('/') ? `${apiBase}${d.url}` : d.url} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  )}
                </div>
              )}

              {block.type === 'approval_dialog' && (
                <div className="iui-row-card" style={{ borderColor: 'var(--warn)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--warn)', marginBottom: 4 }}>
                    {d.toolName} · {d.riskTier}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 8 }}>{d.reason}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => triggerAction('approve_request', { approvalId: d.approvalId })}>Approve</button>
                    <button type="button" className="btn btn-sm" onClick={() => triggerAction('deny_request', { approvalId: d.approvalId })}>Deny</button>
                  </div>
                </div>
              )}

              {block.type === 'task_receipt' && (
                <div className="iui-row-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                  <span>Receipt <code>{d.receiptId}</code> · Role: <strong>{d.roleId}</strong></span>
                  <span className="status-pill" style={{ color: d.verified ? 'var(--ok)' : 'var(--warn)' }}>
                    {d.verified ? 'Verified' : 'Pending'} · {String(d.hash || '').slice(0, 14)}
                  </span>
                </div>
              )}

              {block.type === 'yggdrasil_graph_preview' && (
                <div className="iui-row-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{d.totalNodes || 0} nodes · {d.totalEdges || 0} relationships</span>
                  <button type="button" className="btn btn-sm" onClick={() => triggerAction('open_surface', { tab: 'map' })}>
                    View map
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
