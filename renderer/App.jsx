import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  apiFetch,
  clearCoordinatorSession,
  getRuntimeEnvironment,
  playSoftCue,
  probeCoordinatorHealth,
  resolveCoordinator,
  subscribeEvents,
} from './api.js';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { ComputerPane } from './components/ComputerPane.jsx';
import { BotManagerModal } from './components/BotManagerModal.jsx';
import { AgentsView } from './components/AgentsView.jsx';
import { ForgeView } from './components/ForgeView.jsx';
import { RsiPipelineView } from './components/RsiPipelineView.jsx';
import { McpView } from './components/McpView.jsx';
import { VaultView } from './components/VaultView.jsx';
import { RoutinesView } from './components/RoutinesView.jsx';
import { SettingsView } from './components/SettingsView.jsx';
import { OverviewView } from './components/OverviewView.jsx';
import { LibraryView } from './components/LibraryView.jsx';
import { RealmProjectMapView } from './components/RealmProjectMapView.jsx';
import { BoardMeetingView } from './components/BoardMeetingView.jsx';
import { MimriStackView } from './components/MimriStackView.jsx';
import { VoiceLiveModal } from './components/VoiceLiveModal.jsx';
import { RuntimeConnectGate } from './components/RuntimeConnectGate.jsx';
import { FirstRunSetup } from './components/FirstRunSetup.jsx';
import { BotAvatar } from './components/BotAvatar.jsx';
import { deriveMimirAvatarState } from './components/MimirAvatarSvg.jsx';
import { MenuBarsSvg } from './components/Icons.jsx';

export function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = params.get('mode') || 'main';
  const initialBotParam = params.get('botId') || null;

  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [bots, setBots] = useState([]);
  const [agentStatuses, setAgentStatuses] = useState([]);
  const [activeBotId, setActiveBotId] = useState(initialBotParam || 'bot-grok-default');
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [showComputer, setShowComputer] = useState(
    mode === 'main' && (typeof window === 'undefined' || window.innerWidth >= 1120)
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [computerState, setComputerState] = useState(null);
  const [memories, setMemories] = useState([]);
  const [mcps, setMcps] = useState([]);
  const [vaultEntries, setVaultEntries] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [streaming, setStreaming] = useState({ content: '', thinking: '' });
  const [runningThreadId, setRunningThreadId] = useState(null);
  const [botModal, setBotModal] = useState(null);
  const [teachMode, setTeachMode] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState([]);
  const [spotlightText, setSpotlightText] = useState('');
  const [spotlightResult, setSpotlightResult] = useState('');
  const [spotlightBusy, setSpotlightBusy] = useState(false);
  const [killNotice, setKillNotice] = useState('');
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [councilSteps, setCouncilSteps] = useState([]);
  const [swarmSteps, setSwarmSteps] = useState([]);
  const [teamOverview, setTeamOverview] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState('');
  const [activeSurface, setActiveSurface] = useState('chat');
  const [sentinelBlocked, setSentinelBlocked] = useState(false);
  const [voicePhase, setVoicePhase] = useState('idle');
  const [lastRunFailed, setLastRunFailed] = useState(false);
  const [runtimeState, setRuntimeState] = useState({
    status: 'checking',
    url: 'http://127.0.0.1:4567',
    message: '',
    health: null,
  });

  const activeThreadRef = useRef(activeThreadId);
  const activeBotRef = useRef(activeBotId);
  const teachRef = useRef(teachMode);
  const settingsRef = useRef(settings);
  const skipAutoThreadSelectRef = useRef(false);
  activeThreadRef.current = activeThreadId;
  activeBotRef.current = activeBotId;
  teachRef.current = teachMode;
  settingsRef.current = settings;

  const refreshAll = useCallback(async () => {
    const [m, s, bList, aStatuses, mcpList, vList, rtnList, recList, aprList, spacesOut] = await Promise.all([
      apiFetch('/v1/meta'),
      apiFetch('/v1/settings'),
      apiFetch('/v1/bots'),
      apiFetch('/v1/agents/status').catch(() => []),
      apiFetch('/v1/mcps'),
      apiFetch('/v1/vault'),
      apiFetch('/v1/routines'),
      apiFetch('/v1/recordings'),
      apiFetch('/v1/approvals'),
      apiFetch('/v1/spaces').catch(() => ({ spaces: [] })),
    ]);
    setMeta(m);
    setSettings(s);
    setBots(bList);
    setAgentStatuses(aStatuses);
    setMcps(mcpList);
    setVaultEntries(vList);
    setRoutines(rtnList);
    setRecordings(recList);
    setPendingApprovals(aprList);
    setSpaces(spacesOut?.spaces || []);
    document.documentElement.setAttribute('data-theme', s.themePreference || 'dark');
    document.documentElement.setAttribute('data-reduced-motion', s.reducedMotion ? 'true' : 'false');
  }, []);

  const probeModels = useCallback(async () => {
    try {
      setModelStatus(await apiFetch('/v1/models'));
    } catch {}
  }, []);

  const refreshBotContext = useCallback(async botId => {
    if (!botId) return;
    const [tList, comp, mems, ov] = await Promise.all([
      apiFetch(`/v1/threads?botId=${encodeURIComponent(botId)}`),
      apiFetch(`/v1/computer/${encodeURIComponent(botId)}/state`),
      apiFetch(`/v1/bots/${encodeURIComponent(botId)}/memories`),
      apiFetch(`/v1/team/overview?botId=${encodeURIComponent(botId)}`).catch(() => null),
    ]);
    setThreads(tList);
    setComputerState(comp);
    setMemories(mems);
    if (ov) setTeamOverview(ov);
    if (skipAutoThreadSelectRef.current) {
      skipAutoThreadSelectRef.current = false;
      return;
    }
    if (!activeThreadRef.current || !tList.some(t => t.id === activeThreadRef.current)) {
      const nextId = tList[0]?.id || null;
      setActiveThreadId(nextId);
      setActiveThread(nextId ? await apiFetch(`/v1/threads/${encodeURIComponent(nextId)}`) : null);
    }
  }, []);

  const loadThread = useCallback(async threadId => {
    setActiveThreadId(threadId);
    if (!threadId) {
      setActiveThread(null);
      return;
    }
    setActiveThread(await apiFetch(`/v1/threads/${encodeURIComponent(threadId)}`));
  }, []);

  const connectAndRefresh = useCallback(async () => {
    const cfg = await resolveCoordinator();
    const env = getRuntimeEnvironment();
    if (env.isPublicWeb && !cfg.token && !env.hasStoredSession) {
      const health = await probeCoordinatorHealth(cfg.url);
      if (!health.reachable) {
        setRuntimeState({
          status: 'disconnected',
          url: cfg.url,
          health,
          message: health.error || 'No local Mimir coordinator detected on 127.0.0.1:4567.',
        });
        return;
      }
      setRuntimeState({
        status: 'pairing_required',
        url: cfg.url,
        health,
        message: health.authRequired
          ? 'Local coordinator detected. Request a one-time pairing code to link this browser.'
          : 'Local coordinator detected on 127.0.0.1. Confirm explicit connection to continue.',
      });
      return;
    }

    try {
      await refreshAll();
      setRuntimeState({ status: 'connected', url: cfg.url, message: '', health: null });
      probeModels();
    } catch (err) {
      const msg = String(err?.message || '');
      const health = await probeCoordinatorHealth(cfg.url);
      if (!health.reachable) {
        setRuntimeState({
          status: 'disconnected',
          url: cfg.url,
          health,
          message: health.error || msg || 'Local coordinator unreachable.',
        });
        return;
      }
      if (/expired|revoked|401/i.test(msg)) {
        clearCoordinatorSession();
        const isExpired = /expired|revoked/i.test(msg);
        setRuntimeState({
          status: isExpired ? 'session_expired' : 'pairing_required',
          url: cfg.url,
          health,
          message: msg || 'Pairing required to access local Mimir coordinator.',
        });
        return;
      }
      setRuntimeState({
        status: health.authRequired ? 'pairing_required' : 'disconnected',
        url: cfg.url,
        health,
        message: msg,
      });
    }
  }, [refreshAll, probeModels]);

  useEffect(() => {
    connectAndRefresh();
  }, [connectAndRefresh]);

  useEffect(() => {
    const onAuthRequired = evt => {
      const detail = evt?.detail || {};
      const expired = detail.code === 'SESSION_EXPIRED' || /expired|revoked/i.test(String(detail.error || ''));
      setRuntimeState(prev => ({
        status: expired ? 'session_expired' : 'pairing_required',
        url: prev.url || 'http://127.0.0.1:4567',
        health: { reachable: true, authRequired: true },
        message: detail.error || 'Authorization required. Pair this browser session with local Mimir.',
      }));
    };
    window.addEventListener('mimir:auth-required', onAuthRequired);
    return () => window.removeEventListener('mimir:auth-required', onAuthRequired);
  }, []);

  useEffect(() => {
    if (mode !== 'main') return;
    let wasDesktop = window.innerWidth >= 1120;
    const onResize = () => {
      const isDesktop = window.innerWidth >= 1120;
      if (wasDesktop && !isDesktop) setShowComputer(false);
      wasDesktop = isDesktop;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode]);

  useEffect(() => {
    if (runtimeState.status !== 'connected') return;
    refreshBotContext(activeBotId).catch(() => {});
  }, [activeBotId, refreshBotContext, runtimeState.status]);

  useEffect(() => {
    if (runtimeState.status !== 'connected') return undefined;
    const unsub = subscribeEvents(async msg => {
      const { event, data } = msg;
      if (event === 'agent:delta') {
        if (data.threadId === activeThreadRef.current) {
          setStreaming(prev => ({
            content: data.kind === 'content' ? prev.content + data.delta : prev.content,
            thinking: data.kind === 'thinking' ? prev.thinking + data.delta : prev.thinking,
          }));
        }
      } else if (event === 'thread:updated') {
        const list = await apiFetch(`/v1/threads?botId=${encodeURIComponent(activeBotRef.current)}`);
        setThreads(list);
        if (data.threadId === activeThreadRef.current) {
          setActiveThread(await apiFetch(`/v1/threads/${encodeURIComponent(data.threadId)}`));
        }
      } else if (event === 'receipt:created') {
        if (data?.threadId && data.threadId === activeThreadRef.current) {
          apiFetch(`/v1/threads/${encodeURIComponent(data.threadId)}`)
            .then(setActiveThread)
            .catch(() => {});
        }
      } else if (event === 'agents:status') {
        setAgentStatuses(await apiFetch('/v1/agents/status').catch(() => []));
        setTeamOverview(await apiFetch(`/v1/team/overview?botId=${encodeURIComponent(activeBotRef.current)}`).catch(() => null));
      } else if (event === 'bots:updated') {
        if (Array.isArray(data)) setBots(data);
      } else if (event === 'approval:requested') {
        setPendingApprovals(prev => [...prev.filter(x => x.id !== data.id), data]);
        if (settingsRef.current?.soundEffects !== false) playSoftCue('alert');
      } else if (event === 'approval:resolved') {
        setPendingApprovals(prev => prev.filter(x => x.id !== data.id));
      } else if (event === 'tool:result') {
        if (teachRef.current && data.approved) {
          const thr = await apiFetch(`/v1/threads/${encodeURIComponent(data.threadId)}`);
          const lastToolMsg = [...(thr?.messages || [])].reverse().find(m => m.role === 'tool' && m.toolName === data.toolName);
          if (lastToolMsg) {
            setRecordedSteps(prev => [...prev, { toolName: lastToolMsg.toolName, args: lastToolMsg.toolArgs || {} }]);
          }
        }
        if (data.botId === activeBotRef.current) {
          setComputerState(await apiFetch(`/v1/computer/${encodeURIComponent(data.botId)}/state`));
          setMemories(await apiFetch(`/v1/bots/${encodeURIComponent(data.botId)}/memories`));
        }
        if (data.toolName === 'bot_spawn' && data.approved) {
          setBots(await apiFetch('/v1/bots').catch(() => []));
        }
      } else if (event === 'computer:screenshot') {
        if (data.botId === activeBotRef.current) {
          setComputerState(prev => (prev ? { ...prev, browser: data } : prev));
        }
      } else if (event === 'browser:cursor') {
        if (data.botId === activeBotRef.current) {
          setComputerState(prev => (prev ? {
            ...prev,
            browser: {
              ...(prev.browser || {}),
              agentCursor: data.cursor,
              ...(data.controlMode ? { controlMode: data.controlMode, userControlActive: Boolean(data.userControlActive) } : {}),
            },
          } : prev));
        }
      } else if (event === 'browser:control') {
        if (data.botId === activeBotRef.current) {
          setComputerState(prev => (prev ? {
            ...prev,
            browser: {
              ...(prev.browser || {}),
              controlMode: data.controlMode,
              userControlActive: Boolean(data.userControlActive),
              browserState: data.browserState || prev.browser?.browserState,
              agentCursor: data.agentCursor ?? prev.browser?.agentCursor,
            },
          } : prev));
        }
      } else if (event === 'agent:done' || event === 'agent:error') {
        setRunningThreadId(prev => (!data.threadId || prev === data.threadId) ? null : prev);
        setLastRunFailed(event === 'agent:error');
        if (!data.threadId || data.threadId === activeThreadRef.current) {
          setStreaming({ content: '', thinking: '' });
          setSwarmSteps([]);
          if (event === 'agent:done' && settingsRef.current?.soundEffects !== false) playSoftCue('done');
        }
      } else if (event === 'spaces:updated') {
        if (Array.isArray(data)) setSpaces(data);
      } else if (event === 'sentinel:blocked') {
        setSentinelBlocked(true);
      } else if (event === 'routine:updated') {
        setRoutines(await apiFetch('/v1/routines'));
      } else if (event === 'browser:challenge' || event === 'browser:download') {
        if (data.botId === activeBotRef.current) {
          setComputerState(await apiFetch(`/v1/computer/${encodeURIComponent(data.botId)}/state`));
        }
      } else if (event === 'kill-switch' || event === 'kill-switch:activated') {
        setRunningThreadId(null);
        setStreaming({ content: '', thinking: '' });
        setSwarmSteps([]);
        setKillNotice(`Stopped all running tasks (${data.runsKilled || 0} stopped)`);
        setComputerState(await apiFetch(`/v1/computer/${encodeURIComponent(activeBotRef.current)}/state`));
      } else if (event === 'council:step') {
        setCouncilSteps(prev => [...prev.slice(-99), { ...data, receivedAt: Date.now() }]);
      } else if (event === 'swarm:step') {
        if (Array.isArray(data?.timeline)) {
          setSwarmSteps(data.timeline);
        } else {
          const nextStep = data?.step || {
            id: data?.nodeId || data?.id || `sw-${Date.now()}`,
            icon: data?.icon || 'subagent',
            label: data?.label || `${data?.role || data?.nodeId || 'Subagent'}: ${data?.status || 'running'}`,
            detail: data?.detail || '',
            status: data?.status || 'running',
          };
          setSwarmSteps(prev => {
            const idx = prev.findIndex(s => s.id === nextStep.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...nextStep };
              return copy;
            }
            return [...prev, nextStep];
          });
        }
      }
    });
    return unsub;
  }, [runtimeState.status]);

  // Prevent browser/Electron tab navigation if files are dropped outside an active drop zone
  useEffect(() => {
    const onDragOver = e => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
    };
    const onDrop = e => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleNewThread = async (targetBotId = activeBotId) => {
    const t = await apiFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ botId: targetBotId, title: 'New Chat' }),
    });
    setActiveTab('chat');
    setThreads(prev => [t, ...prev]);
    setActiveThreadId(t.id);
    setActiveThread(t);
  };

  const handleDeployChiefTeam = async () => {
    const res = await apiFetch('/v1/team/deploy-preset', {
      method: 'POST',
      body: JSON.stringify({ activateThread: true }),
    });
    await refreshAll();
    if (res?.overview) setTeamOverview(res.overview);
    if (res?.chief?.id) {
      skipAutoThreadSelectRef.current = Boolean(res.teamThreadId);
      setActiveBotId(res.chief.id);
      if (res.teamThreadId) {
        setActiveThreadId(res.teamThreadId);
        setActiveThread(await apiFetch(`/v1/threads/${encodeURIComponent(res.teamThreadId)}`).catch(() => null));
      }
      setActiveTab('chat');
      if (typeof window === 'undefined' || window.innerWidth >= 1120) {
        setShowComputer(true);
      }
    }
    return res;
  };

  const handleActivateGrokBot = async () => {
    const res = await apiFetch('/v1/workspace/import-grokbot', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await refreshAll();
    const chiefId = res?.deployedTeam?.chief?.id || res?.botId || 'bot-chief-klaus';
    const growthThreadId = res?.playbook?.threadId || res?.deployedTeam?.teamThreadId || null;
    if (res?.overview) setTeamOverview(res.overview);
    skipAutoThreadSelectRef.current = Boolean(growthThreadId);
    setActiveBotId(chiefId);
    if (growthThreadId) {
      setActiveThreadId(growthThreadId);
      setActiveThread(await apiFetch(`/v1/threads/${encodeURIComponent(growthThreadId)}`).catch(() => null));
    }
    await refreshBotContext(chiefId);
    if (typeof window === 'undefined' || window.innerWidth >= 1120) {
      setShowComputer(true);
    }
    return res;
  };

  // Explicit clean bot switch -> always starts a fresh empty session for that agent!
  const handleSelectBotFresh = async botId => {
    skipAutoThreadSelectRef.current = true;
    setSwarmSteps([]);
    const t = await apiFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ botId, title: 'New Chat' }),
    });
    setActiveBotId(botId);
    setActiveThreadId(t.id);
    setActiveThread(t);
    setActiveTab('chat');
  };

  // Explicit resume existing latest session from Agents Roster
  const handleResumeBotLatest = botId => {
    skipAutoThreadSelectRef.current = false;
    setActiveBotId(botId);
    setActiveThreadId(null);
    setActiveThread(null);
    setActiveTab('chat');
  };

  const handleDeleteThread = async id => {
    await apiFetch(`/v1/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const next = threads.filter(t => t.id !== id);
    setThreads(next);
    if (activeThreadId === id) {
      const nextId = next[0]?.id || null;
      await loadThread(nextId);
    }
  };

  const handleSendMessage = async (text, attachments = []) => {
    let tid = activeThreadId;
    if (!tid) {
      const created = await apiFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ botId: activeBotId, title: 'New Chat' }),
      });
      tid = created.id;
      setThreads(prev => [created, ...prev]);
      setActiveThreadId(tid);
      setActiveThread(created);
    }
    setStreaming({ content: '', thinking: '' });
    setSwarmSteps([]);
    setLastRunFailed(false);
    setSentinelBlocked(false);
    setRunningThreadId(tid);
    await apiFetch('/v1/agent/run', {
      method: 'POST',
      body: JSON.stringify({
        threadId: tid,
        botId: activeBotId,
        userText: text,
        attachments,
        async: true,
      }),
    });
  };

  const handleAbort = async () => {
    if (!activeThreadId) return;
    await apiFetch('/v1/agent/abort', {
      method: 'POST',
      body: JSON.stringify({ threadId: activeThreadId }),
    });
    setRunningThreadId(null);
  };

  const handleKillSwitch = async () => {
    const out = await apiFetch('/v1/kill-switch', { method: 'POST', body: '{}' });
    setRunningThreadId(null);
    setStreaming({ content: '', thinking: '' });
    setKillNotice(`Stopped ${out.runsKilled || 0} running task(s)`);
    await refreshBotContext(activeBotId);
  };

  const handleRunOverviewPrompt = async prompt => {
    setActiveTab('chat');
    await handleSendMessage(prompt);
  };

  const handleSwitchMode = async nextMode => {
    if (!activeBotId) return;
    const updated = await apiFetch(`/v1/bots/${encodeURIComponent(activeBotId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ executionMode: nextMode }),
    });
    setBots(prev => prev.map(b => (b.id === updated.id ? updated : b)));
  };

  const handleResolveApproval = async (approvalId, decision) => {
    await apiFetch(`/v1/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    setPendingApprovals(prev => prev.filter(x => x.id !== approvalId));
  };

  const handleStageFiles = async files => {
    const out = [];
    for (const f of files) {
      out.push(
        await apiFetch(`/v1/computer/${encodeURIComponent(activeBotId)}/stage-file`, {
          method: 'POST',
          body: JSON.stringify(f),
        })
      );
    }
    setComputerState(await apiFetch(`/v1/computer/${encodeURIComponent(activeBotId)}/state`));
    return out;
  };

  const handleSaveRecording = async name => {
    await apiFetch('/v1/recordings', {
      method: 'POST',
      body: JSON.stringify({ name, botId: activeBotId, steps: recordedSteps }),
    });
    setTeachMode(false);
    setRecordedSteps([]);
    setRecordings(await apiFetch('/v1/recordings'));
    setActiveTab('routines');
  };

  const handleBotForged = async (newBotId, startedThreadId) => {
    await refreshAll();
    skipAutoThreadSelectRef.current = Boolean(startedThreadId);
    setActiveBotId(newBotId);
    setActiveTab('chat');
    if (startedThreadId) {
      setRunningThreadId(startedThreadId);
      setActiveThreadId(startedThreadId);
      setActiveThread(await apiFetch(`/v1/threads/${encodeURIComponent(startedThreadId)}`));
    } else {
      setActiveThreadId(null);
    }
    await refreshBotContext(newBotId);
  };

  const activeBot = bots.find(b => b.id === activeBotId) || bots[0];
  const backendOnline = modelStatus ? Boolean(modelStatus?.ollama?.ok || modelStatus?.openai?.ok || navigator.onLine) : true;
  const isCurrentThreadRunning = runningThreadId !== null && runningThreadId === activeThreadId;
  const mimirAvatarState = deriveMimirAvatarState({
    online: backendOnline,
    blocked: sentinelBlocked,
    failed: lastRunFailed,
    waitingApproval: pendingApprovals.length > 0,
    speaking: voicePhase === 'speaking',
    listening: voicePhase === 'listening',
    thinking: voicePhase === 'thinking' || (isCurrentThreadRunning && Boolean(streaming?.thinking)),
    working: isCurrentThreadRunning,
    completed: Boolean(activeThread?.messages?.some(m => m.role === 'assistant')),
  });

  const handleCreateSpace = async payload => {
    const out = await apiFetch('/v1/spaces', { method: 'POST', body: JSON.stringify(payload) });
    if (out?.space) setSpaces(prev => [...prev, out.space]);
  };

  const handleDeleteSpace = async id => {
    await apiFetch(`/v1/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setSpaces(prev => prev.filter(s => s.id !== id));
    if (activeSpaceId === id) setActiveSpaceId('');
  };

  const handleSelectSpace = space => {
    setActiveSpaceId(space.id);
    setActiveSurface(space.surface || 'chat');
    if (space.surface === 'memory') setActiveTab('map');
    else if (space.surface === 'automation') setActiveTab('routines');
    else if (space.surface === 'voice') setLiveVoiceOpen(true);
    else setActiveTab('chat');
  };

  const handleUiAction = async ({ actionId, payload, surface, roleId }) => {
    const out = await apiFetch('/v1/ui/action', {
      method: 'POST',
      body: JSON.stringify({ actionId, payload, surface, roleId }),
    });
    if (out?.ok && actionId === 'open_surface' && payload?.tab) {
      setActiveTab(payload.tab);
    } else if (out?.ok && actionId === 'approve_request' && payload?.approvalId) {
      await handleResolveApproval(payload.approvalId, 'approve');
    } else if (out?.ok && actionId === 'deny_request' && payload?.approvalId) {
      await handleResolveApproval(payload.approvalId, 'deny');
    } else if (out?.ok && actionId === 'pin_space' && out?.result?.space) {
      setSpaces(prev => [...prev, out.result.space]);
    }
    return out;
  };

  const handleUnpairSession = async () => {
    try {
      await apiFetch('/v1/pairing/revoke', { method: 'POST', body: '{}' });
    } catch {}
    clearCoordinatorSession();
    setRuntimeState(prev => ({
      status: 'pairing_required',
      url: prev.url || 'http://127.0.0.1:4567',
      health: { reachable: true, authRequired: true },
      message: 'Session disconnected. Pair again when ready.',
    }));
  };

  if (runtimeState.status !== 'connected') {
    return (
      <RuntimeConnectGate
        status={runtimeState.status}
        url={runtimeState.url}
        message={runtimeState.message}
        health={runtimeState.health}
        onConnected={connectAndRefresh}
        onStatusChange={next => setRuntimeState(prev => ({ ...prev, ...next }))}
      />
    );
  }

  // First launch: until a model is set up (or the user skips), show device check + model install.
  if (mode !== 'spotlight' && mode !== 'popout' && settings && !settings.modelSetupDone && !settings.firstRunDismissed) {
    return (
      <FirstRunSetup
        settings={settings}
        onDone={async next => {
          setSettings(next);
          await refreshAll();
          await probeModels();
        }}
        onUseCloud={async () => {
          const next = await apiFetch('/v1/settings', { method: 'PATCH', body: JSON.stringify({ firstRunDismissed: true }) });
          setSettings(next);
          setActiveTab('settings');
        }}
      />
    );
  }

  if (mode === 'spotlight') {
    const runSpotlight = async e => {
      e.preventDefault();
      if (!spotlightText.trim() || spotlightBusy) return;
      setSpotlightBusy(true);
      setSpotlightResult('');
      try {
        const res = await apiFetch('/v1/agent/run', {
          method: 'POST',
          body: JSON.stringify({ botId: activeBotId, userText: spotlightText.trim(), title: 'Quick ask' }),
        });
        setSpotlightResult(res.reply || '(Completed)');
      } catch (err) {
        setSpotlightResult(`Error: ${err.message}`);
      } finally {
        setSpotlightBusy(false);
      }
    };

    return (
      <div className="spotlight-shell">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--brass)' }}>
            <BotAvatar
              bot={activeBot}
              shape={activeBot?.shape || 'mimir'}
              color={activeBot?.color}
              size={24}
              state={runningThreadId !== null && runningThreadId === activeThreadId ? 'running' : 'idle'}
            />
            Quick ask — {activeBot?.name || 'Mimir'}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => window.desktop?.hideCurrentWindow()}>
            Esc
          </button>
        </div>
        <form onSubmit={runSpotlight} style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            className="input"
            placeholder="Ask Mimir anything..."
            value={spotlightText}
            onChange={e => setSpotlightText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={spotlightBusy}>
            {spotlightBusy ? '...' : 'Run'}
          </button>
        </form>
        <div className="code-block" style={{ flex: 1, overflowY: 'auto' }}>
          {spotlightResult || 'Type a prompt and press Enter. Press Esc or click outside to hide.'}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${mode === 'popout' ? 'popout' : ''}`}>
      {mode !== 'popout' && mobileNavOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {mode !== 'popout' && (
        <Sidebar
          bots={bots}
          activeBotId={activeBotId}
          agentStatuses={agentStatuses}
          onSelectBotFresh={handleSelectBotFresh}
          onNewBot={() => setBotModal({})}
          onEditBot={bot => setBotModal(bot)}
          onDeployChiefTeam={handleDeployChiefTeam}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={loadThread}
          onNewThread={() => handleNewThread(activeBotId)}
          onDeleteThread={handleDeleteThread}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          modelStatus={modelStatus}
          onOpenSpotlight={() => window.desktop?.openSpotlight()}
          onOpenPopout={id => window.desktop?.openPopout(id)}
          isMobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
          mimirAvatarState={mimirAvatarState}
          staticAvatar={Boolean(settings?.staticAvatar || settings?.reducedMotion)}
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          onSelectSpace={handleSelectSpace}
          onCreateSpace={handleCreateSpace}
          onDeleteSpace={handleDeleteSpace}
          showDeveloperTools={Boolean(settings?.showDeveloperTools)}
        />
      )}

      <main className="main-pane">
        <header className="topbar">
          <div className="topbar-left">
            {mode !== 'popout' && (
              <button
                type="button"
                className="btn btn-icon btn-sm mobile-menu-btn"
                aria-label="Open navigation menu"
                aria-expanded={mobileNavOpen}
                aria-controls="mimir-sidebar"
                onClick={() => setMobileNavOpen(v => !v)}
              >
                <MenuBarsSvg size={15} />
              </button>
            )}
            <BotAvatar
              bot={activeBot}
              shape={activeBot?.shape || 'mimir'}
              color={activeBot?.color}
              size={24}
              state={runningThreadId !== null && runningThreadId === activeThreadId ? 'running' : 'idle'}
            />
            <strong className="topbar-bot-name">
              {activeBot?.name || 'Mimir'}
            </strong>
            <span className="topbar-model-chip" title="The AI model answering in this chat">
              <span className="topbar-provider-prefix">{settings?.provider === 'openai-compat' ? 'Cloud ·' : 'On this computer ·'}</span>
              {activeBot?.modelOverride ||
                (settings?.provider === 'openai-compat'
                  ? settings?.openaiModel || 'gpt-4o-mini'
                  : settings?.ollamaModel || 'qwen3:1.7b')}
            </span>
          </div>
          <div className="topbar-right">
            {getRuntimeEnvironment().hasStoredSession && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="unpair-runtime-btn"
                title="Disconnect this browser from Mimir"
                onClick={handleUnpairSession}
              >
                Disconnect
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm kill-switch-btn"
              data-testid="kill-switch-btn"
              title="Stop every running task right now and close any web pages Mimir opened"
              onClick={handleKillSwitch}
            >
              <span>Stop</span>
              <span className="kill-label">everything</span>
            </button>
            {mode !== 'popout' && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="toggle-preview-btn"
              title="See the screen, web pages and files Mimir is working on"
              onClick={() => setShowComputer(v => !v)}
            >
              <img
                src={`./assets/mimir/ui/${showComputer ? 'hide-preview' : 'screen'}.svg`}
                width={14}
                height={14}
                alt=""
                aria-hidden="true"
                className="pixel-sprite"
                style={{ width: 14, height: 14, imageRendering: 'pixelated' }}
              />
              {showComputer ? 'Hide work' : 'Show work'}
            </button>
            )}
          </div>
        </header>

        {killNotice && (
          <div className="kill-notice-bar" data-testid="kill-notice-pill" role="status">
            <span>{killNotice}</span>
            <button type="button" className="btn btn-sm" onClick={() => setKillNotice('')}>Dismiss</button>
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewView
            activeBot={activeBot}
            bots={bots}
            modelStatus={modelStatus}
            onNavigate={setActiveTab}
            onRunPrompt={handleRunOverviewPrompt}
            onOpenLiveVoice={() => setLiveVoiceOpen(true)}
            onDeployChiefTeam={handleDeployChiefTeam}
            onActivateGrokBot={handleActivateGrokBot}
          />
        )}

        {activeTab === 'council' && (
          <BoardMeetingView
            activeBot={activeBot}
            activeThreadId={activeThreadId}
            councilSteps={councilSteps}
            onDispatchToChat={handleRunOverviewPrompt}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'mimri' && <MimriStackView />}

        {activeTab === 'library' && (
          <LibraryView activeBotId={activeBotId} />
        )}

        {activeTab === 'map' && (
          <RealmProjectMapView
            onNavigate={setActiveTab}
            onSelectBot={botId => {
              skipAutoThreadSelectRef.current = false;
              setActiveBotId(botId);
            }}
          />
        )}

        {activeTab === 'chat' && (
          <ChatView
            bot={activeBot}
            teamBots={bots}
            thread={activeThread}
            streaming={streaming}
            isRunning={runningThreadId !== null && runningThreadId === activeThreadId}
            swarmSteps={swarmSteps}
            pendingApprovals={pendingApprovals.filter(a => !activeThreadId || a.threadId === activeThreadId || a.rootThreadId === activeThreadId)}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            onResolveApproval={handleResolveApproval}
            onStageFiles={handleStageFiles}
            onSwitchMode={handleSwitchMode}
            onOpenLiveVoice={() => setLiveVoiceOpen(true)}
            teachMode={teachMode}
            recordedSteps={recordedSteps}
            onToggleTeachMode={() => {
              setTeachMode(v => !v);
              setRecordedSteps([]);
            }}
            onSaveRecording={handleSaveRecording}
            onNavigateTab={setActiveTab}
            activeSurface={activeSurface}
            onSelectSurface={setActiveSurface}
            mimirAvatarState={mimirAvatarState}
            staticAvatar={Boolean(settings?.staticAvatar || settings?.reducedMotion)}
            onUiAction={handleUiAction}
          />
        )}

        {activeTab === 'agents' && (
          <AgentsView
            bots={bots}
            activeBotId={activeBotId}
            agentStatuses={agentStatuses}
            onStartNewSession={handleSelectBotFresh}
            onResumeBot={handleResumeBotLatest}
            onEditBot={bot => setBotModal(bot)}
            onNewBot={() => setBotModal({})}
            onOpenForge={() => setActiveTab('forge')}
          />
        )}

        {activeTab === 'forge' && <ForgeView onBotForged={handleBotForged} />}

        {activeTab === 'rsi' && (
          <RsiPipelineView
            activeBotId={activeBotId}
            settings={settings}
            modelStatus={modelStatus}
            onSettingsSaved={next => setSettings(next)}
            onProbeModels={probeModels}
          />
        )}

        {activeTab === 'mcp' && (
          <McpView
            mcps={mcps}
            onRefresh={async () => setMcps(await apiFetch('/v1/mcps'))}
          />
        )}

        {activeTab === 'vault' && (
          <VaultView
            entries={vaultEntries}
            onRefresh={async () => setVaultEntries(await apiFetch('/v1/vault'))}
          />
        )}

        {activeTab === 'routines' && (
          <RoutinesView
            routines={routines}
            recordings={recordings}
            bots={bots}
            onRefresh={async () => {
              const [r, rec] = await Promise.all([apiFetch('/v1/routines'), apiFetch('/v1/recordings')]);
              setRoutines(r);
              setRecordings(rec);
            }}
            onOpenThread={async tid => {
              setActiveTab('chat');
              await loadThread(tid);
            }}
          />
        )}

        {activeTab === 'settings' && settings && (
          <SettingsView
            settings={settings}
            modelStatus={modelStatus}
            onSaved={next => {
              setSettings(next);
              document.documentElement.setAttribute('data-theme', next.themePreference || 'dark');
              document.documentElement.setAttribute('data-reduced-motion', next.reducedMotion ? 'true' : 'false');
            }}
            onProbeModels={probeModels}
          />
        )}
      </main>

      {mode !== 'popout' && showComputer && (
        <ComputerPane
          botId={activeBotId}
          computerState={computerState}
          memories={memories}
          settings={settings}
          teamOverview={teamOverview}
          onDeployChiefTeam={handleDeployChiefTeam}
          onSelectBot={id => handleSelectBotFresh(id)}
          onSettingsChange={next => setSettings(next)}
          onRefresh={() => refreshBotContext(activeBotId)}
          onClose={() => setShowComputer(false)}
        />
      )}

      {botModal !== null && (
        <BotManagerModal
          initialBot={botModal}
          mcps={mcps}
          meta={meta}
          onClose={() => setBotModal(null)}
          onSaved={async () => {
            setBotModal(null);
            await refreshAll();
            await refreshBotContext(activeBotId);
          }}
          onDeleted={async delId => {
            setBotModal(null);
            await refreshAll();
            if (activeBotId === delId) setActiveBotId('bot-grok-default');
          }}
        />
      )}

      <VoiceLiveModal
        isOpen={liveVoiceOpen}
        onClose={() => {
          setVoicePhase('idle');
          setLiveVoiceOpen(false);
        }}
        activeBot={activeBot}
        activeThreadId={activeThreadId}
        onStageFiles={handleStageFiles}
        onPhaseChange={setVoicePhase}
        onThreadUpdated={async tid => {
          const targetId = tid || activeThreadRef.current;
          if (targetId) {
            await loadThread(targetId);
          }
          const list = await apiFetch(`/v1/threads?botId=${encodeURIComponent(activeBotRef.current)}`);
          setThreads(list);
        }}
        settings={settings}
      />
    </div>
  );
}
