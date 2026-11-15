import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { BotAvatar } from './BotAvatar.jsx';
import { MimirAsset } from './MimirAsset.jsx';
import { AgentsSvg, ForgeAnvilSvg, PlusPixelSvg } from './Icons.jsx';

export function AgentsView({
  bots,
  activeBotId,
  agentStatuses,
  onStartNewSession,
  onResumeBot,
  onEditBot,
  onNewBot,
  onOpenForge,
}) {
  const statusById = new Map((agentStatuses || []).map(s => [s.botId, s]));
  const botById = new Map((bots || []).map(b => [b.id, b]));
  const [norseRoles, setNorseRoles] = useState([]);
  const [sentinelStats, setSentinelStats] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const loadRegistry = async () => {
    try {
      const data = await apiFetch('/v1/agents/registry');
      setNorseRoles(data?.roles || []);
      setSentinelStats(data?.sentinelStats || null);
    } catch {
      setNorseRoles([]);
    }
  };

  useEffect(() => {
    loadRegistry();
  }, [bots.length]);

  const handleSeedNorse = async () => {
    setSeeding(true);
    try {
      await apiFetch('/v1/agents/norse/seed', { method: 'POST', body: '{}' });
      await loadRegistry();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="view-scroll" data-testid="agents-view">
      <div className="view-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AgentsSvg size={18} />
              <span>Your team ({bots.length})</span>
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              Your AI teammates. Start a new chat with one, pick up where you left off, or change how they work.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={onOpenForge} data-testid="agents-forge-btn">
              <ForgeAnvilSvg size={14} />
              <span>Add teammate</span>
            </button>
            <button type="button" className="btn" onClick={onNewBot} data-testid="agents-new-btn">
              <PlusPixelSvg size={14} />
              <span>Add blank teammate</span>
            </button>
          </div>
        </div>

        <div className="card" data-testid="norse-registry-panel" style={{ marginTop: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 className="card-title" style={{ margin: '0 0 2px' }}>
                Built-in specialists ({norseRoles.length || 11})
              </h3>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Ready-made teammates, each good at one job · Safety checks so far: {sentinelStats?.total || 0} ({sentinelStats?.denied || 0} blocked)
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={seeding}
              onClick={handleSeedNorse}
              data-testid="seed-norse-roster-btn"
            >
              {seeding ? 'Adding...' : 'Add built-in specialists'}
            </button>
          </div>
          <div className="agents-grid" style={{ marginTop: 8 }}>
            {norseRoles.map(role => (
              <div key={role.id} className="card" data-testid={`norse-role-${role.id}`} style={{ padding: 10, borderColor: role.priorityE2E ? 'var(--brass)' : 'var(--rule)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontSize: 13 }}>{role.name}</strong>
                  <span className="status-pill" style={{ fontSize: 10, color: role.priorityE2E ? 'var(--brass)' : 'var(--frost)' }}>
                    {role.priorityE2E ? 'Priority' : role.liveState}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{role.roleTitle}</div>
                <div className="chip-list" style={{ marginTop: 4 }}>
                  <span className="chip">{role.modelAssignment}</span>
                  <span className="chip">Max steps: {role.budgets?.maxSteps}</span>
                  <span className="chip">Risk limit: {role.permissionBoundaries?.maxRiskTier}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="agents-grid" data-testid="agents-list">
          {bots.map(bot => {
            const st = statusById.get(bot.id);
            const isWorking = st?.state === 'working';
            const isCurrent = bot.id === activeBotId;
            const parentBot = bot.parentBotId ? botById.get(bot.parentBotId) : null;
            const enabledTools = Object.entries(bot.tools || {})
              .filter(([, v]) => v !== false)
              .map(([k]) => k);

            return (
              <div
                key={bot.id}
                className="card"
                data-testid={`agent-card-${bot.id}`}
                style={{
                  borderColor: isCurrent ? 'var(--brass)' : 'var(--rule)',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <BotAvatar
                        bot={bot}
                        shape={bot.shape}
                        color={bot.color}
                        size={40}
                        state={isWorking ? 'running' : isCurrent ? 'active' : 'idle'}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{bot.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>{bot.role}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {bot.isTeamBot && (
                        <span className="status-pill" style={{ borderColor: 'var(--brass)', color: 'var(--brass)' }}>
                          Team
                        </span>
                      )}
                      {bot.specialistTag && (
                        <span className="status-pill badge-specialist" data-testid={`agent-specialist-${bot.id}`}>
                          {bot.specialistTag}
                        </span>
                      )}
                      {bot.parentBotId && (
                        <span className="status-pill badge-lineage" data-testid={`agent-lineage-${bot.id}`}>
                          Created by {parentBot?.name || bot.parentBotId}
                        </span>
                      )}
                      <span
                        className="status-pill"
                        style={{
                          color: isWorking ? 'var(--frost)' : 'var(--ok)',
                          borderColor: isWorking ? 'var(--frost)' : 'var(--rule)',
                        }}
                      >
                        <MimirAsset
                          category="ui"
                          name={isWorking ? 'loading' : 'online'}
                          size={12}
                        />
                        {isWorking ? 'Working' : 'Ready'}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-muted)',
                      lineHeight: 1.45,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {String(bot.systemPrompt || 'Ready to help on this computer and the web.').replace(/^You are (a |an |the )?/i, '')}
                  </div>

                  <div className="chip-list">
                    <span className="chip">AI model: {bot.modelOverride || 'default'}</span>
                    <span className="chip">Mode: {bot.executionMode || 'agent'}</span>
                    {enabledTools.map(t => (
                      <span key={t} className="chip">{t}</span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--rule)' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ borderColor: 'var(--brass)', color: 'var(--brass)' }}
                    data-testid={`agent-new-session-${bot.id}`}
                    onClick={() => onStartNewSession(bot.id)}
                  >
                    New chat
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid={`agent-resume-${bot.id}`}
                    onClick={() => onResumeBot(bot.id)}
                  >
                    Continue last chat
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid={`agent-configure-${bot.id}`}
                    onClick={() => onEditBot(bot)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
