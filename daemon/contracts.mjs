import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const SCHEMA_VERSION = '2026.1';

export const TASK_LIFECYCLE_STATES = Object.freeze([
  'PENDING',
  'RUNNING',
  'WAITING_FOR_INPUT',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const UI_STATUS_VOCABULARY = Object.freeze({
  PENDING: 'Preparing task',
  RUNNING: 'Working on task',
  SEARCHING: 'Searching sources',
  BUILDING: 'Building application',
  TESTING: 'Running tests',
  RENDERING_VIDEO: 'Rendering video',
  GENERATING_MUSIC: 'Generating music',
  WAITING_FOR_INPUT: 'Waiting for approval',
  VERIFYING: 'Verifying result',
  PREPARING_DOWNLOAD: 'Preparing download',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
});

export const CONTROL_PLANE_POLICY = Object.freeze({
  primaryControlPlane: 'node-rust-sqlite-wal',
  secondarySubsystemRole: 'mimri-isolated-worker-only',
  councilEnabledByDefault: false,
  councilPolicy: 'Opt-in only unless benchmarked superior on held-out tasks',
});

export const AVATAR_STATES = Object.freeze([
  'IDLE',
  'LISTENING',
  'THINKING',
  'WORKING',
  'SPEAKING',
  'WAITING_APPROVAL',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'OFFLINE',
]);

export const UI_SURFACES = Object.freeze([
  'chat',
  'research',
  'code',
  'media',
  'voice',
  'automation',
  'memory',
]);

export const UI_BLOCK_TYPES = Object.freeze([
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

function field(type, required = false, values = null) {
  return values ? { type, required, enum: values } : { type, required };
}

export const CONTRACT_SCHEMAS = Object.freeze({
  Task: {
    version: SCHEMA_VERSION,
    description: 'Top-level user intent tracked across one or more execution runs.',
    fields: {
      id: field('string', true),
      title: field('string', true),
      prompt: field('string', true),
      mode: field('string', true),
      status: field('string', true, TASK_LIFECYCLE_STATES),
      projectId: field('string', false),
      userId: field('string', true),
      createdAt: field('string', true),
      updatedAt: field('string', true),
    },
  },
  Run: {
    version: SCHEMA_VERSION,
    description: 'Concrete execution attempt for a Task.',
    fields: {
      id: field('string', true),
      taskId: field('string', true),
      status: field('string', true, TASK_LIFECYCLE_STATES),
      uiStatus: field('string', false),
      botId: field('string', false),
      startedAt: field('string', true),
      completedAt: field('string', false),
      error: field('string', false),
    },
  },
  Step: {
    version: SCHEMA_VERSION,
    description: 'Discrete ordered execution unit inside a Run.',
    fields: {
      id: field('string', true),
      runId: field('string', true),
      phase: field('string', true, ['understand', 'plan', 'execute', 'verify', 'deliver']),
      status: field('string', true, TASK_LIFECYCLE_STATES),
      summary: field('string', true),
      durationMs: field('number', false),
    },
  },
  ToolCall: {
    version: SCHEMA_VERSION,
    description: 'Typed invocation of a local, MCP, or worker tool under permission boundary.',
    fields: {
      id: field('string', true),
      runId: field('string', true),
      toolName: field('string', true),
      arguments: field('object', true),
      riskTier: field('string', true, ['safe', 'confirm', 'destructive']),
      requestedAt: field('string', true),
    },
  },
  ToolResult: {
    version: SCHEMA_VERSION,
    description: 'Structured result returned by a ToolCall.',
    fields: {
      callId: field('string', true),
      ok: field('boolean', true),
      outputSummary: field('string', true),
      durationMs: field('number', true),
      error: field('string', false),
    },
  },
  Approval: {
    version: SCHEMA_VERSION,
    description: 'User gate blocking irreversible or high-risk actions until explicitly decided.',
    fields: {
      id: field('string', true),
      runId: field('string', true),
      action: field('string', true),
      status: field('string', true, ['PENDING', 'APPROVED', 'DENIED', 'EXPIRED']),
      reason: field('string', true),
      decidedAt: field('string', false),
    },
  },
  ModelInvocation: {
    version: SCHEMA_VERSION,
    description: 'Auditable record of a local or cloud LLM inference call.',
    fields: {
      id: field('string', true),
      runId: field('string', false),
      provider: field('string', true),
      model: field('string', true),
      localOnly: field('boolean', true),
      latencyMs: field('number', true),
      tokensOut: field('number', false),
    },
  },
  WorkerJob: {
    version: SCHEMA_VERSION,
    description: 'Isolated Python/Rust background job dispatched by the Node control plane.',
    fields: {
      id: field('string', true),
      workerType: field('string', true, ['python-foundry', 'python-creative', 'python-voice', 'rust-queue', 'mimri-sandbox']),
      status: field('string', true, TASK_LIFECYCLE_STATES),
      payload: field('object', true),
      createdAt: field('string', true),
    },
  },
  Artifact: {
    version: SCHEMA_VERSION,
    description: 'Verified downloadable or previewable deliverable produced in SQLite + filesystem.',
    fields: {
      id: field('string', true),
      title: field('string', true),
      format: field('string', true),
      category: field('string', true),
      filePath: field('string', false),
      bytes: field('number', true),
      sha256: field('string', true),
      createdAt: field('string', true),
    },
  },
  EvidenceReceipt: {
    version: SCHEMA_VERSION,
    description: 'Cryptographic hash-chained execution receipt proving verified actions.',
    fields: {
      id: field('string', true),
      runId: field('string', false),
      action: field('string', true),
      hash: field('string', true),
      prevHash: field('string', true),
      verified: field('boolean', true),
      timestamp: field('string', true),
    },
  },
  MemoryNode: {
    version: SCHEMA_VERSION,
    description: 'Typed entity node inside the Yggdrasil Memory Atlas.',
    fields: {
      id: field('string', true),
      type: field('string', true, [
        'project',
        'file',
        'task',
        'conversation',
        'bot',
        'memory',
        'source',
        'decision',
        'skill',
        'artifact',
        'timeline',
      ]),
      label: field('string', true),
      summary: field('string', false),
      confidence: field('number', false),
      updatedAt: field('string', true),
    },
  },
  ConnectorSession: {
    version: SCHEMA_VERSION,
    description: 'Authenticated or local integration connector state.',
    fields: {
      id: field('string', true),
      connectorId: field('string', true),
      status: field('string', true, ['DISCONNECTED', 'CONNECTED', 'ERROR', 'EXPIRED']),
      scopes: field('array', false),
      localOnlyBlocked: field('boolean', false),
      updatedAt: field('string', true),
    },
  },
  VoiceTurn: {
    version: SCHEMA_VERSION,
    description: 'Full-duplex voice utterance, backchannel filter decision, and latency telemetry.',
    fields: {
      id: field('string', true),
      transcript: field('string', true),
      durationMs: field('number', true),
      isBackchannel: field('boolean', true),
      bargeInTriggered: field('boolean', true),
      firstAudioLatencyMs: field('number', false),
      endToEndLatencyMs: field('number', true),
    },
  },
  MediaRender: {
    version: SCHEMA_VERSION,
    description: 'Creative audio/video/image/3D render metadata including honest hardware tier.',
    fields: {
      id: field('string', true),
      mediaType: field('string', true, ['video', 'audio', 'image', 'svg', '3d', 'webapp']),
      tier: field('string', true),
      hardwareRequired: field('string', true),
      qaPassed: field('boolean', true),
      qaChecks: field('object', true),
    },
  },
  Agent: {
    version: SCHEMA_VERSION,
    description: 'Registered Norse agent role or user bot with explicit capabilities, budgets, and boundaries.',
    fields: {
      id: field('string', true),
      name: field('string', true),
      norseArchetype: field('string', true),
      roleTitle: field('string', true),
      modelAssignment: field('string', true),
      allowedTools: field('array', true),
      permissionBoundaries: field('object', true),
      budgets: field('object', true),
      avatarState: field('string', false, AVATAR_STATES),
    },
  },
  AgentHandoff: {
    version: SCHEMA_VERSION,
    description: 'Audited delegation from Mimir or a specialist to another Norse role with bounded scope.',
    fields: {
      id: field('string', true),
      runId: field('string', true),
      fromAgentId: field('string', true),
      toAgentId: field('string', true),
      goal: field('string', true),
      allowedTools: field('array', true),
      verificationCondition: field('string', true),
      status: field('string', true, ['PENDING', 'ACCEPTED', 'COMPLETED', 'FAILED', 'REJECTED']),
      createdAt: field('string', true),
    },
  },
  ToolRequest: {
    version: SCHEMA_VERSION,
    description: 'Proposed tool invocation submitted to the independent Sentinel policy service before execution.',
    fields: {
      id: field('string', true),
      runId: field('string', false),
      agentId: field('string', true),
      toolName: field('string', true),
      arguments: field('object', true),
      sentinelDecision: field('string', false, ['ALLOW', 'REQUIRE_APPROVAL', 'DENY']),
      requestedAt: field('string', true),
    },
  },
  ExecutionEvent: {
    version: SCHEMA_VERSION,
    description: 'Authoritative timeline event driving workspace state, receipts, Yggdrasil graph, and Mimir avatar.',
    fields: {
      id: field('string', true),
      runId: field('string', false),
      eventType: field('string', true),
      agentId: field('string', false),
      avatarState: field('string', false, AVATAR_STATES),
      summary: field('string', true),
      timestamp: field('string', true),
    },
  },
  UISpecification: {
    version: SCHEMA_VERSION,
    description: 'Validated schema-driven adaptive interface payload bound strictly to approved components and actions.',
    fields: {
      id: field('string', true),
      version: field('number', true),
      surface: field('string', true, UI_SURFACES),
      title: field('string', true),
      blocks: field('array', true),
      actions: field('array', false),
      generatedAt: field('string', true),
    },
  },
  AvatarState: {
    version: SCHEMA_VERSION,
    description: 'Truth-derived visual state of the living Mimir avatar.',
    fields: {
      state: field('string', true, AVATAR_STATES),
      sourceEvent: field('string', true),
      audioLevel: field('number', true),
      speaking: field('boolean', true),
      reducedMotion: field('boolean', false),
      updatedAt: field('string', true),
    },
  },
});

export const CONTRACT_NAMES = Object.freeze(Object.keys(CONTRACT_SCHEMAS));

export function validateContract(type, payload = {}) {
  const schema = CONTRACT_SCHEMAS[type];
  if (!schema) {
    return {
      ok: false,
      valid: false,
      schemaVersion: SCHEMA_VERSION,
      type: String(type || ''),
      errors: [`Unknown contract type "${type}". Expected one of: ${CONTRACT_NAMES.join(', ')}`],
      normalized: null,
    };
  }
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const errors = [];
  const normalized = { schemaVersion: SCHEMA_VERSION };

  for (const [key, def] of Object.entries(schema.fields)) {
    const val = input[key];
    if (val === undefined || val === null || val === '') {
      if (def.required) errors.push(`Missing required field "${key}" (${def.type})`);
      continue;
    }
    if (def.type === 'array') {
      if (!Array.isArray(val)) errors.push(`Field "${key}" must be an array`);
    } else if (def.type === 'object') {
      if (typeof val !== 'object' || Array.isArray(val)) errors.push(`Field "${key}" must be an object`);
    } else if (typeof val !== def.type) {
      errors.push(`Field "${key}" must be of type ${def.type}, got ${typeof val}`);
    }
    if (def.enum && !def.enum.includes(val)) {
      errors.push(`Field "${key}" has invalid value "${val}". Allowed: ${def.enum.join(', ')}`);
    }
    normalized[key] = val;
  }

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    schemaVersion: SCHEMA_VERSION,
    type,
    errors,
    normalized: errors.length === 0 ? normalized : null,
  };
}

export function createContractRecord(type, overrides = {}) {
  const now = new Date().toISOString();
  const id = overrides.id || `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const defaults = {
    Task: { id, title: 'Untitled Task', prompt: '', mode: 'conversation', status: 'PENDING', userId: 'default', createdAt: now, updatedAt: now },
    Run: { id, taskId: overrides.taskId || 'task-unknown', status: 'RUNNING', uiStatus: UI_STATUS_VOCABULARY.RUNNING, startedAt: now },
    Step: { id, runId: overrides.runId || 'run-unknown', phase: 'execute', status: 'RUNNING', summary: 'Executing step' },
    ToolCall: { id, runId: overrides.runId || 'run-unknown', toolName: 'unknown', arguments: {}, riskTier: 'safe', requestedAt: now },
    ToolResult: { callId: overrides.callId || id, ok: true, outputSummary: '', durationMs: 0 },
    Approval: { id, runId: overrides.runId || 'run-unknown', action: 'confirm_action', status: 'PENDING', reason: 'Explicit user confirmation required' },
    ModelInvocation: { id, provider: 'ollama', model: 'qwen3:1.7b', localOnly: true, latencyMs: 0 },
    WorkerJob: { id, workerType: 'python-creative', status: 'PENDING', payload: {}, createdAt: now },
    Artifact: { id, title: 'Untitled Artifact', format: 'md', category: 'document', bytes: 0, sha256: 'pending', createdAt: now },
    EvidenceReceipt: { id, action: 'step_verified', hash: 'sha256:pending', prevHash: 'genesis', verified: true, timestamp: now },
    MemoryNode: { id, type: 'memory', label: 'Memory Entry', summary: '', confidence: 0.9, updatedAt: now },
    ConnectorSession: { id, connectorId: 'local-fs', status: 'CONNECTED', scopes: [], localOnlyBlocked: false, updatedAt: now },
    VoiceTurn: { id, transcript: '', durationMs: 0, isBackchannel: false, bargeInTriggered: false, endToEndLatencyMs: 0 },
    MediaRender: { id, mediaType: 'audio', tier: 'Tier 1 — Deterministic Synthesis', hardwareRequired: 'CPU + >=4GB RAM', qaPassed: true, qaChecks: {} },
    Agent: { id, name: 'Mimir', norseArchetype: 'Sage', roleTitle: 'Orchestrator', modelAssignment: 'qwen3:1.7b', allowedTools: ['memory_recall', 'subagent_loop'], permissionBoundaries: { maxRiskTier: 'approval', networkScope: 'guarded', secretAccess: false }, budgets: { maxSteps: 8, maxRuntimeMs: 120000 }, avatarState: 'IDLE' },
    AgentHandoff: { id, runId: overrides.runId || 'run-unknown', fromAgentId: 'mimir', toAgentId: 'scout', goal: 'Gather grounded evidence', allowedTools: ['browser_open'], verificationCondition: 'At least 1 grounded source recorded', status: 'PENDING', createdAt: now },
    ToolRequest: { id, runId: overrides.runId || 'run-unknown', agentId: 'mimir', toolName: 'fs_read', arguments: {}, sentinelDecision: 'ALLOW', requestedAt: now },
    ExecutionEvent: { id, runId: overrides.runId || 'run-unknown', eventType: 'task_started', agentId: 'mimir', avatarState: 'WORKING', summary: 'Task execution started', timestamp: now },
    UISpecification: { id, version: 1, surface: 'chat', title: 'Task Result', blocks: [], actions: [], generatedAt: now },
    AvatarState: { state: 'IDLE', sourceEvent: 'startup', audioLevel: 0, speaking: false, reducedMotion: false, updatedAt: now },
  };
  return { schemaVersion: SCHEMA_VERSION, ...(defaults[type] || {}), ...overrides, id };
}

let _cachedGpu = null;

function queryNvidiaGpuOnce() {
  if (_cachedGpu !== null) return _cachedGpu;
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 1500, windowsHide: true },
    ).trim();
    const lines = out.split(/\r?\n/).filter(Boolean);
    _cachedGpu = lines.map(line => {
      const [name, totalMb, freeMb] = line.split(',').map(s => s.trim());
      return {
        name: name || 'NVIDIA GPU',
        vramTotalMb: Number(totalMb) || 0,
        vramFreeMb: Number(freeMb) || 0,
      };
    });
  } catch {
    _cachedGpu = [];
  }
  return _cachedGpu;
}

export function detectHardwareCapabilities({ ollamaModels = [], settings = {} } = {}) {
  const cpus = os.cpus();
  const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeRamMb = Math.round(os.freemem() / (1024 * 1024));
  const gpus = queryNvidiaGpuOnce();
  const primaryGpu = gpus[0] || { name: 'CPU Fallback Only', vramTotalMb: 0, vramFreeMb: 0 };
  const tier2GenerativeVideoSupported = primaryGpu.vramTotalMb >= 12000;

  return {
    schemaVersion: SCHEMA_VERSION,
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: {
      model: cpus[0]?.model || 'Unknown CPU',
      cores: cpus.length,
    },
    memory: {
      totalRamMb,
      freeRamMb,
    },
    gpu: primaryGpu,
    gpus,
    localOnlyMode: Boolean(settings.localOnly),
    installedOllamaModels: Array.isArray(ollamaModels) ? ollamaModels : [],
    capabilities: {
      localChatAndCoding: {
        status: 'READY',
        recommendedModel: primaryGpu.vramTotalMb >= 6000 ? 'qwen3.5:4b' : 'qwen3:1.7b',
        maxLocalModel: primaryGpu.vramTotalMb >= 6000 ? 'qwen3.5:9b' : 'qwen3.5:4b',
      },
      documentExport9Formats: {
        status: 'READY',
        formats: ['md', 'docx', 'pdf', 'pptx', 'xlsx', 'csv', 'html', 'json', 'zip'],
      },
      musicAndAudioWav: {
        status: 'READY',
        engine: 'numpy+scipy harmonic synthesizer (44.1kHz PCM WAV)',
        aceStep15Optional: primaryGpu.vramTotalMb >= 6000 ? 'CPU_OFFLOAD_ELIGIBLE' : 'CPU_ONLY',
      },
      videoProductionTier1: {
        status: 'READY',
        engine: 'Deterministic PIL/Canvas + imageio-ffmpeg MP4/WebM',
      },
      videoGenerativeTier2: {
        status: tier2GenerativeVideoSupported ? 'READY' : 'HARDWARE_GATED_VRAM_LIMIT',
        reason: tier2GenerativeVideoSupported
          ? 'Sufficient GPU VRAM (>=12GB)'
          : `Detected ${primaryGpu.name} (${primaryGpu.vramTotalMb} MiB VRAM). Generative video diffusion models require >=12288 MiB VRAM or cloud API; automatically routing to Tier 1 Deterministic Video Composition.`,
      },
      voiceDuplexAndBackchannel: {
        status: 'READY',
        stt: 'faster-whisper + browser Web Speech fallback',
        tts: 'Windows SAPI5 offline + edge-tts optional',
        backchannelFilter: true,
      },
    },
  };
}
