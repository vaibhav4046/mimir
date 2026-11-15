import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import {
  AttachmentFileSvg,
  ChiefCrownPixelSvg,
  CloseCrossSvg,
  IrreversibleGateSvg,
  ReversibleShieldSvg,
  SessionHandoffSvg,
  SkillMarkdownSvg,
  TeamTopologySvg,
  WorkspaceVaultCrateSvg,
  YggdrasilCrestSvg,
} from './Icons.jsx';
import { MimirAsset, RealmNavigator } from './MimirAsset.jsx';
import { CanvasPane } from './CanvasPane.jsx';

function formatBrowserStateLabel(raw) {
  const val = String(raw || '').trim();
  if (!val) return '';
  const lower = val.toLowerCase();
  if (lower === 'blocked_by_challenge') return 'Sign-in needed';
  if (lower === 'idle' || lower === 'work view idle') return 'Idle';
  if (lower === 'authorized' || lower === 'work view authorized' || lower === 'active') return 'Ready';
  if (lower === 'running' || lower === 'busy') return 'Running';
  return val.replace(/_/g, ' ');
}

function FileTree({ nodes, onOpenFile }) {
  if (!nodes?.length) {
    return <div style={{ color: 'var(--ink-subtle)', fontSize: 12 }}>Workspace is empty.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 10, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {nodes.map(n => (
        <li key={n.path}>
          {n.type === 'dir' ? (
            <div style={{ fontFamily: 'var(--sand-mono)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, padding: '2px 4px', color: 'var(--ink-muted)' }}>
              <AttachmentFileSvg size={12} />
              <span>{n.name}/</span>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              data-testid={`file-tree-item-${n.path}`}
              onClick={() => onOpenFile?.(n.path)}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                textAlign: 'left',
                fontFamily: 'var(--sand-mono)',
                fontSize: 12,
                padding: '4px 8px',
                minHeight: 30,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <AttachmentFileSvg size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-subtle)', flex: 'none' }}>{n.size}B</span>
            </button>
          )}
          {n.children?.length > 0 && <FileTree nodes={n.children} onOpenFile={onOpenFile} />}
        </li>
      ))}
    </ul>
  );
}

/** Facts every bot sees in every chat. Saved when the user says "remember that ...". */
function SharedMemoryList({ filterQuery = '' }) {
  const [facts, setFacts] = useState(null);
  const [memErr, setMemErr] = useState('');
  const load = () => apiFetch('/v1/memory/shared').then(r => setFacts(r.facts || [])).catch(() => setFacts([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  const forget = async key => {
    setMemErr('');
    try {
      await apiFetch(`/v1/memory/shared/${encodeURIComponent(key)}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setMemErr(err?.message || 'Could not remove shared memory.');
    }
  };
  const q = filterQuery.trim().toLowerCase();
  const visible = (facts || []).filter(f => {
    if (!q) return true;
    return `${f.key || ''} ${f.value || ''}`.toLowerCase().includes(q);
  });
  return (
    <div data-testid="shared-memory" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <span style={{ fontSize: 11.5, color: 'var(--brass)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Remembered in every chat
      </span>
      {memErr && <div className="error-banner" role="alert">{memErr}</div>}
      {facts?.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing yet. Say "remember that ..." in any chat and every bot will know it.</div>
      )}
      {facts?.length > 0 && visible.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>No shared memories match this filter.</div>
      )}
      {visible.map(f => (
        <div key={f.key} className="card" style={{ padding: 10, gap: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, wordBreak: 'break-word' }}>{f.value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-subtle)', marginTop: 2 }}>
              Scope: {f.scope || 'global'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-icon btn-sm"
            aria-label={`Forget: ${f.value}`}
            style={{ minWidth: 32, minHeight: 32, flex: 'none' }}
            onClick={() => forget(f.key)}
          >
            <CloseCrossSvg size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

const PREVIEW_TABS = [
  { id: 'team', label: 'Team', icon: 'allies' },
  { id: 'screen', label: 'Screen', icon: 'screen' },
  { id: 'canvas', label: 'Canvas', icon: 'code-mode' },
  { id: 'files', label: 'Files', icon: 'workspace' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
];

export function ComputerPane({
  botId,
  threadId = null,
  computerState,
  memories,
  settings,
  teamOverview = null,
  canvasTarget = null,
  onDeployChiefTeam = null,
  onSelectBot = null,
  onSettingsChange,
  onRefresh,
  onClose,
}) {
  const showDevTools = Boolean(settings?.showDeveloperTools);
  const [subTab, setSubTab] = useState('screen');
  const [activeCanvasTarget, setActiveCanvasTarget] = useState(null);
  const [expandedSkill, setExpandedSkill] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [urlDraft, setUrlDraft] = useState(computerState?.browser?.url || '');
  const [typeDraft, setTypeDraft] = useState('');
  const [cloudWsDraft, setCloudWsDraft] = useState(settings?.cloudBrowserWsUrl || '');
  const [busy, setBusy] = useState(false);
  const [screenErr, setScreenErr] = useState('');
  const [desktopSnap, setDesktopSnap] = useState(null);
  const [showRealms, setShowRealms] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [screenFocusHint, setScreenFocusHint] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [suiteReport, setSuiteReport] = useState(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [memKey, setMemKey] = useState('');
  const [memVal, setMemVal] = useState('');
  const [memFilter, setMemFilter] = useState('');
  const [editingMemKey, setEditingMemKey] = useState('');
  const [editMemVal, setEditMemVal] = useState('');
  const [editMemScope, setEditMemScope] = useState('bot');
  const [editMemPinned, setEditMemPinned] = useState(false);
  const [memBusy, setMemBusy] = useState(false);
  const [activeRealm, setActiveRealm] = useState('midgard');
  const [warping, setWarping] = useState(false);
  const [receiptsLedger, setReceiptsLedger] = useState(null);
  const [runsLedger, setRunsLedger] = useState([]);
  const [copiedLedger, setCopiedLedger] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [handoffNotice, setHandoffNotice] = useState('');
  const [playbookNotice, setPlaybookNotice] = useState('');
  const [snapshotNotice, setSnapshotNotice] = useState('');
  const [skillNotice, setSkillNotice] = useState('');
  const tabRefs = useRef({});
  const dragStartRef = useRef(null);
  const screenFrameRef = useRef(null);

  useEffect(() => {
    if (!canvasTarget) return;
    setActiveCanvasTarget(canvasTarget);
    setSubTab('canvas');
  }, [canvasTarget]);

  const openWorkspaceFile = relPath => {
    if (!relPath) return;
    setActiveCanvasTarget({ path: relPath, openRequestedAt: Date.now() });
    setSubTab('canvas');
  };

  const loadSessions = async () => {
    if (!botId) return;
    try {
      const res = await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/sessions`);
      setSessions(res?.sessions || []);
    } catch {
      // Optional sessions endpoint
    }
  };

  const handleSaveSessionHandoff = async () => {
    setBusy(true);
    setScreenErr('');
    setHandoffNotice('');
    try {
      const targetUrl = urlDraft.trim() || b?.url || 'https://app.mimir.local';
      let domain = 'app.mimir.local';
      try {
        domain = new URL(targetUrl).hostname || domain;
      } catch {}
      const out = await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/sessions/save`, {
        method: 'POST',
        body: JSON.stringify({ label: domain, url: targetUrl, domain }),
      });
      await loadSessions();
      await loadReceipts();
      setHandoffNotice(`Saved ${out.session?.filePath} (${out.session?.cookieCount || 1} cookie, 0 passwords)`);
    } catch (err) {
      setScreenErr(err.message || 'Failed to save session handoff');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreSessionHandoff = async sessionId => {
    setBusy(true);
    setScreenErr('');
    setHandoffNotice('');
    try {
      const out = await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/sessions/${encodeURIComponent(sessionId)}/restore`, {
        method: 'POST',
        body: '{}',
      });
      await loadSessions();
      await loadReceipts();
      await onRefresh?.();
      setHandoffNotice(`Restored "${out.session?.label || sessionId}" into browser context`);
    } catch (err) {
      setScreenErr(err.message || 'Failed to restore session');
    } finally {
      setBusy(false);
    }
  };

  const handleRunChiefPlaybook = async () => {
    setBusy(true);
    setScreenErr('');
    setPlaybookNotice('');
    try {
      const out = await apiFetch('/v1/team/run-playbook', {
        method: 'POST',
        body: JSON.stringify({ botId }),
      });
      await loadReceipts();
      await onRefresh?.();
      setPlaybookNotice(`Delegated @Mara -> @Cole (${(out.artifacts || []).length} artifacts + receipt ${String(out.receipt?.eventHash || '').slice(0, 8)})`);
    } catch (err) {
      setScreenErr(err.message || 'Playbook execution failed');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyWorkspace = async () => {
    setBusy(true);
    setScreenErr('');
    setSnapshotNotice('');
    try {
      const out = await apiFetch(`/v1/workspace/${encodeURIComponent(botId)}/snapshot`, {
        method: 'POST',
        body: '{}',
      });
      await loadReceipts();
      await onRefresh?.();
      setSnapshotNotice(`Verified ${out.fileCount || 0} file(s) -> ${out.manifestPath}`);
    } catch (err) {
      setScreenErr(err.message || 'Workspace snapshot failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSeedPresetSkills = async () => {
    setBusy(true);
    setScreenErr('');
    setSkillNotice('');
    try {
      const out = await apiFetch(`/v1/workspace/${encodeURIComponent(botId)}/skills/seed`, {
        method: 'POST',
        body: '{}',
      });
      await onRefresh?.();
      setSkillNotice(`Seeded ${(out.skills || []).length} structured v1.0 skills in /workspace/skills/`);
    } catch (err) {
      setScreenErr(err.message || 'Seeding preset skills failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRunSkill = async slug => {
    setBusy(true);
    setScreenErr('');
    setSkillNotice('');
    try {
      const out = await apiFetch(`/v1/workspace/${encodeURIComponent(botId)}/skills/${encodeURIComponent(slug)}/run`, {
        method: 'POST',
        body: '{}',
      });
      await loadReceipts();
      await onRefresh?.();
      setSkillNotice(`Ran "${out.title}" (${out.version}) -> ${out.csvPath || out.outputPath} (${out.outputBytes}B)`);
    } catch (err) {
      setScreenErr(err.message || `Skill ${slug} execution failed`);
    } finally {
      setBusy(false);
    }
  };

  const loadReceipts = async () => {
    try {
      const [rcRes, runsRes] = await Promise.allSettled([
        apiFetch('/v1/receipts?limit=12'),
        apiFetch('/v1/runs?limit=8'),
      ]);
      if (rcRes.status === 'fulfilled') setReceiptsLedger(rcRes.value);
      if (runsRes.status === 'fulfilled') setRunsLedger(runsRes.value?.runs || []);
    } catch {
      // Optional ledger endpoint
    }
  };

  const handleRunAction = async (runId, action) => {
    setBusy(true);
    try {
      if (action === 'approve') {
        await apiFetch(`/v1/runs/${encodeURIComponent(runId)}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approved: true, decision: 'approve' }),
        });
      } else if (action === 'deny') {
        await apiFetch(`/v1/runs/${encodeURIComponent(runId)}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approved: false, decision: 'deny' }),
        });
      } else if (action === 'cancel') {
        await apiFetch(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }
      await loadReceipts();
      await onRefresh?.();
    } catch (err) {
      setScreenErr(err.message || 'Run action failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (subTab === 'activity') {
      loadReceipts();
    } else if (subTab === 'screen') {
      loadSessions();
    }
  }, [subTab, botId]);

  const handleTabKeyDown = (e, idx) => {
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % PREVIEW_TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + PREVIEW_TABS.length) % PREVIEW_TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = PREVIEW_TABS.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      const nextTab = PREVIEW_TABS[nextIdx];
      setSubTab(nextTab.id);
      tabRefs.current[nextTab.id]?.focus();
    }
  };

  const resumeChallenge = async () => {
    setBusy(true);
    setScreenErr('');
    try {
      await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/resume-challenge`, {
        method: 'POST',
        body: '{}',
      });
      await onRefresh();
    } catch (err) {
      setScreenErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const b = computerState?.browser;
  const activeMode = settings?.browserMode || b?.mode || 'embedded';
  const userControl = Boolean(b?.userControlActive || b?.controlMode === 'user');
  const agentCursor = b?.agentCursor || null;

  const toggleControlMode = async () => {
    setBusy(true);
    setScreenErr('');
    try {
      await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/control`, {
        method: 'POST',
        body: JSON.stringify({ mode: userControl ? 'agent' : 'user' }),
      });
      await onRefresh?.();
    } catch (err) {
      setScreenErr(err.message || 'Control mode switch failed');
    } finally {
      setBusy(false);
    }
  };

  const runSuiteHarness = async () => {
    setSuiteRunning(true);
    setScreenErr('');
    try {
      const res = await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/run-agent-suite`, {
        method: 'POST',
        body: '{}',
      });
      setSuiteReport(res);
      await onRefresh?.();
    } catch (err) {
      setScreenErr(err.message || '5-Tier Browser Suite failed');
    } finally {
      setSuiteRunning(false);
    }
  };

  useEffect(() => {
    if (b?.url) setUrlDraft(b.url);
  }, [b?.url]);

  const navigate = async e => {
    e.preventDefault();
    if (!urlDraft.trim()) return;
    setBusy(true);
    setScreenErr('');
    try {
      await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/open`, {
        method: 'POST',
        body: JSON.stringify({ url: urlDraft.trim() }),
      });
      await onRefresh();
    } catch (err) {
      setScreenErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async payload => {
    setBusy(true);
    setScreenErr('');
    try {
      await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/action`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await onRefresh();
    } catch (err) {
      setScreenErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const getPointerPct = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100));
    return { xPct: Math.round(xPct * 10) / 10, yPct: Math.round(yPct * 10) / 10 };
  };

  const dragStartRefClean = () => {
    dragStartRef.current = null;
  };
  useEffect(() => {
    const clearDrag = () => {
      dragStartRef.current = null;
    };
    window.addEventListener('mouseup', clearDrag);
    return () => window.removeEventListener('mouseup', clearDrag);
  }, []);

  const handlePointerDown = e => {
    if (!b?.screenshotBase64 || busy || e.button !== 0) return;
    dragStartRef.current = getPointerPct(e);
  };

  const handlePointerUp = async e => {
    if (!b?.screenshotBase64 || busy || !dragStartRef.current) return;
    const start = dragStartRef.current;
    dragStartRefClean();
    const end = getPointerPct(e);
    const dist = Math.hypot(end.xPct - start.xPct, end.yPct - start.yPct);
    const sourcePatch = userControl ? { source: 'user' } : {};
    if (dist > 2.2) {
      await runAction({
        action: 'drag',
        startXPct: start.xPct,
        startYPct: start.yPct,
        endXPct: end.xPct,
        endYPct: end.yPct,
        ...sourcePatch,
      });
    } else {
      await runAction({ action: 'click_percent', xPct: end.xPct, yPct: end.yPct, ...sourcePatch });
    }
  };

  const handleScreenWheel = async e => {
    if (!b?.screenshotBase64 || busy || Math.abs(e.deltaY) < 12) return;
    const pt = getPointerPct(e);
    await runAction({
      action: 'scroll',
      direction: e.deltaY > 0 ? 'down' : 'up',
      xPct: pt.xPct,
      yPct: pt.yPct,
      ...(userControl ? { source: 'user' } : {}),
    });
  };

  const handleDirectType = async e => {
    e.preventDefault();
    if (!typeDraft) return;
    const text = typeDraft;
    setTypeDraft('');
    await runAction({ action: 'type', type: 'type', text, submit: true, ...(userControl ? { source: 'user' } : {}) });
  };

  const handleScreenKeyDown = async e => {
    if (!userControl || !b?.screenshotBase64 || busy) return;
    if (e.target !== e.currentTarget) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault();
    const isChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    await runAction({
      action: 'key',
      type: 'key',
      key: e.key,
      ...(isChar ? { text: e.key } : {}),
      source: 'user',
    });
  };

  const handleModeSwitch = async nextMode => {
    setScreenErr('');
    setBusy(true);
    try {
      const updated = await apiFetch('/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          browserMode: nextMode,
          ...(nextMode === 'free-cloud' && cloudWsDraft ? { cloudBrowserWsUrl: cloudWsDraft.trim() } : {}),
        }),
      });
      onSettingsChange?.(updated);
      await onRefresh();
    } catch (err) {
      setScreenErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartFreeRelay = async () => {
    setBusy(true);
    setScreenErr('');
    try {
      const relay = await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/relay`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setCloudWsDraft(relay.wsEndpoint || '');
      const nextSettings = await apiFetch('/v1/settings');
      onSettingsChange?.(nextSettings);
      await onRefresh();
    } catch (err) {
      setScreenErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const captureDesktop = async () => {
    if (!window.desktop?.captureDesktopScreen) return;
    try {
      const res = await window.desktop.captureDesktopScreen();
      if (res?.dataUrl) setDesktopSnap(res);
    } catch (err) {
      setScreenErr(err?.message || 'Screen capture failed.');
    }
  };

  const saveMem = async e => {
    e.preventDefault();
    if (!memKey.trim() || !memVal.trim()) return;
    setScreenErr('');
    try {
      await apiFetch(`/v1/bots/${encodeURIComponent(botId)}/memories`, {
        method: 'POST',
        body: JSON.stringify({ key: memKey.trim(), value: memVal.trim() }),
      });
      setMemKey('');
      setMemVal('');
      await onRefresh();
    } catch (err) {
      setScreenErr(err?.message || 'Failed saving memory.');
    }
  };

  const startEditMem = m => {
    setEditingMemKey(m.key);
    setEditMemVal(m.value || '');
    setEditMemScope(m.scope || 'bot');
    setEditMemPinned(Boolean(m.pinned));
  };

  const saveEditedMem = async e => {
    e.preventDefault();
    if (!editingMemKey || !editMemVal.trim() || memBusy) return;
    setMemBusy(true);
    setScreenErr('');
    try {
      await apiFetch(`/v1/bots/${encodeURIComponent(botId)}/memories/${encodeURIComponent(editingMemKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          value: editMemVal.trim(),
          scope: editMemScope,
          pinned: editMemPinned,
        }),
      });
      setEditingMemKey('');
      setEditMemVal('');
      await onRefresh?.();
    } catch (err) {
      setScreenErr(err?.message || 'Could not update memory.');
    } finally {
      setMemBusy(false);
    }
  };

  const delMem = async key => {
    setScreenErr('');
    try {
      await apiFetch(`/v1/bots/${encodeURIComponent(botId)}/memories/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (editingMemKey === key) setEditingMemKey('');
      await onRefresh();
    } catch (err) {
      setScreenErr(err?.message || 'Failed deleting memory.');
    }
  };

  const filteredMemories = useMemo(() => {
    const q = memFilter.trim().toLowerCase();
    const list = memories || [];
    if (!q) return list;
    return list.filter(m =>
      `${m.key || ''} ${m.value || ''} ${m.scope || ''} ${m.spaceId || ''} ${m.provenance?.sourceThreadId || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [memories, memFilter]);

  const browserStateLabel = formatBrowserStateLabel(b?.browserState);

  return (
    <aside className={`computer-pane ${enlarged ? 'is-enlarged' : ''}`} data-testid="computer-pane" aria-label="Work View and Browser">
      <div className="topbar" style={{ padding: '0 12px' }}>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brass)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MimirAsset category="artifacts" name="bifrost-portal" size={16} />
          Work view
          {browserStateLabel && (
            <span className="pill" data-testid="browser-state-pill" style={{ fontSize: 10 }}>
              {browserStateLabel}
            </span>
          )}
        </strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm" onClick={onRefresh}>
            <MimirAsset category="ui" name="refresh" size={13} />
            Refresh
          </button>
          {onClose && (
            <button
              type="button"
              className="btn btn-sm computer-close-btn"
              aria-label="Close Work view"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>

      <div className="computer-tabs" role="tablist" aria-label="Preview Sections">
        {PREVIEW_TABS.map((t, idx) => {
          const isSelected = subTab === t.id;
          return (
            <button
              key={t.id}
              ref={el => { tabRefs.current[t.id] = el; }}
              id={`preview-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="preview-tabpanel"
              tabIndex={isSelected ? 0 : -1}
              className={`tab-btn ${isSelected ? 'active' : ''}`}
              onClick={() => setSubTab(t.id)}
              onKeyDown={e => handleTabKeyDown(e, idx)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <MimirAsset category="ui" name={t.icon} size={13} />
              {t.id === 'memory' ? `Memory (${memories?.length || 0})` : t.label}
            </button>
          );
        })}
      </div>

      <div
        id="preview-tabpanel"
        role="tabpanel"
        aria-labelledby={`preview-tab-${subTab}`}
        className="computer-body"
      >
        {subTab === 'team' && (
          <div className="team-inspector" data-testid="team-topology-pane">
            {teamOverview?.chief ? (
              <>
                <div className="team-chief-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ChiefCrownPixelSvg size={18} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{teamOverview.chief.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{teamOverview.chief.role}</div>
                      </div>
                    </div>
                    <span className="pill is-emerald" style={{ fontSize: 10 }}>
                      {teamOverview.chief.state === 'working' ? 'WORKING' : 'ACTIVE'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                    Coordinates specialists via <code>@mention</code> and saves files in your work folder.
                  </div>
                  {showDevTools && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        data-testid="run-chief-playbook-btn"
                        disabled={busy}
                        onClick={handleRunChiefPlaybook}
                      >
                        Run sample handoff (@Mara to @Cole)
                      </button>
                    </div>
                  )}
                  {playbookNotice && (
                    <div style={{ fontSize: 11, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }} data-testid="playbook-notice">
                      {playbookNotice}
                    </div>
                  )}
                </div>

                <div className="team-card-box">
                  <div className="team-box-title">
                    <TeamTopologySvg size={14} />
                    <span>How the team connects</span>
                  </div>
                  <svg
                    viewBox="0 0 260 112"
                    className="team-topology-svg topology-svg"
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label="Chief of Staff Team Topology diagram"
                  >
                    <rect x="0" y="0" width="260" height="112" fill="var(--bg-canvas)" stroke="var(--rule)" />
                    <path d="M130 34v18M32 52h196M32 52v14M81 52v14M130 52v14M179 52v14M228 52v14" stroke="var(--rule-strong)" strokeWidth="2" strokeDasharray="3 3" fill="none" />
                    <rect x="108" y="8" width="44" height="26" fill="var(--bg-surface)" stroke={teamOverview.chief.color || 'var(--brass)'} strokeWidth="2" />
                    <rect x="122" y="13" width="16" height="10" fill={teamOverview.chief.color || 'var(--brass)'} />
                    <rect x="126" y="16" width="3" height="3" fill="var(--bg-canvas)" />
                    <rect x="131" y="16" width="3" height="3" fill="var(--bg-canvas)" />
                    <text x="130" y="31" textAnchor="middle" fill="var(--ink)" fontSize="6" fontFamily="monospace">
                      {teamOverview.chief.name.slice(0, 8)}
                    </text>

                    {(teamOverview.specialists || []).slice(0, 5).map((sp, i) => {
                      const cx = 32 + i * 49;
                      const col = sp.color || 'var(--frost)';
                      return (
                        <g
                          key={sp.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Select ${sp.name}`}
                          onClick={() => onSelectBot?.(sp.id)}
                          onKeyDown={evt => {
                            if (evt.key === 'Enter' || evt.key === ' ') {
                              evt.preventDefault();
                              onSelectBot?.(sp.id);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <rect x={cx - 19} y="66" width="38" height="34" fill="var(--bg-elevated)" stroke={sp.state === 'working' ? 'var(--warn)' : col} strokeWidth="1.5" />
                          <rect x={cx - 7} y="71" width="14" height="10" fill={col} />
                          <rect x={cx - 4} y="74" width="2.5" height="3" fill="var(--bg-canvas)" />
                          <rect x={cx + 1.5} y="74" width="2.5" height="3" fill="var(--bg-canvas)" />
                          <text x={cx} y="91" textAnchor="middle" fill="var(--ink)" fontSize="6.2" fontFamily="monospace">
                            {sp.name.slice(0, 7)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div className="team-card-box">
                  <div className="team-box-title">
                    <span>Active Work</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {(teamOverview.activeWork || []).map(item => (
                      <div key={item.botId} className="active-work-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span className="work-color-sq" style={{ background: item.color || 'var(--frost)' }} />
                          <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name} · {item.tag}
                          </span>
                        </div>
                        <span
                          className={`work-badge ${
                            item.status === 'DONE'
                              ? 'is-done'
                              : item.status === 'IN PROGRESS'
                                ? 'is-progress'
                                : 'is-pending'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="team-card-box">
                  <div className="team-box-title">
                    <span>Team Activity (Recent Turns)</span>
                  </div>
                  <div className="sparkline-bars" aria-label="Team Activity sparkline">
                    {(teamOverview.activitySeries || []).map((val, idx) => {
                      const maxVal = Math.max(1, ...(teamOverview.activitySeries || [1]));
                      const hPct = Math.max(14, Math.round((val / maxVal) * 100));
                      return (
                        <span
                          key={idx}
                          className={`spark-bar ${val > 0 ? 'is-active' : ''}`}
                          style={{ height: `${hPct}%` }}
                          title={`${val} event(s)`}
                        />
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}

            {!teamOverview?.deployed && onDeployChiefTeam && (
              <div className="team-card-box" style={{ gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Deploy the 6-bot Chief of Staff team (Klaus + @Mara, @Cole, @Rina, @Vince, @Jonathan) to enable async @mention delegation and live topology telemetry.
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="inspector-deploy-team-btn"
                  disabled={deploying}
                  onClick={async () => {
                    setDeploying(true);
                    try {
                      await onDeployChiefTeam();
                    } finally {
                      setDeploying(false);
                    }
                  }}
                >
                  <ChiefCrownPixelSvg size={14} />
                  <span>{deploying ? 'Deploying...' : 'Deploy 6-Bot Chief Team'}</span>
                </button>
              </div>
            )}

            <div className="team-card-box">
              <div className="team-box-title">
                <ReversibleShieldSvg size={13} />
                <span>When Mimir asks your OK</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                <span className="pill is-emerald">
                  <ReversibleShieldSvg size={11} /> Safe: Research / Drafts / Local files
                </span>
                <span className="pill is-crimson">
                  <IrreversibleGateSvg size={11} /> Asks first: Sending / Paying / Live changes
                </span>
              </div>
            </div>
          </div>
        )}

        {subTab === 'screen' && (
          <>
            {/* 3-Mode Browser Engine Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--bg-surface)', border: '1px solid var(--rule)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-subtle)' }}>
                Which browser Mimir uses
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[
                  { id: 'embedded', label: 'Built-in' },
                  { id: 'user-computer', label: 'Your Chrome/Edge' },
                  { id: 'free-cloud', label: 'Online relay' },
                ].map(m => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`browser-mode-${m.id}`}
                    className={`btn btn-sm ${activeMode === m.id ? 'btn-primary' : ''}`}
                    style={{ flex: '1 1 auto' }}
                    disabled={busy}
                    onClick={() => handleModeSwitch(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {activeMode === 'user-computer' && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                  Connects to your Chrome/Edge ({settings?.userCdpUrl || '127.0.0.1:9222'}) or opens a browser window on your desktop.
                </div>
              )}
              {activeMode === 'free-cloud' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      className="input"
                      placeholder="Relay link or click Start free browser relay"
                      value={cloudWsDraft}
                      onChange={e => setCloudWsDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const updated = await apiFetch('/v1/settings', {
                          method: 'PATCH',
                          body: JSON.stringify({ browserMode: 'free-cloud', cloudBrowserWsUrl: cloudWsDraft.trim() }),
                        });
                        onSettingsChange?.(updated);
                      }}
                    >
                      Save link
                    </button>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={handleStartFreeRelay} disabled={busy}>
                    Start free browser relay
                  </button>
                </div>
              )}
            </div>

            {/* Compact Toolbar + Collapsible Realms (dev) */}
            <div className="browser-control-bar">
              <button
                type="button"
                className="btn btn-sm"
                data-testid="browser-back-btn"
                aria-label="Browser back"
                title="Back"
                disabled={busy}
                onClick={() => runAction({ action: 'back', type: 'back' })}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="browser-forward-btn"
                aria-label="Browser forward"
                title="Forward"
                disabled={busy}
                onClick={() => runAction({ action: 'forward', type: 'forward' })}
              >
                Forward
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="browser-reload-btn"
                aria-label="Reload page"
                title="Reload"
                disabled={busy}
                onClick={() => runAction({ action: 'reload', type: 'reload' })}
              >
                Reload
              </button>
              <button
                type="button"
                className={`btn btn-sm ${showTargets ? 'btn-primary' : ''}`}
                data-testid="toggle-element-targets-btn"
                aria-pressed={showTargets}
                disabled={busy || !(b?.interactiveElements?.length)}
                onClick={() => setShowTargets(v => !v)}
              >
                {showTargets ? 'Hide targets' : 'Show element targets'}
              </button>
              <button
                type="button"
                className={`btn btn-sm browser-take-control-btn ${userControl ? 'is-active' : ''}`}
                data-testid="browser-take-control-btn"
                disabled={busy || suiteRunning}
                onClick={toggleControlMode}
              >
                {userControl ? 'Let Mimir continue' : 'Take control'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="browser-enlarge-btn"
                onClick={() => setEnlarged(v => !v)}
              >
                {enlarged ? 'Smaller' : 'Larger'}
              </button>
              {showDevTools && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid="run-browser-suite-btn"
                    disabled={busy || suiteRunning || userControl}
                    onClick={runSuiteHarness}
                  >
                    {suiteRunning ? 'Running checks...' : 'Run browser checks'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid="toggle-realm-navigator"
                    onClick={() => setShowRealms(v => !v)}
                  >
                    {showRealms ? 'Hide sample sites' : 'Sample sites'}
                  </button>
                </>
              )}
            </div>

            {showDevTools && showRealms && (
              <RealmNavigator
                activeRealm={activeRealm}
                warping={warping}
                onSelectRealm={async (realm, shouldTraverse) => {
                  setActiveRealm(realm.id);
                  setWarping(true);
                  setTimeout(() => setWarping(false), 480);
                  if (shouldTraverse && realm.quickUrl) {
                    setUrlDraft(realm.quickUrl);
                    setBusy(true);
                    setScreenErr('');
                    try {
                      await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/open`, {
                        method: 'POST',
                        body: JSON.stringify({ url: realm.quickUrl }),
                      });
                      await onRefresh();
                    } catch (err) {
                      setScreenErr(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }
                }}
              />
            )}

            <form onSubmit={navigate} style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                aria-label="Browser URL or search query"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                placeholder="URL or search (e.g. github.com or python docs)..."
                data-testid="browser-url-input"
              />
              <button type="submit" className="btn btn-sm" disabled={busy} data-testid="browser-go-btn">
                <MimirAsset category="ui" name="go" size={12} />
                {busy ? '...' : 'Go'}
              </button>
            </form>

            {screenErr && (
              <div className="error-banner" role="alert">
                {screenErr}
              </div>
            )}

            {b?.browserState === 'blocked_by_challenge' && (
              <div className="challenge-banner" data-testid="challenge-banner" role="alert">
                <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <SessionHandoffSvg size={15} />
                  <span>Please sign in to continue</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                  Paused at <code>{b.challengeUrl || b.url || 'sign-in page'}</code>. Your password never goes into chat: sign in inside this browser window, then click Resume.
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    data-testid="resume-challenge-btn"
                    disabled={busy}
                    onClick={resumeChallenge}
                  >
                    Resume
                  </button>
                </div>
              </div>
            )}

            <div className="handoff-strip" data-testid="session-handoff-bar" style={{ flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <SessionHandoffSvg size={14} />
                  <span>
                    <strong>Saved logins</strong>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="save-session-handoff-btn"
                  style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                  disabled={busy}
                  onClick={handleSaveSessionHandoff}
                >
                  Save this login
                </button>
              </div>
              {handoffNotice && (
                <div style={{ fontSize: 10.5, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }}>
                  {handoffNotice}
                </div>
              )}
              {sessions.length > 0 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', width: '100%' }} data-testid="saved-sessions-list">
                  {sessions.slice(0, 4).map(s => (
                    <div key={s.id} className="session-handoff-chip">
                      <code>{s.label}</code>
                      <span>({s.cookieCount})</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-testid={`restore-session-${s.id}`}
                        style={{ minHeight: 24, padding: '0 6px', fontSize: 10 }}
                        disabled={busy}
                        onClick={() => handleRestoreSessionHandoff(s.id)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              ref={screenFrameRef}
              className="screen-frame"
              tabIndex={userControl && b?.screenshotBase64 ? 0 : undefined}
              aria-label={userControl ? 'Interactive browser screen. Focus and type keys directly.' : undefined}
              onFocus={() => { if (userControl) setScreenFocusHint(true); }}
              onBlur={() => setScreenFocusHint(false)}
              onKeyDown={handleScreenKeyDown}
            >
              {b?.screenshotBase64 ? (
                <>
                  <img
                    src={`data:image/jpeg;base64,${b.screenshotBase64}`}
                    alt={b.title || 'Interactive browser screen: click, drag, or scroll directly'}
                    title={userControl ? 'Manual control active: click, drag, scroll, or focus and type directly' : 'Click or drag directly on preview'}
                    onMouseDown={e => {
                      if (userControl) screenFrameRef.current?.focus?.();
                      handlePointerDown(e);
                    }}
                    onMouseUp={handlePointerUp}
                    onWheel={handleScreenWheel}
                  />
                  {userControl && (
                    <div className="take-control-badge" data-testid="take-control-badge">
                      {screenFocusHint
                        ? 'KEYBOARD CAPTURE ACTIVE · Type keys directly'
                        : 'HUMAN CONTROL ACTIVE · Click screen to type, drag, or scroll'}
                    </div>
                  )}
                  {showTargets && (b?.interactiveElements || []).length > 0 && (
                    <div className="screen-element-overlay" data-testid="screen-element-overlay">
                      {b.interactiveElements.map((el, idx) => {
                        const leftPct = Math.max(0, Math.min(97, ((el.x - el.w / 2) / 1280) * 100));
                        const topPct = Math.max(0, Math.min(97, ((el.y - el.h / 2) / 800) * 100));
                        const widthPct = Math.max(1.8, Math.min(100 - leftPct, (el.w / 1280) * 100));
                        const heightPct = Math.max(2.4, Math.min(100 - topPct, (el.h / 800) * 100));
                        const targetNum = el.index ?? idx;
                        return (
                          <button
                            key={`target-${targetNum}-${el.selector}`}
                            type="button"
                            className="screen-target-box"
                            data-testid={`screen-target-box-${targetNum}`}
                            aria-label={`Click element ${targetNum}: ${el.label || el.selector}`}
                            title={`#${targetNum} [${el.tag}] ${el.label || el.selector}`}
                            style={{
                              left: `${leftPct}%`,
                              top: `${topPct}%`,
                              width: `${widthPct}%`,
                              height: `${heightPct}%`,
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            onMouseUp={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              runAction({
                                action: 'clickElement',
                                type: 'clickElement',
                                elementIndex: targetNum,
                                selector: el.selector,
                                ...(userControl ? { source: 'user' } : {}),
                              });
                            }}
                          >
                            <span>{targetNum}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!userControl && agentCursor && Array.isArray(agentCursor.trail) && agentCursor.trail.length > 1 && (
                    <svg
                      className="agent-cursor-trail-svg"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      data-testid="agent-cursor-trail"
                    >
                      <polyline
                        fill="none"
                        stroke="rgba(56, 189, 248, 0.55)"
                        strokeWidth="0.65"
                        strokeDasharray="1.8 1.2"
                        points={agentCursor.trail.map(pt => `${pt.xPct},${pt.yPct}`).join(' ')}
                      />
                    </svg>
                  )}
                  {!userControl && agentCursor && agentCursor.xPct != null && (
                    <div
                      className="agent-cursor-overlay"
                      data-testid="agent-browser-cursor"
                      style={{ left: `${agentCursor.xPct}%`, top: `${agentCursor.yPct}%` }}
                    >
                      <span className="agent-cursor-pulse" />
                      <svg className="agent-cursor-pointer" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 3l7.2 17 2.4-6.4L20 11.2 4 3z"
                          fill="#38bdf8"
                          stroke="#0b1018"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {(agentCursor.label || agentCursor.action) && (
                        <span className="agent-cursor-pill">{agentCursor.label || agentCursor.action}</span>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 18, textAlign: 'center' }}>
                  <YggdrasilCrestSvg size={44} />
                  <span style={{ color: 'var(--ink-subtle)', fontSize: 12 }}>
                    Browser ready. Type a website address or search above.
                  </span>
                </div>
              )}
            </div>

            {userControl && (
              <form onSubmit={handleDirectType} className="take-control-bar" data-testid="take-control-bar">
                <input
                  className="input"
                  data-testid="take-control-input"
                  aria-label="Manual browser keyboard input"
                  placeholder="Type into focused element + Enter..."
                  value={typeDraft}
                  onChange={e => setTypeDraft(e.target.value)}
                />
                <button type="submit" className="btn btn-sm" disabled={!b?.url || busy}>
                  Send
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!b?.url || busy}
                  onClick={() => runAction({ action: 'press', key: 'Tab', source: 'user' })}
                >
                  Tab
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!b?.url || busy}
                  onClick={() => runAction({ action: 'press', key: 'Enter', source: 'user' })}
                >
                  Enter
                </button>
              </form>
            )}

            {b?.url && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div
                  title={b.title || 'Untitled'}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.title || 'Untitled'}
                </div>
                <div
                  title={b.url}
                  style={{
                    fontSize: 11.5,
                    fontFamily: 'var(--sand-mono)',
                    color: 'var(--ink-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.url}
                </div>
              </div>
            )}

            {suiteReport && (
              <div className="suite-report-card" data-testid="browser-suite-report">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700 }}>
                  <span style={{ color: suiteReport.allPassed ? 'var(--ok)' : 'var(--warn)' }}>
                    5-Tier Agentic Browser Suite: {suiteReport.passedTiers}/{suiteReport.totalTiers} Passed ({suiteReport.durationMs}ms)
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setSuiteReport(null)}>
                    Dismiss
                  </button>
                </div>
                <div className="suite-tier-grid">
                  {(suiteReport.tiers || []).map(t => (
                    <div key={t.tier} className={`suite-tier-pill ${t.passed ? 'pass' : 'fail'}`}>
                      <span>T{t.tier} · {t.difficulty}</span>
                      <strong>{t.passed ? 'PASS' : 'FAIL'}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(b?.interactiveElements || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-subtle)' }}>
                  Clickable items on page ({b.interactiveElements.length})
                </div>
                <div className="chip-list" style={{ maxHeight: 110, overflowY: 'auto' }}>
                  {b.interactiveElements.slice(0, 10).map(el => (
                    <button
                      key={`${el.index}-${el.selector}`}
                      type="button"
                      className="btn btn-sm"
                      style={{ fontSize: 11, padding: '2px 7px', minHeight: 26 }}
                      title={`Click ${el.selector} (${el.x}, ${el.y})`}
                      onClick={() => runAction({ action: 'click', selector: el.selector })}
                    >
                      [{el.tag}] {el.label || el.selector}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {desktopSnap && (
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Host Display: {desktopSnap.name}</div>
                <img src={desktopSnap.dataUrl} alt="Host display capture" style={{ width: '100%' }} />
              </div>
            )}
          </>
        )}

        {subTab === 'canvas' && (
          <CanvasPane
            botId={botId}
            threadId={threadId}
            fileTarget={activeCanvasTarget}
            onSaved={onRefresh}
          />
        )}

        {subTab === 'files' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="workspace-persistence-pane">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontFamily: 'var(--sand-mono)', color: 'var(--ink-muted)', wordBreak: 'break-all' }}>
              <MimirAsset category="artifacts" name="yggdrasil" size={18} />
              <span>{computerState?.workspace}</span>
            </div>

            {computerState?.workspaceLayout && (
              <div className="team-card-box">
                <div className="team-box-title" style={{ justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <WorkspaceVaultCrateSvg size={14} />
                    <span>Saved work folder</span>
                  </span>
                  <span className="pill is-emerald" style={{ fontSize: 10 }}>KEPT SAFE</span>
                </div>
                <div className="workspace-crate-grid">
                  {(computerState.workspaceLayout.persistentSubdirs || []).map(dir => (
                    <div key={dir.name} className="workspace-crate-chip">
                      <code>/{dir.name}/</code>
                      <span>{dir.fileCount} item(s)</span>
                    </div>
                  ))}
                </div>
                <div className="volatile-warn-row">
                  <span style={{ color: 'var(--warn)', fontWeight: 700 }}>TEMPORARY:</span>
                  <span>
                    {(computerState.workspaceLayout.volatilePaths || []).map(v => v.path).join(', ')} clear on restart. Save important files in your work folder.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {showDevTools && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-testid="verify-workspace-btn"
                      disabled={busy}
                      onClick={handleVerifyWorkspace}
                    >
                      Check &amp; Snapshot folder
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-testid="seed-preset-skills-btn"
                    disabled={busy}
                    onClick={handleSeedPresetSkills}
                  >
                    Add starter skills
                  </button>
                </div>
                {snapshotNotice && (
                  <div style={{ fontSize: 10.5, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }} data-testid="snapshot-notice">
                    {snapshotNotice}
                  </div>
                )}
              </div>
            )}

            {computerState?.workspaceLayout?.skillFiles?.length > 0 && (
              <div className="team-card-box">
                <div className="team-box-title">
                  <SkillMarkdownSvg size={14} />
                  <span>Saved repeatable tasks ({computerState.workspaceLayout.skillFiles.length})</span>
                </div>
                {skillNotice && (
                  <div style={{ fontSize: 10.5, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }} data-testid="skill-run-notice">
                    {skillNotice}
                  </div>
                )}
                {computerState.workspaceLayout.skillFiles.map(sk => (
                  <div key={sk.fileName} className="skill-md-item skill-file-card" data-testid="skill-file-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <strong style={{ fontSize: 12, color: 'var(--ink)' }}>{sk.title || sk.slug}</strong>
                        <span className="pill is-gold" style={{ fontSize: 9.5 }}>{sk.version || 'v1.0'}</span>
                      </div>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          data-testid={`run-skill-${sk.slug}`}
                          style={{ minHeight: 24, padding: '1px 7px', fontSize: 10.5 }}
                          disabled={busy}
                          onClick={() => handleRunSkill(sk.slug)}
                        >
                          Run Skill
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ minHeight: 24, padding: '1px 6px', fontSize: 10.5 }}
                          onClick={() => setExpandedSkill(prev => (prev === sk.fileName ? '' : sk.fileName))}
                        >
                          {expandedSkill === sk.fileName ? 'Hide' : 'Read .md'}
                        </button>
                      </div>
                    </div>
                    {Array.isArray(sk.steps) && sk.steps.length > 0 && (
                      <ol className="skill-steps-list">
                        {sk.steps.slice(0, 4).map((step, idx) => (
                          <li key={idx}>
                            <span>{step}</span>
                            <span className="skill-step-check" aria-hidden="true">✓</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {Array.isArray(sk.guardrails) && sk.guardrails.length > 0 && (
                      <div className="skill-guardrails-box">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: 10.5, color: 'var(--ok)' }}>
                          <ReversibleShieldSvg size={11} />
                          <span>Guardrails</span>
                        </div>
                        {sk.guardrails.slice(0, 3).map((g, gi) => (
                          <div key={gi} className="skill-guardrail-line">✓ {g}</div>
                        ))}
                      </div>
                    )}
                    {expandedSkill === sk.fileName && (
                      <pre className="tool-output-pre" style={{ marginTop: 6, maxHeight: 160 }}>{sk.content}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            <FileTree nodes={computerState?.files} onOpenFile={openWorkspaceFile} />
          </div>
        )}

        {subTab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {showDevTools && (
              <div className="card" style={{ padding: 10, gap: 6 }} data-testid="computer-receipts-ledger">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Run log &amp; verification
                  </span>
                  <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {receiptsLedger?.chain && (
                      <span className={`pill ${receiptsLedger.chain.valid ? 'is-emerald' : 'is-crimson'}`} style={{ fontSize: 10 }}>
                        {receiptsLedger.chain.valid
                          ? `Verified (${receiptsLedger.chain.count})`
                          : `Mismatch @ #${receiptsLedger.chain.brokenIndex}`}
                      </span>
                    )}
                    <button type="button" className="btn btn-sm" style={{ minHeight: 24, fontSize: 10.5 }} onClick={loadReceipts}>
                      Check
                    </button>
                    {receiptsLedger?.receipts?.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ minHeight: 24, fontSize: 10.5 }}
                        onClick={() => {
                          navigator.clipboard?.writeText(JSON.stringify(receiptsLedger, null, 2));
                          setCopiedLedger(true);
                          setTimeout(() => setCopiedLedger(false), 1500);
                        }}
                      >
                        {copiedLedger ? 'Copied' : 'Copy JSON'}
                      </button>
                    )}
                  </div>
                </div>
                {runsLedger.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--rule)', paddingTop: 6 }} data-testid="computer-runs-ledger">
                    {runsLedger.slice(0, 4).map(r => (
                      <div
                        key={r.id}
                        data-testid={`run-row-${r.id}`}
                        style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }}>
                          <code>{r.id.slice(0, 10)}</code> · {r.goal}
                        </span>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 'none' }}>
                          <span className={`pill ${r.status === 'COMPLETED' ? 'is-emerald' : r.status === 'WAITING_FOR_APPROVAL' ? 'is-gold' : r.status === 'FAILED' || r.status === 'CANCELLED' ? 'is-crimson' : ''}`} style={{ fontSize: 9.5 }}>
                            {r.status}
                          </span>
                          {r.status === 'WAITING_FOR_APPROVAL' && (
                            <>
                              <button type="button" className="btn btn-sm btn-primary" style={{ minHeight: 24, fontSize: 10 }} disabled={busy} onClick={() => handleRunAction(r.id, 'approve')}>
                                Approve
                              </button>
                              <button type="button" className="btn btn-sm" style={{ minHeight: 24, fontSize: 10 }} disabled={busy} onClick={() => handleRunAction(r.id, 'deny')}>
                                Deny
                              </button>
                            </>
                          )}
                          {(r.status === 'RUNNING' || r.status === 'WAITING_FOR_APPROVAL' || r.status === 'CLAIMED') && (
                            <button type="button" className="btn btn-sm" style={{ minHeight: 24, fontSize: 10 }} disabled={busy} onClick={() => handleRunAction(r.id, 'cancel')}>
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!(receiptsLedger?.receipts?.length) ? (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                    No logged runs yet.
                  </div>
                ) : (
                  receiptsLedger.receipts.slice(0, 6).map(rc => (
                    <div key={rc.id} style={{ fontSize: 11, borderTop: '1px solid var(--rule)', paddingTop: 5, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <code>{String(rc.eventHash || '').slice(0, 10)}</code> · {rc.summary || rc.verdict}
                      </span>
                      <span className={`pill ${rc.verdict === 'verified' ? 'is-emerald' : 'is-crimson'}`} style={{ fontSize: 9.5, flex: 'none' }}>
                        {rc.verdict}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
            {((b?.uploads?.length || 0) > 0 || (b?.downloads?.length || 0) > 0) && (
              <div className="card" style={{ padding: 10, gap: 6 }} data-testid="browser-transfers-ledger">
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--brass)' }}>
                  Sandbox Browser Transfers
                </div>
                {(b?.uploads || []).map((u, idx) => (
                  <div key={`up-${idx}`} style={{ fontSize: 11.5, fontFamily: 'var(--sand-mono)' }}>
                    UP · <code>{u.path}</code>
                  </div>
                ))}
                {(b?.downloads || []).map((d, idx) => (
                  <div key={`dl-${idx}`} style={{ fontSize: 11.5, fontFamily: 'var(--sand-mono)' }}>
                    DOWN · <code>{d.fileName || d.path}</code>
                  </div>
                ))}
              </div>
            )}
            {!(computerState?.activity?.length) ? (
              <div style={{ color: 'var(--ink-subtle)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MimirAsset category="ui" name="empty-realm" size={20} />
                <span>No tool runs recorded yet.</span>
              </div>
            ) : (
              computerState.activity.map(item => (
                <div key={item.id} className={`tool-card ${item.ok ? '' : 'is-error'}`}>
                  <div className="tool-card-head">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <MimirAsset
                        category="artifacts"
                        name={item.ok ? 'illuminated-rune' : 'cracked-runestone'}
                        size={15}
                      />
                      <span>{item.toolName}</span>
                    </span>
                    <span style={{ color: item.ok ? 'var(--ok)' : 'var(--err-ink, var(--err))' }}>
                      {item.ok ? 'OK' : 'FAILED'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{item.argsSummary}</div>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === 'memory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="memory-subtab">
            <input
              type="search"
              className="input"
              data-testid="memory-search-input"
              aria-label="Filter memories"
              placeholder="Search memories by key, text, or scope..."
              value={memFilter}
              onChange={e => setMemFilter(e.target.value)}
            />
            <SharedMemoryList filterQuery={memFilter} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <MimirAsset category="artifacts" name="well-of-wisdom" size={22} />
              <span style={{ fontSize: 11.5, color: 'var(--brass)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Notes for this helper
              </span>
            </div>
            <form onSubmit={saveMem} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input className="input" placeholder="Topic (e.g. preferred_repo)" value={memKey} onChange={e => setMemKey(e.target.value)} />
              <input className="input" placeholder="Note..." value={memVal} onChange={e => setMemVal(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm">
                Save note
              </button>
            </form>
            {screenErr && <div className="error-banner" role="alert">{screenErr}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredMemories.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  {(memories || []).length === 0 ? 'No helper notes saved yet.' : 'No helper notes match this filter.'}
                </div>
              ) : (
                filteredMemories.map(m => {
                  const isEditing = editingMemKey === m.key;
                  const provThread = m.provenance?.sourceThreadId;
                  const provUpdated = m.provenance?.updatedAt || m.updatedAt;
                  const provConfidence = m.provenance?.confidence;
                  return (
                    <div key={m.key} className="card" style={{ padding: 10, gap: 6 }} data-testid={`memory-card-${m.key}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                          <code style={{ fontSize: 12 }}>{m.key}</code>
                          <span className="pill" style={{ fontSize: 10 }}>{m.scope || 'bot'}</span>
                          {m.spaceId && <span className="pill is-cyan" style={{ fontSize: 10 }}>Space: {m.spaceId}</span>}
                          {m.pinned && <span className="pill is-gold" style={{ fontSize: 10 }}>Pinned</span>}
                        </div>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {!isEditing && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              data-testid={`memory-edit-btn-${m.key}`}
                              style={{ minHeight: 30, padding: '2px 8px', fontSize: 11 }}
                              onClick={() => startEditMem(m)}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-icon btn-sm"
                            aria-label={`Delete memory ${m.key}`}
                            style={{ minWidth: 32, minHeight: 32 }}
                            onClick={() => delMem(m.key)}
                          >
                            <CloseCrossSvg size={12} />
                          </button>
                        </div>
                      </div>
                      {isEditing ? (
                        <form onSubmit={saveEditedMem} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <textarea
                            className="textarea"
                            rows={2}
                            data-testid={`memory-edit-input-${m.key}`}
                            aria-label={`Edit value for ${m.key}`}
                            value={editMemVal}
                            onChange={e => setEditMemVal(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                              className="select"
                              aria-label="Memory scope"
                              value={editMemScope}
                              onChange={e => setEditMemScope(e.target.value)}
                              style={{ flex: '1 1 110px' }}
                            >
                              <option value="bot">Helper only</option>
                              <option value="space">Space</option>
                              <option value="global">Global</option>
                            </select>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                              <input
                                type="checkbox"
                                checked={editMemPinned}
                                onChange={e => setEditMemPinned(e.target.checked)}
                              />
                              Pinned
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-sm" onClick={() => setEditingMemKey('')}>
                              Cancel
                            </button>
                            <button type="submit" className="btn btn-primary btn-sm" data-testid={`memory-save-btn-${m.key}`} disabled={memBusy}>
                              {memBusy ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div style={{ fontSize: 12.5, wordBreak: 'break-word' }}>{m.value}</div>
                      )}
                      {(provThread || provUpdated || provConfidence != null) && (
                        <div style={{ fontSize: 10.5, color: 'var(--ink-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {provThread && <span>Source thread: <code>{String(provThread).slice(0, 12)}</code></span>}
                          {provConfidence != null && <span>Confidence: {Math.round(Number(provConfidence) * 100)}%</span>}
                          {provUpdated && <span>Updated: {new Date(provUpdated).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
