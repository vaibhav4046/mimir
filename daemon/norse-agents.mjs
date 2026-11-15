import { validateContract } from './contracts.mjs';

export const NORSE_AGENT_REGISTRY = Object.freeze([
  {
    id: 'mimir',
    name: 'Mimir',
    norseArchetype: 'Sage',
    roleTitle: 'Central Orchestrator & Interface Planner',
    priorityE2E: true,
    avatarArchetype: 'mimir-head',
    accentColor: '#44c8f5',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Classify user intent, plan surface + steps, delegate bounded work to Norse specialists, synthesize verified answers and receipts.',
    allowedTools: ['memory_recall', 'memory_save', 'subagent_loop', 'fs_read', 'fs_list'],
    deniedTools: ['vault_raw_export', 'system_shutdown', 'destructive_wipe'],
    permissionBoundaries: {
      maxRiskTier: 'approval',
      networkScope: 'none-direct',
      secretAccess: false,
      approvalRequiredFor: ['spawn_subbot_escalation'],
    },
    memoryScope: 'shared:user-default',
    workspaceScope: 'read-only-summary',
    inputContract: 'Task (prompt, mode, attachments)',
    outputContract: 'UISpecification + EvidenceReceipt + optional AgentHandoff',
    budgets: { maxSteps: 8, maxTokens: 4096, maxRuntimeMs: 120000, maxRetries: 1 },
    verificationConditions: ['All factual claims cite observed tool output or local workspace artifacts'],
    handoffTargets: ['scout', 'forge-master', 'artificer', 'guardian', 'archivist', 'creator', 'restorer', 'diplomat', 'operator'],
  },
  {
    id: 'scout',
    name: 'Scout',
    norseArchetype: 'Atreus-inspired Hunter & Pathfinder',
    roleTitle: 'Web Research, Live Browser & Evidence Gathering',
    priorityE2E: true,
    avatarArchetype: 'young-archer',
    accentColor: '#38bdf8',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Navigate pages via Playwright, search web indexes when online, inspect DOM, extract structured citations, save grounded research notes.',
    allowedTools: ['web_search', 'web_fetch', 'browser_open', 'browser_action', 'browser_screenshot', 'fs_write', 'fs_read', 'memory_save'],
    deniedTools: ['shell_exec', 'vault_secret_read', 'mcp_mutating_call'],
    permissionBoundaries: {
      maxRiskTier: 'guarded',
      networkScope: 'public-https-only',
      secretAccess: false,
      approvalRequiredFor: ['browser_form_submit_external'],
    },
    memoryScope: 'shared:research-sources',
    workspaceScope: 'workspace/research',
    inputContract: 'AgentHandoff (research goal, target URLs, output schema)',
    outputContract: 'Source[] + structured Markdown brief + EvidenceReceipt',
    budgets: { maxSteps: 10, maxTokens: 4096, maxRuntimeMs: 150000, maxRetries: 2 },
    verificationConditions: ['Every extracted claim maps to an observed URL, timestamp, or fetched text snippet'],
    handoffTargets: ['archivist', 'artificer', 'mimir'],
  },
  {
    id: 'forge-master',
    name: 'Forge Master',
    norseArchetype: 'Brok-inspired Master Smith',
    roleTitle: 'Code Engineering, Builds, Tests & Runtime Debugging',
    priorityE2E: true,
    avatarArchetype: 'forge-bot-brok',
    accentColor: '#d6a34a',
    modelAssignment: 'ollama:qwen3.5:4b',
    fallbackModel: 'ollama:qwen3:1.7b',
    instructionsSummary: 'Write clean modular code inside sandboxed workspace, run compilers and test suites, diagnose failing tests with exact logs.',
    allowedTools: ['fs_read', 'fs_list', 'fs_write', 'fs_patch', 'shell_exec', 'memory_recall'],
    deniedTools: ['vault_raw_export', 'browser_login_session_steal'],
    permissionBoundaries: {
      maxRiskTier: 'approval',
      networkScope: 'localhost-build-only',
      secretAccess: false,
      approvalRequiredFor: ['shell_exec_untrusted', 'prod_deploy'],
    },
    memoryScope: 'project:codebase',
    workspaceScope: 'workspace/projects',
    inputContract: 'AgentHandoff (file paths, engineering goal, acceptance test command)',
    outputContract: 'Edited files + real test stdout/exit code + EvidenceReceipt',
    budgets: { maxSteps: 12, maxTokens: 6144, maxRuntimeMs: 180000, maxRetries: 2 },
    verificationConditions: ['Affected build/test command executed after final edit with exit code 0'],
    handoffTargets: ['artificer', 'sentinel', 'mimir'],
  },
  {
    id: 'artificer',
    name: 'Artificer',
    norseArchetype: 'Sindri-inspired Precision Craftsman',
    roleTitle: 'Adaptive UI Design, Critics, HTML/SVG & Visual QA',
    priorityE2E: true,
    avatarArchetype: 'forge-bot-sindri',
    accentColor: '#e0b35a',
    modelAssignment: 'ollama:qwen3.5:4b',
    fallbackModel: 'ollama:qwen3:1.7b',
    instructionsSummary: 'Compose schema-driven UISpecification layouts, refine visual polish, inspect rendered previews and SVG geometry, eliminate clutter.',
    allowedTools: ['fs_read', 'fs_write', 'browser_screenshot', 'foundry_render', 'memory_recall'],
    deniedTools: ['shell_exec_destructive', 'vault_secret_read'],
    permissionBoundaries: {
      maxRiskTier: 'safe',
      networkScope: 'localhost-preview',
      secretAccess: false,
      approvalRequiredFor: [],
    },
    memoryScope: 'shared:design-system',
    workspaceScope: 'workspace/artifacts',
    inputContract: 'Typed result + UI surface target',
    outputContract: 'Validated UISpecification + refined HTML/SVG/PNG artifact + critique pass log',
    budgets: { maxSteps: 8, maxTokens: 4096, maxRuntimeMs: 120000, maxRetries: 2 },
    verificationConditions: ['UISpecification passes schema validator with zero disallowed HTML/script nodes'],
    handoffTargets: ['forge-master', 'mimir'],
  },
  {
    id: 'guardian',
    name: 'Guardian',
    norseArchetype: 'Kratos-inspired Disciplined Protector',
    roleTitle: 'High-Impact Execution Guard & Fail-Safe Enforcement',
    priorityE2E: false,
    avatarArchetype: 'all-father-warrior',
    accentColor: '#c9544d',
    modelAssignment: 'ollama:qwen3.5:4b',
    fallbackModel: 'ollama:qwen3:1.7b',
    instructionsSummary: 'Verify high-consequence system actions, desktop control, irreversible writes, and rollback points after explicit Sentinel/user approval.',
    allowedTools: ['shell_exec', 'desktop_action', 'fs_read', 'fs_write'],
    deniedTools: ['silent_network_exfil', 'auto_approve_self'],
    permissionBoundaries: {
      maxRiskTier: 'approval',
      networkScope: 'restricted',
      secretAccess: false,
      approvalRequiredFor: ['shell_exec', 'desktop_action', 'destructive_write'],
    },
    memoryScope: 'project:ops',
    workspaceScope: 'workspace/ops',
    inputContract: 'Approved ToolRequest + Sentinel token',
    outputContract: 'ExecutionResult + rollback hash + EvidenceReceipt',
    budgets: { maxSteps: 6, maxTokens: 3072, maxRuntimeMs: 120000, maxRetries: 1 },
    verificationConditions: ['Valid Sentinel approval token present before any mutating host operation'],
    handoffTargets: ['sentinel', 'restorer', 'mimir'],
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    norseArchetype: 'Heimdall-inspired All-Seeing Watcher',
    roleTitle: 'Independent Policy Enforcement, Prompt-Injection & Secret Auditor',
    priorityE2E: false,
    avatarArchetype: 'heimdall-sentinel',
    accentColor: '#5bd2b8',
    modelAssignment: 'deterministic-policy-engine',
    fallbackModel: 'ollama:qwen3:1.7b',
    instructionsSummary: 'Evaluate every proposed ToolRequest and UI action against hard policy rules outside model context. Reject unauthorized or exfiltrative requests.',
    allowedTools: ['policy_evaluate', 'audit_record', 'secret_scan'],
    deniedTools: ['shell_exec', 'web_fetch', 'fs_write_workspace'],
    permissionBoundaries: {
      maxRiskTier: 'system-policy',
      networkScope: 'none',
      secretAccess: 'metadata-only-never-plaintext',
      approvalRequiredFor: [],
    },
    memoryScope: 'system:security-audit',
    workspaceScope: 'read-only-metadata',
    inputContract: 'ToolRequest | UIActionRequest',
    outputContract: 'SentinelDecision (ALLOW | REQUIRE_APPROVAL | DENY) + immutable audit record',
    budgets: { maxSteps: 1, maxTokens: 512, maxRuntimeMs: 1000, maxRetries: 0 },
    verificationConditions: ['Every decision logged with ruleId, timestamp, and non-secret argument digest'],
    handoffTargets: ['mimir', 'guardian'],
  },
  {
    id: 'archivist',
    name: 'Archivist',
    norseArchetype: 'Odin-inspired Seeker of Lore',
    roleTitle: 'Yggdrasil Knowledge Graph, Provenance & Long-Term Recall',
    priorityE2E: false,
    avatarArchetype: 'odin-archivist',
    accentColor: '#8fa8c8',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Maintain Yggdrasil graph nodes/edges, record source provenance and confidence, flag stale facts, and deduplicate overlapping memories.',
    allowedTools: ['memory_recall', 'memory_save', 'memory_delete', 'rag_query', 'fs_read'],
    deniedTools: ['shell_exec', 'desktop_action', 'vault_secret_read'],
    permissionBoundaries: {
      maxRiskTier: 'safe',
      networkScope: 'none',
      secretAccess: false,
      approvalRequiredFor: ['bulk_memory_purge'],
    },
    memoryScope: 'shared:all-realms',
    workspaceScope: 'workspace/state',
    inputContract: 'MemoryNode[] + Source[] + Artifact[]',
    outputContract: 'Normalized Yggdrasil graph update + provenance edges',
    budgets: { maxSteps: 6, maxTokens: 3072, maxRuntimeMs: 60000, maxRetries: 1 },
    verificationConditions: ['Every stored MemoryNode includes owner, timestamp, and source reference'],
    handoffTargets: ['mimir', 'scout'],
  },
  {
    id: 'restorer',
    name: 'Restorer',
    norseArchetype: 'Freya-inspired Mender & Vanir Seer',
    roleTitle: 'System Recovery, Diagnostics, Offline Degradation & Healing',
    priorityE2E: false,
    avatarArchetype: 'freya-valkyrie',
    accentColor: '#52c48c',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Diagnose failed runs, crashed workers, disconnected Ollama/browser states, and corrupt JSON state; repair gracefully with clear user notice.',
    allowedTools: ['preflight_check', 'fs_read', 'fs_list', 'memory_recall'],
    deniedTools: ['destructive_wipe', 'vault_raw_export'],
    permissionBoundaries: {
      maxRiskTier: 'guarded',
      networkScope: 'loopback-healthcheck',
      secretAccess: false,
      approvalRequiredFor: ['state_repair_overwrite'],
    },
    memoryScope: 'system:diagnostics',
    workspaceScope: 'workspace/state',
    inputContract: 'FailureEvent | HealthCheckFailure',
    outputContract: 'Root cause diagnosis + recovery plan or clean fallback state',
    budgets: { maxSteps: 6, maxTokens: 2048, maxRuntimeMs: 45000, maxRetries: 1 },
    verificationConditions: ['Root cause identifies failing endpoint, file, or exit code cleanly'],
    handoffTargets: ['forge-master', 'mimir'],
  },
  {
    id: 'diplomat',
    name: 'Diplomat',
    norseArchetype: 'Týr-inspired Keeper of Oaths & Bridges',
    roleTitle: 'MCP Servers, OAuth Scopes & External Integrations',
    priorityE2E: false,
    avatarArchetype: 'tyr-diplomat',
    accentColor: '#7ca3d1',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Route external connector requests through least-privilege OAuth/MCP scopes; always gate mutating external API calls behind approval.',
    allowedTools: ['mcp_list', 'mcp_call_readonly', 'memory_recall'],
    deniedTools: ['shell_exec', 'vault_plaintext_dump'],
    permissionBoundaries: {
      maxRiskTier: 'approval',
      networkScope: 'approved-connectors-only',
      secretAccess: 'opaque-vault-handle-only',
      approvalRequiredFor: ['mcp_mutating_call', 'outbound_message'],
    },
    memoryScope: 'shared:connectors',
    workspaceScope: 'workspace/config',
    inputContract: 'ConnectorCallRequest',
    outputContract: 'Redacted ConnectorResult + EvidenceReceipt',
    budgets: { maxSteps: 5, maxTokens: 2048, maxRuntimeMs: 60000, maxRetries: 1 },
    verificationConditions: ['Local-only mode blocks all external connector calls unless overridden'],
    handoffTargets: ['sentinel', 'mimir'],
  },
  {
    id: 'operator',
    name: 'Operator',
    norseArchetype: 'Thor-inspired Tireless Force',
    roleTitle: 'Scheduled Automations, Workflows & Background Compute',
    priorityE2E: false,
    avatarArchetype: 'thor-thunderer',
    accentColor: '#e59a3c',
    modelAssignment: 'ollama:qwen3:1.7b',
    fallbackModel: 'ollama:qwen3.5:4b',
    instructionsSummary: 'Execute durable cron routines, queued workflows, and multi-step batch jobs with deduplication and clean pause/cancel controls.',
    allowedTools: ['routine_run', 'workflow_step', 'fs_read', 'fs_write', 'memory_save'],
    deniedTools: ['unbounded_spawn', 'vault_raw_export'],
    permissionBoundaries: {
      maxRiskTier: 'guarded',
      networkScope: 'policy-bound',
      secretAccess: false,
      approvalRequiredFor: ['routine_external_action'],
    },
    memoryScope: 'shared:routines',
    workspaceScope: 'workspace/state',
    inputContract: 'RoutineDefinition | WorkflowSpec',
    outputContract: 'ExecutionEvent[] + TaskReceipt',
    budgets: { maxSteps: 10, maxTokens: 4096, maxRuntimeMs: 300000, maxRetries: 2 },
    verificationConditions: ['Idempotency key prevents duplicate concurrent runs for the same trigger'],
    handoffTargets: ['scout', 'forge-master', 'mimir'],
  },
  {
    id: 'creator',
    name: 'Creator',
    norseArchetype: 'Angrboda-inspired Shaper of Forms',
    roleTitle: 'Multimodal Media, Audio/Voice, 3D Meshes & Visual Studio',
    priorityE2E: false,
    avatarArchetype: 'angrboda-mystic',
    accentColor: '#9b87f5',
    modelAssignment: 'ollama:qwen3.5:4b',
    fallbackModel: 'ollama:qwen3:1.7b',
    instructionsSummary: 'Generate grounded images, 3D GLB/OBJ meshes, WAV music/audio, and Canvas/FFmpeg videos with quantitative verification.',
    allowedTools: ['foundry_render', 'python_creative_worker', 'fs_write', 'fs_read'],
    deniedTools: ['shell_exec_arbitrary', 'vault_secret_read'],
    permissionBoundaries: {
      maxRiskTier: 'safe',
      networkScope: 'none-tier1-local',
      secretAccess: false,
      approvalRequiredFor: ['tier2_paid_cloud_media'],
    },
    memoryScope: 'shared:creative-assets',
    workspaceScope: 'workspace/artifacts',
    inputContract: 'MediaBrief (mediaType, prompt, dimensions/duration)',
    outputContract: 'Verified Artifact + MediaRender QA telemetry',
    budgets: { maxSteps: 6, maxTokens: 3072, maxRuntimeMs: 180000, maxRetries: 1 },
    verificationConditions: ['Output file exists on disk, non-zero size, valid SHA-256 & QA checks pass'],
    handoffTargets: ['artificer', 'mimir'],
  },
]);

export const NORSE_ROLE_BY_ID = Object.freeze(
  Object.fromEntries(NORSE_AGENT_REGISTRY.map(role => [role.id, role])),
);

export function validateNorseRegistry() {
  return NORSE_AGENT_REGISTRY.map(role => ({
    id: role.id,
    ...validateContract('Agent', {
      id: role.id,
      name: role.name,
      norseArchetype: role.norseArchetype,
      roleTitle: role.roleTitle,
      modelAssignment: role.modelAssignment,
      allowedTools: role.allowedTools,
      permissionBoundaries: role.permissionBoundaries,
      budgets: role.budgets,
      avatarState: 'IDLE',
    }),
  }));
}

export function selectNorseRoleForTask(prompt = '', requestedSurface = '') {
  const p = String(prompt || '').toLowerCase();
  const s = String(requestedSurface || '').toLowerCase();
  if (s === 'research' || /\b(research|search|browse|website|scrape|source|compare|citation|find online|news)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.scout;
  }
  if (s === 'code' || /\b(code|debug|build|compile|refactor|test|react|rust|python|api|bug|repo|script|fix)\b/.test(p)) {
    return NORSE_ROLE_BY_ID['forge-master'];
  }
  if (/\b(ui|design|layout|svg|component|css|polish|accessibility|a11y|audit visual|interface)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.artificer;
  }
  if (s === 'media' || /\b(image|video|audio|music|3d|mesh|glb|render|draw|portrait)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.creator;
  }
  if (s === 'memory' || /\b(memory|yggdrasil|remember|knowledge graph|recall)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.archivist;
  }
  if (s === 'automation' || /\b(schedule|routine|cron|automate|every day|workflow)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.operator;
  }
  if (/\b(security|permission|policy|secret|vault|injection|sentinel|audit)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.sentinel;
  }
  if (/\b(recover|broken|crash|offline|diagnose|repair|heal)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.restorer;
  }
  if (/\b(oauth|mcp|connector|slack|github|gmail|notion)\b/.test(p)) {
    return NORSE_ROLE_BY_ID.diplomat;
  }
  return NORSE_ROLE_BY_ID.mimir;
}

export function getNorseRegistryWithLiveState({
  installedModels = [],
  agentStatuses = [],
  activeRun = null,
  sentinelStats = null,
} = {}) {
  const statusById = new Map((agentStatuses || []).map(s => [String(s.botId || '').toLowerCase(), s]));
  return NORSE_AGENT_REGISTRY.map(role => {
    const live = statusById.get(role.id) || statusById.get(`norse-${role.id}`) || null;
    const isWorking =
      live?.state === 'working' ||
      (activeRun && (activeRun.assignedRole === role.id || activeRun.botId === role.id));
    const bareModel = role.modelAssignment.replace(/^ollama:/, '');
    const modelAvailable =
      role.modelAssignment === 'deterministic-policy-engine' ||
      installedModels.length === 0 ||
      installedModels.some(m => String(m.name || m).startsWith(bareModel.split(':')[0]));

    return {
      ...role,
      liveState: isWorking ? 'WORKING' : live?.state === 'error' ? 'FAILED' : 'IDLE',
      modelAvailable,
      lastActivityAt: live?.updatedAt || null,
      sentinelBlockedCount: role.id === 'sentinel' ? Number(sentinelStats?.denied || 0) : 0,
    };
  });
}

export function mapNorseRoleToBotTools(role) {
  const allow = new Set(role?.allowedTools || []);
  return {
    shell: allow.has('shell_exec'),
    fs: allow.has('fs_read') || allow.has('fs_write') || allow.has('fs_patch'),
    browser: allow.has('browser_open') || allow.has('browser_action') || allow.has('web_search'),
    memory: allow.has('memory_recall') || allow.has('memory_save'),
    vault: role?.permissionBoundaries?.secretAccess === 'opaque-vault-handle-only',
  };
}

export function seedNorseRosterIntoStore(store) {
  if (!store || typeof store.listBots !== 'function') return [];
  const existing = store.listBots();
  const byTag = new Map(
    existing.map(b => [String(b.norseRoleId || b.id || '').toLowerCase(), b]),
  );
  const created = [];
  for (const role of NORSE_AGENT_REGISTRY) {
    const existingBot = byTag.get(role.id) || byTag.get(`norse-${role.id}`);
    if (existingBot) continue;
    const bot = store.createBot({
      id: `norse-${role.id}`,
      name: role.name,
      role: `${role.norseArchetype} · ${role.roleTitle}`,
      shape: role.avatarArchetype,
      color: role.accentColor,
      systemPrompt: role.instructionsSummary,
      tools: mapNorseRoleToBotTools(role),
      norseRoleId: role.id,
      specialistTag: role.priorityE2E ? 'PRIORITY_E2E' : 'NORSE_SPECIALIST',
      isTeamBot: true,
    });
    created.push(bot);
  }
  return created;
}
