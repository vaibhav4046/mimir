import React, { useState } from 'react';
import { BotAvatar } from './BotAvatar.jsx';
import { MimirAsset, MimirSagePortrait } from './MimirAsset.jsx';
import {
  AgentsSvg,
  ChatRuneSvg,
  ChiefCrownPixelSvg,
  CloseCrossSvg,
  CouncilRuneSvg,
  EditQuillSvg,
  ForgeAnvilSvg,
  McpRuneBoxSvg,
  MimirCrestSvg,
  PlusPixelSvg,
  PopoutArrowSvg,
  RoutineHornSvg,
  RsiScaleSvg,
  SettingsRuneSvg,
  SpotlightRuneSvg,
  VaultChestSvg,
} from './Icons.jsx';

function OverviewRuneSvg({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LibraryScrollSvg({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M3 2.5h9a1.5 1.5 0 011.5 1.5v8.5H4.5A1.5 1.5 0 003 14V2.5zM5.5 6h5M5.5 8.5h5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MidgardMapSvg({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MimriStackSvg({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M8 1.5L14 4.5L8 7.5L2 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8l6 3 6-3M2 11.5l6 3 6-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const CORE_TABS = [
  { id: 'chat', label: 'Home', Icon: ChatRuneSvg },
  { id: 'map', label: 'Projects', Icon: MidgardMapSvg },
  { id: 'library', label: 'Library', Icon: LibraryScrollSvg },
  { id: 'routines', label: 'Automations', Icon: RoutineHornSvg },
  { id: 'mcp', label: 'Connections', Icon: McpRuneBoxSvg },
  { id: 'settings', label: 'Settings', Icon: SettingsRuneSvg },
];

const OS_TABS = [
  { id: 'overview', label: 'Overview', Icon: OverviewRuneSvg },
  { id: 'agents', label: 'Agents', Icon: AgentsSvg },
  { id: 'forge', label: 'Studio', Icon: ForgeAnvilSvg },
  { id: 'council', label: 'Boardroom', Icon: CouncilRuneSvg },
  { id: 'rsi', label: 'Eval & RSI', Icon: RsiScaleSvg },
  { id: 'mimri', label: 'Architecture', Icon: MimriStackSvg },
  { id: 'vault', label: 'Vault', Icon: VaultChestSvg },
];

const PRIMARY_TABS = [...CORE_TABS, ...OS_TABS];

export function Sidebar({
  bots,
  activeBotId,
  agentStatuses,
  onSelectBotFresh,
  onNewBot,
  onEditBot,
  onDeployChiefTeam,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  activeTab,
  onSelectTab,
  modelStatus,
  onOpenSpotlight,
  onOpenPopout,
  isMobileOpen,
  onCloseMobile,
  mimirAvatarState = 'IDLE',
  staticAvatar = false,
  spaces = [],
  activeSpaceId = '',
  onSelectSpace,
  onCreateSpace,
  onDeleteSpace,
}) {
  const [search, setSearch] = useState('');
  const [deployingTeam, setDeployingTeam] = useState(false);
  const [showAdvancedNav, setShowAdvancedNav] = useState(() => OS_TABS.some(t => t.id === activeTab));
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceTitle, setNewSpaceTitle] = useState('');
  const [newSpaceSurface, setNewSpaceSurface] = useState('research');
  const q = search.trim().toLowerCase();
  const filteredThreads = threads.filter(t =>
    !q ? true : String(t.title || '').toLowerCase().includes(q)
  );
  const filteredBots = bots.filter(b =>
    !q ? true : `${b.name} ${b.role} ${b.specialistTag || ''}`.toLowerCase().includes(q)
  );
  const chiefBot = filteredBots.find(b => b.id === 'bot-chief-klaus' || b.specialistTag === 'chief-of-staff') || null;
  const specialistBots = chiefBot ? filteredBots.filter(b => b.id !== chiefBot.id) : filteredBots;
  const hasFullChiefTeam = bots.some(b => b.id === 'bot-chief-klaus');

  const handleDeployClick = async () => {
    if (!onDeployChiefTeam || deployingTeam) return;
    setDeployingTeam(true);
    try {
      await onDeployChiefTeam();
      onCloseMobile?.();
    } finally {
      setDeployingTeam(false);
    }
  };

  const statusTone = modelStatus?.ollama?.ok ? 'ok' : modelStatus?.openai?.ok ? 'warn' : 'err';
  const statusLabel = modelStatus?.ollama?.ok
    ? 'Ollama Live'
    : modelStatus?.openai?.ok
      ? 'Fallback API'
      : 'Offline';

  const statusMap = new Map((agentStatuses || []).map(s => [s.botId, s.state]));

  const handleNavKeyDown = (e, idx) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % PRIMARY_TABS.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + PRIMARY_TABS.length) % PRIMARY_TABS.length;
    if (next >= 0) {
      e.preventDefault();
      onSelectTab(PRIMARY_TABS[next].id);
      const nextEl = document.querySelector(`[data-testid="nav-${PRIMARY_TABS[next].id}"]`);
      nextEl?.focus();
    }
  };

  return (
    <aside
      id="mimir-sidebar"
      className={`sidebar ${isMobileOpen ? 'mobile-open' : ''}`}
      data-testid="sidebar"
      aria-label="Primary Workspace Sidebar"
    >
      <div className="sidebar-top">
        <div className="brand-row">
          <div className="brand-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirSagePortrait size={30} state={mimirAvatarState} staticAvatar={staticAvatar} />
            <div>
              <span style={{ display: 'block', lineHeight: 1.1 }}>Mimir</span>
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-subtle)', letterSpacing: '0.04em' }} data-testid="sidebar-mimir-state">
                {mimirAvatarState}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="status-pill" title="LLM Backend Health">
              <MimirAsset
                category="ui"
                name={statusTone === 'ok' ? 'online' : statusTone === 'warn' ? 'loading' : 'offline'}
                size={13}
              />
              {statusLabel}
            </span>
            {isMobileOpen && (
              <button
                type="button"
                className="btn btn-icon btn-sm"
                aria-label="Close navigation menu"
                onClick={onCloseMobile}
              >
                <CloseCrossSvg size={13} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              onNewThread();
              onCloseMobile?.();
            }}
            data-testid="new-chat-btn"
          >
            <PlusPixelSvg size={14} />
            <span>New Chat</span>
          </button>
          {window.desktop && (
            <>
              <button type="button" className="btn btn-icon" aria-label="Spotlight Launcher" title="Spotlight Launcher" onClick={onOpenSpotlight}>
                <SpotlightRuneSvg size={15} />
              </button>
              <button type="button" className="btn btn-icon" aria-label="Popout Bot Window" title="Popout Bot" onClick={() => onOpenPopout(activeBotId)}>
                <PopoutArrowSvg size={15} />
              </button>
            </>
          )}
        </div>

        <input
          type="search"
          className="input"
          aria-label="Filter chats"
          placeholder="Filter chats & specialists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="sidebar-section-label">
        <button
          type="button"
          style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          onClick={() => {
            onSelectTab('agents');
            onCloseMobile?.();
          }}
        >
          {chiefBot ? 'Chief & Specialists' : `Bots (${bots.length})`}
        </button>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {!hasFullChiefTeam && onDeployChiefTeam && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ minHeight: 24, padding: '2px 7px', fontSize: 10 }}
              data-testid="deploy-chief-team-btn"
              title="Deploy 6-bot Chief of Staff topology (Klaus + 5 specialists)"
              disabled={deployingTeam}
              onClick={handleDeployClick}
            >
              {deployingTeam ? '...' : '+ Chief Team'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon btn-sm"
            style={{ width: 24, height: 24, minHeight: 24 }}
            data-testid="new-bot-btn"
            aria-label="Create new bot"
            title="New Bot"
            onClick={() => {
              onNewBot();
              onCloseMobile?.();
            }}
          >
            <PlusPixelSvg size={12} />
          </button>
        </div>
      </div>

      <div className="bot-strip" data-testid="bot-list">
        {chiefBot && (
          <div className="sidebar-sublabel">
            <ChiefCrownPixelSvg size={12} />
            <span>Chief of Staff</span>
          </div>
        )}
        {(chiefBot ? [chiefBot] : []).map(bot => {
          const isWorking = statusMap.get(bot.id) === 'working';
          return (
            <div key={bot.id} className="bot-row bot-row-chief">
              <button
                type="button"
                className={`bot-pill is-chief ${bot.id === activeBotId ? 'active' : ''}`}
                data-testid={`bot-pill-${bot.id}`}
                title={`Start fresh session with ${bot.name}`}
                onClick={() => {
                  onSelectBotFresh(bot.id);
                  onCloseMobile?.();
                }}
              >
                <BotAvatar
                  bot={bot}
                  shape={bot.shape}
                  color={bot.color}
                  size={24}
                  state={isWorking ? 'running' : bot.id === activeBotId ? 'active' : 'idle'}
                />
                <div className="bot-pill-meta">
                  <div className="bot-pill-name">{bot.name}</div>
                  <div className="bot-pill-role">{isWorking ? 'Delegating...' : 'Chief of Staff'}</div>
                </div>
                <span className={`presence-dot ${isWorking ? 'is-working' : 'is-online'}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-icon btn-sm"
                style={{ width: 26, height: 26, minHeight: 26, flexShrink: 0 }}
                aria-label={`Configure ${bot.name}`}
                title={`Configure ${bot.name}`}
                onClick={e => {
                  e.stopPropagation();
                  onEditBot(bot);
                  onCloseMobile?.();
                }}
              >
                <EditQuillSvg size={12} />
              </button>
            </div>
          );
        })}

        {chiefBot && specialistBots.length > 0 && (
          <div className="sidebar-sublabel" style={{ marginTop: 4 }}>
            <span>Specialists ({specialistBots.length})</span>
          </div>
        )}

        {specialistBots.map(bot => {
          const isWorking = statusMap.get(bot.id) === 'working';
          return (
            <div key={bot.id} className="bot-row">
              <button
                type="button"
                className={`bot-pill ${bot.id === activeBotId ? 'active' : ''}`}
                data-testid={`bot-pill-${bot.id}`}
                title={`Start fresh session with ${bot.name}`}
                onClick={() => {
                  onSelectBotFresh(bot.id);
                  onCloseMobile?.();
                }}
              >
                <BotAvatar
                  bot={bot}
                  shape={bot.shape}
                  color={bot.color}
                  size={24}
                  state={isWorking ? 'running' : bot.id === activeBotId ? 'active' : 'idle'}
                />
                <div className="bot-pill-meta">
                  <div className="bot-pill-name">{bot.name}</div>
                  <div className="bot-pill-role">{isWorking ? 'Working...' : bot.role}</div>
                </div>
                <span className={`presence-dot ${isWorking ? 'is-working' : 'is-online'}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-icon btn-sm"
                style={{ width: 26, height: 26, minHeight: 26, flexShrink: 0 }}
                aria-label={`Configure ${bot.name}`}
                title={`Configure ${bot.name}`}
                onClick={e => {
                  e.stopPropagation();
                  onEditBot(bot);
                  onCloseMobile?.();
                }}
              >
                <EditQuillSvg size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {onSelectSpace && (
        <div className="spaces-strip" data-testid="spaces-list" style={{ padding: '4px 10px 6px' }}>
          <div className="sidebar-section-label" style={{ padding: '4px 0' }}>
            <span>Spaces ({(spaces || []).length})</span>
            {onCreateSpace && (
              <button
                type="button"
                className="btn btn-icon btn-sm"
                style={{ width: 22, height: 22, minHeight: 22 }}
                aria-label="Create Workspace Space"
                title="Pin Custom Workspace Space"
                data-testid="new-space-btn"
                onClick={() => setNewSpaceOpen(v => !v)}
              >
                <PlusPixelSvg size={11} />
              </button>
            )}
          </div>
          {newSpaceOpen && (
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6, padding: 6, background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 6 }}
              onSubmit={e => {
                e.preventDefault();
                if (!newSpaceTitle.trim()) return;
                onCreateSpace?.({ title: newSpaceTitle.trim(), surface: newSpaceSurface });
                setNewSpaceTitle('');
                setNewSpaceOpen(false);
              }}
            >
              <input
                className="input"
                placeholder="Space name..."
                value={newSpaceTitle}
                onChange={e => setNewSpaceTitle(e.target.value)}
                data-testid="new-space-title"
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <select className="select" value={newSpaceSurface} onChange={e => setNewSpaceSurface(e.target.value)} data-testid="new-space-surface">
                  <option value="research">Research</option>
                  <option value="code">Code</option>
                  <option value="media">Media</option>
                  <option value="automation">Automation</option>
                  <option value="memory">Memory</option>
                  <option value="chat">Chat</option>
                </select>
                <button type="submit" className="btn btn-primary btn-sm" data-testid="save-space-btn">Pin</button>
              </div>
            </form>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(spaces || []).map(sp => (
              <div key={sp.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <button
                  type="button"
                  className={`chip ${activeSpaceId === sp.id ? 'is-active' : ''}`}
                  data-testid={`space-pill-${sp.id}`}
                  style={{
                    cursor: 'pointer',
                    borderColor: activeSpaceId === sp.id ? 'var(--frost)' : undefined,
                    color: activeSpaceId === sp.id ? 'var(--frost)' : undefined,
                  }}
                  onClick={() => {
                    onSelectSpace(sp);
                    onCloseMobile?.();
                  }}
                >
                  {sp.title} ({sp.surface})
                </button>
                {onDeleteSpace && (
                  <button
                    type="button"
                    aria-label={`Remove space ${sp.title}`}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-subtle)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
                    onClick={() => onDeleteSpace(sp.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-section-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <MimirAsset category="ui" name="chronicles" size={13} />
          Chats ({filteredThreads.length})
        </span>
      </div>

      <div className="thread-list">
        {filteredThreads.length === 0 ? (
          <div style={{ padding: '10px 8px', color: 'var(--ink-subtle)', fontSize: 12 }}>
            No chats yet.
          </div>
        ) : (
          filteredThreads.map(t => (
            <div key={t.id} className={`thread-item ${t.id === activeThreadId ? 'active' : ''}`}>
              <button
                type="button"
                className="thread-item-title"
                style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                onClick={() => {
                  onSelectTab('chat');
                  onSelectThread(t.id);
                  onCloseMobile?.();
                }}
              >
                {t.title || 'New Chat'}
              </button>
              <button
                type="button"
                className="thread-del"
                aria-label={`Delete thread ${t.title || 'New Chat'}`}
                title="Delete thread"
                onClick={e => {
                  e.stopPropagation();
                  onDeleteThread(t.id);
                }}
              >
                <CloseCrossSvg size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <nav className="sidebar-nav" role="tablist" aria-label="Primary Views">
        <div className="sidebar-nav-core">
          {CORE_TABS.map(tab => {
            const idx = PRIMARY_TABS.findIndex(t => t.id === tab.id);
            const IconComp = tab.Icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                className={`nav-tab nav-tab-core ${isSelected ? 'active' : ''}`}
                data-testid={`nav-${tab.id}`}
                onKeyDown={e => handleNavKeyDown(e, idx)}
                onClick={e => {
                  e.currentTarget.blur();
                  onSelectTab(tab.id);
                  onCloseMobile?.();
                }}
              >
                <IconComp size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="sidebar-nav-label sidebar-advanced-toggle"
          data-testid="toggle-advanced-tools"
          aria-expanded={showAdvancedNav || OS_TABS.some(t => t.id === activeTab)}
          onClick={() => setShowAdvancedNav(v => !v)}
        >
          <span>Advanced Tools</span>
          <span>{showAdvancedNav || OS_TABS.some(t => t.id === activeTab) ? '▾' : '▸'}</span>
        </button>
        <div
          className={`sidebar-nav-secondary ${showAdvancedNav || OS_TABS.some(t => t.id === activeTab) ? 'is-expanded' : 'is-collapsed'}`}
          data-testid="sidebar-advanced-group"
        >
          {OS_TABS.map(tab => {
            const idx = PRIMARY_TABS.findIndex(t => t.id === tab.id);
            const IconComp = tab.Icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                className={`nav-tab nav-tab-sub ${isSelected ? 'active' : ''}`}
                data-testid={`nav-${tab.id}`}
                onKeyDown={e => handleNavKeyDown(e, idx)}
                onClick={e => {
                  e.currentTarget.blur();
                  onSelectTab(tab.id);
                  onCloseMobile?.();
                }}
              >
                <IconComp size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
