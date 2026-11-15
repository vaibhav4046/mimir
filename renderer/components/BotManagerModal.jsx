import React, { useEffect, useState } from 'react';
import { apiFetch, resolveCoordinator } from '../api.js';
import { BotAvatar } from './BotAvatar.jsx';
import { CHARACTER_ARCHETYPES, ACCESSORY_OPTIONS, MimirAsset } from './MimirAsset.jsx';

export function BotManagerModal({ initialBot, mcps, meta, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(initialBot?.id);
  const [templates, setTemplates] = useState([]);
  const [coordUrl, setCoordUrl] = useState('');
  const [form, setForm] = useState({
    name: initialBot?.name || '',
    role: initialBot?.role || 'Desktop Computer Agent',
    shape: initialBot?.shape || 'forge-bot-brok',
    color: initialBot?.color || '#3ac9ff',
    accessories: Array.isArray(initialBot?.accessories) ? initialBot.accessories : [],
    systemPrompt: initialBot?.systemPrompt || 'You are a focused local desktop assistant.',
    modelOverride: initialBot?.modelOverride || '',
    isTeamBot: Boolean(initialBot?.isTeamBot),
    slackChannel: initialBot?.slackChannel || '',
    teamsChannel: initialBot?.teamsChannel || '',
    tools: initialBot?.tools || { shell: true, fs: true, browser: true, memory: true, vault: false },
    allowedMcpIds: initialBot?.allowedMcpIds || [],
  });

  useEffect(() => {
    apiFetch('/v1/team-bots/templates').then(setTemplates).catch(() => {});
    resolveCoordinator().then(c => setCoordUrl(c.url)).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyTemplate = tpl => {
    setForm(prev => ({
      ...prev,
      name: tpl.name,
      role: tpl.role,
      shape: tpl.shape,
      color: tpl.color,
      accessories: Array.isArray(tpl.accessories) ? tpl.accessories : [],
      systemPrompt: tpl.systemPrompt,
      tools: { ...tpl.tools },
      isTeamBot: true,
    }));
  };

  const toggleAccessory = accId => {
    setForm(prev => {
      const list = Array.isArray(prev.accessories) ? prev.accessories : [];
      const exists = list.includes(accId);
      return {
        ...prev,
        accessories: exists ? list.filter(x => x !== accId) : [...list, accId],
      };
    });
  };

  const handleSave = async e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (isEdit) {
      await apiFetch(`/v1/bots/${encodeURIComponent(initialBot.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
    } else {
      await apiFetch('/v1/bots', {
        method: 'POST',
        body: JSON.stringify(form),
      });
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    await apiFetch(`/v1/bots/${encodeURIComponent(initialBot.id)}`, { method: 'DELETE' });
    onDeleted(initialBot.id);
  };

  const shapes = meta?.shapes || ['mimir', 'shield', 'crystal', 'gem', 'star', 'hex', 'cloud', 'squircle'];
  const colors = meta?.colors || ['#1680f3', '#10ab61', '#da830e', '#e72e3b', '#8351e4', '#10a693'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bot-modal-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BotAvatar bot={form} shape={form.shape} color={form.color} size={44} />
            <h3 id="bot-modal-title" style={{ margin: 0 }}>{isEdit ? `Configure ${initialBot.name}` : 'Create Personal or Team Bot'}</h3>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {!isEdit && templates.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--sand-text-muted)', marginBottom: 6 }}>Quick Team Bot Templates:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {templates.map(tpl => (
                <button key={tpl.key} type="button" className="btn btn-sm" onClick={() => applyTemplate(tpl)}>
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid-2">
            <label className="field-label">
              Name
              <input
                className="input"
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="field-label">
              Role
              <input className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
            </label>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
              Norse Pixel Archetype ({CHARACTER_ARCHETYPES.length})
            </div>
            <div className="bot-gallery-grid" role="group" aria-label="Norse Pixel Archetypes">
              {CHARACTER_ARCHETYPES.map(arch => {
                const active = form.shape === arch.id;
                return (
                  <button
                    key={arch.id}
                    type="button"
                    className={`bot-arch-card ${active ? 'active' : ''}`}
                    aria-pressed={active}
                    onClick={() => setForm(f => ({ ...f, shape: arch.id }))}
                  >
                    <MimirAsset
                      category={arch.id === 'mimir-head' ? 'brand' : 'characters'}
                      name={arch.id === 'mimir-head' ? 'mimir-head-32' : arch.id}
                      size={32}
                    />
                    <span style={{ fontWeight: 700, color: active ? 'var(--brass-hi)' : 'var(--ink)' }}>{arch.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
              Modular Gear &amp; Socket Accessories ({(form.accessories || []).length} equipped)
            </div>
            <div className="accessory-grid" role="group" aria-label="Socket Accessories">
              {ACCESSORY_OPTIONS.map(acc => {
                const equipped = (form.accessories || []).includes(acc.id);
                return (
                  <button
                    key={acc.id}
                    type="button"
                    className={`accessory-chip ${equipped ? 'active' : ''}`}
                    aria-pressed={equipped}
                    onClick={() => toggleAccessory(acc.id)}
                  >
                    <MimirAsset category="characters/accessories" name={acc.id} size={18} />
                    <span>{acc.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Avatar Shape
              <select className="select" value={form.shape} onChange={e => setForm(f => ({ ...f, shape: e.target.value }))}>
                {shapes.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Color
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                {colors.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c,
                      border: form.color === c ? '2px solid #fff' : '1px solid transparent',
                    }}
                  />
                ))}
              </div>
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Model Override (optional)
              <input
                className="input"
                placeholder="Default from Settings"
                value={form.modelOverride}
                onChange={e => setForm(f => ({ ...f, modelOverride: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input
                type="checkbox"
                checked={form.isTeamBot}
                onChange={e => setForm(f => ({ ...f, isTeamBot: e.target.checked }))}
              />
              Team Bot (shared routine & webhook channel target)
            </label>
          </div>

          {form.isTeamBot && (
            <div className="grid-2">
              <label className="field-label">
                Slack Channel Tag
                <input
                  className="input"
                  placeholder="#engineering-ops"
                  value={form.slackChannel}
                  onChange={e => setForm(f => ({ ...f, slackChannel: e.target.value }))}
                />
              </label>
              <label className="field-label">
                Teams Channel Tag
                <input
                  className="input"
                  placeholder="General"
                  value={form.teamsChannel}
                  onChange={e => setForm(f => ({ ...f, teamsChannel: e.target.value }))}
                />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--sand-text-muted)', fontWeight: 700 }}>
                Role Charter &amp; System Prompt
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  {
                    label: '+ Chief Coordinator Charter',
                    text: 'You orchestrate specialist allies via subagent_loop and enforce Reversibility gates before external actions.',
                  },
                  {
                    label: '+ Reversibility Boundary',
                    text: 'BOUNDARY RULE: Local drafts and workspace research are REVERSIBLE. NEVER send external emails, spend funds, or mutate production systems without explicit human OK.',
                  },
                  {
                    label: '+ Workspace Persistence',
                    text: 'Store scripts in bin/, configs in config/, reusable skills in skills/, and checkpoints in state/.',
                  },
                ].map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setForm(f => ({
                        ...f,
                        systemPrompt: f.systemPrompt.includes(preset.text)
                          ? f.systemPrompt
                          : `${f.systemPrompt.trim()}\n\n${preset.text}`.trim(),
                      }))
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="textarea"
              aria-label="System Prompt"
              rows={3}
              value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
            />
          </div>

          <div>
            <div style={{ fontSize: 12.5, color: 'var(--sand-text-muted)', marginBottom: 6 }}>Allowed Builtin Capabilities:</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {['shell', 'fs', 'browser', 'memory', 'vault'].map(k => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input
                    type="checkbox"
                    checked={form.tools[k] !== false}
                    onChange={e => setForm(f => ({ ...f, tools: { ...f.tools, [k]: e.target.checked } }))}
                  />
                  {k}
                </label>
              ))}
            </div>
          </div>

          {mcps?.length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--sand-text-muted)', marginBottom: 6 }}>
                Allowed MCP Servers (leave empty = all enabled):
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {mcps.map(srv => {
                  const checked = form.allowedMcpIds.includes(srv.id);
                  return (
                    <label key={srv.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e =>
                          setForm(f => ({
                            ...f,
                            allowedMcpIds: e.target.checked
                              ? [...f.allowedMcpIds, srv.id]
                              : f.allowedMcpIds.filter(x => x !== srv.id),
                          }))
                        }
                      />
                      {srv.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {isEdit && initialBot.webhookToken && coordUrl && (
            <div className="code-block" style={{ fontSize: 11.5 }}>
              Inbound Hook URL: POST {coordUrl}/v1/hooks/{initialBot.webhookToken}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {isEdit ? (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete Bot
              </button>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Bot
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
