import React, { useEffect, useMemo, useRef, useState } from 'react';

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', category: 'View', keywords: 'messages conversation' },
  { id: 'map', label: 'Projects', category: 'View', keywords: 'spaces map realms' },
  { id: 'library', label: 'Files', category: 'View', keywords: 'artifacts library documents' },
  { id: 'routines', label: 'Automations', category: 'View', keywords: 'schedules workflows routines' },
  { id: 'mcp', label: 'Connected apps', category: 'View', keywords: 'mcp plugins integrations' },
  { id: 'settings', label: 'Settings', category: 'View', keywords: 'preferences theme model' },
  { id: 'agents', label: 'Your team', category: 'View', keywords: 'bots agents teammates' },
  { id: 'council', label: 'Team meeting', category: 'View', keywords: 'board council debate' },
  { id: 'forge', label: 'Import memory', category: 'View', keywords: 'forge create bot memory' },
  { id: 'vault', label: 'Passwords & keys', category: 'View', keywords: 'secrets api keys' },
  { id: 'overview', label: 'Feature tour', category: 'View', dev: true, keywords: 'overview' },
  { id: 'rsi', label: 'Model lab', category: 'View', dev: true, keywords: 'benchmark rsi' },
  { id: 'mimri', label: 'System checks', category: 'View', dev: true, keywords: 'diagnostics' },
];

function scoreMatch(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!t) return 0;
  if (t.startsWith(q)) return 100 - Math.min(30, t.length - q.length);
  const idx = t.indexOf(q);
  if (idx >= 0) return 70 - Math.min(30, idx);
  // Ordered fuzzy character match
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) qi += 1;
    else if (qi > 0) gaps += 1;
  }
  return qi === q.length ? Math.max(10, 40 - gaps) : 0;
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  threads = [],
  spaces = [],
  bots = [],
  commands = [],
  activeThreadId = null,
  showComputer = false,
  showDeveloperTools = false,
  onNewThread,
  onToggleComputer,
  onOpenCanvas,
  onExportThread,
  onSelectTab,
  onSelectThread,
  onSelectSpace,
  onSelectBot,
  onInsertCommand,
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const prevFocusRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement;
      setQuery('');
      setActiveIdx(0);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
      prevFocusRef.current.focus();
      prevFocusRef.current = null;
    }
    return undefined;
  }, [isOpen]);

  const items = useMemo(() => {
    const out = [
      {
        id: 'action-new-chat',
        category: 'Action',
        title: 'New Chat',
        subtitle: 'Start a fresh conversation',
        shortcut: 'Ctrl+N',
        run: () => onNewThread?.(),
      },
      {
        id: 'action-toggle-work',
        category: 'Action',
        title: showComputer ? 'Hide Work View' : 'Show Work View',
        subtitle: 'Toggle the right-hand workspace pane',
        shortcut: 'Ctrl+Shift+B',
        run: () => onToggleComputer?.(),
      },
      {
        id: 'action-open-canvas',
        category: 'Action',
        title: 'Open Canvas',
        subtitle: 'Open the live editable code and preview workbench',
        run: () => onOpenCanvas?.({ path: '', content: '', language: 'markdown', title: 'Untitled Canvas' }),
      },
    ];

    if (activeThreadId) {
      out.push(
        {
          id: 'action-export-md',
          category: 'Action',
          title: 'Export Thread (.md)',
          subtitle: 'Download current conversation as Markdown',
          run: () => onExportThread?.('md'),
        },
        {
          id: 'action-export-json',
          category: 'Action',
          title: 'Export Thread (.json)',
          subtitle: 'Download current conversation as JSON',
          run: () => onExportThread?.('json'),
        }
      );
    }

    for (const nav of NAV_ITEMS) {
      if (nav.dev && !showDeveloperTools) continue;
      out.push({
        id: `nav-${nav.id}`,
        category: nav.category,
        title: nav.label,
        subtitle: `Go to ${nav.label}`,
        keywords: nav.keywords,
        run: () => onSelectTab?.(nav.id),
      });
    }

    for (const bot of bots) {
      out.push({
        id: `bot-${bot.id}`,
        category: 'Teammate',
        title: bot.name,
        subtitle: bot.role || 'AI teammate',
        keywords: `${bot.specialistTag || ''} ${bot.id}`,
        run: () => onSelectBot?.(bot.id),
      });
    }

    for (const sp of spaces) {
      out.push({
        id: `space-${sp.id}`,
        category: 'Space',
        title: sp.title,
        subtitle: `Filter project space (${sp.surface || 'chat'})`,
        run: () => onSelectSpace?.(sp),
      });
    }

    for (const thr of threads) {
      out.push({
        id: `thread-${thr.id}`,
        category: 'Chat',
        title: thr.title || 'New Chat',
        subtitle: 'Open conversation',
        run: () => onSelectThread?.(thr.id),
      });
    }

    for (const cmd of commands) {
      out.push({
        id: `cmd-${cmd.cmd}`,
        category: 'Command',
        title: cmd.syntax || cmd.cmd,
        subtitle: cmd.desc || 'Run slash command',
        run: () => onInsertCommand?.(`${cmd.cmd} `),
      });
    }

    return out;
  }, [
    activeThreadId,
    bots,
    commands,
    onExportThread,
    onInsertCommand,
    onNewThread,
    onOpenCanvas,
    onSelectBot,
    onSelectSpace,
    onSelectTab,
    onSelectThread,
    onToggleComputer,
    showComputer,
    showDeveloperTools,
    spaces,
    threads,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 40);
    return items
      .map(item => {
        const hay = `${item.title} ${item.category} ${item.subtitle || ''} ${item.keywords || ''}`;
        return { item, score: Math.max(scoreMatch(q, item.title) * 1.2, scoreMatch(q, hay)) };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(entry => entry.item);
  }, [items, query]);

  const safeIdx = filtered.length > 0 ? Math.min(activeIdx, filtered.length - 1) : 0;

  useEffect(() => {
    if (!isOpen || !filtered.length) return;
    const activeEl = listRef.current?.querySelector(`[data-palette-idx="${safeIdx}"]`);
    activeEl?.scrollIntoView?.({ block: 'nearest' });
  }, [isOpen, safeIdx, filtered.length]);

  if (!isOpen) return null;

  const executeItem = item => {
    if (!item) return;
    onClose?.();
    item.run?.();
  };

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) setActiveIdx(i => (i + 1) % filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) setActiveIdx(i => (i - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      executeItem(filtered[safeIdx]);
    }
  };

  const activeItem = filtered[safeIdx];

  return (
    <div
      className="cmd-palette-backdrop"
      data-testid="command-palette"
      onClick={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="cmd-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="search"
          className="cmd-palette-input"
          data-testid="command-palette-input"
          aria-label="Search chats, spaces, teammates, views, and commands"
          aria-autocomplete="list"
          aria-controls="cmd-palette-listbox"
          aria-activedescendant={activeItem ? `cmd-opt-${activeItem.id}` : undefined}
          placeholder="Search chats, spaces, teammates, views, or /commands..."
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
        />
        <ul
          ref={listRef}
          id="cmd-palette-listbox"
          className="cmd-palette-list"
          role="listbox"
          aria-label="Command palette results"
          data-testid="command-palette-list"
        >
          {filtered.length === 0 ? (
            <li className="muted" style={{ padding: '14px 12px', fontSize: 12.5 }}>
              No matching chats, views, or commands.
            </li>
          ) : (
            filtered.map((item, idx) => {
              const isActive = idx === safeIdx;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`cmd-opt-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-palette-idx={idx}
                    className={`cmd-palette-item ${isActive ? 'is-active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => executeItem(item)}
                  >
                    <span
                      className="cmd-palette-item-main"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}
                    >
                      <span
                        className="cmd-palette-cat"
                        style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--brass)', flexShrink: 0 }}
                      >
                        {item.category}
                      </span>
                      <span
                        className="cmd-palette-title"
                        style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span
                          className="cmd-palette-sub muted"
                          style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {item.shortcut && <kbd className="cmd-palette-kbd">{item.shortcut}</kbd>}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
