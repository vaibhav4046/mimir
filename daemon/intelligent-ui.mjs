import crypto from 'node:crypto';
import { UI_SURFACES, UI_BLOCK_TYPES, validateContract } from './contracts.mjs';
import { selectNorseRoleForTask } from './norse-agents.mjs';

const APPROVED_SURFACES = new Set(UI_SURFACES);
const APPROVED_BLOCK_TYPES = new Set(UI_BLOCK_TYPES);
const APPROVED_ACTIONS = new Set([
  'toggle_checklist_item',
  'submit_form',
  'approve_request',
  'deny_request',
  'open_surface',
  'open_artifact',
  'export_report',
  'pin_space',
  'run_specialist',
  'rerun_verify',
]);

const UNSAFE_MARKUP_RE = /<\s*script\b|javascript:|on(?:click|load|error|mouseover)\s*=|dangerouslySetInnerHTML|<\s*iframe\b/i;

export function selectAdaptiveSurface({ prompt = '', requestedSurface = '', hasCode = false, hasMedia = false, hasResearch = false, isVoice = false, isMemory = false, isAutomation = false } = {}) {
  const explicit = String(requestedSurface || '').trim().toLowerCase();
  if (explicit && APPROVED_SURFACES.has(explicit)) return explicit;
  if (isVoice) return 'voice';
  const p = String(prompt || '').toLowerCase();
  if (hasResearch || /\b(research|sources|citations|compare|market|report|deep dive|verify facts)\b/.test(p)) return 'research';
  if (hasCode || /\b(code|debug|build|repo|function|compile|test|patch|editor|workspace file)\b/.test(p)) return 'code';
  if (hasMedia || /\b(image|video|audio|music|3d|mesh|glb|render|storyboard)\b/.test(p)) return 'media';
  if (isAutomation || /\b(schedule|cron|routine|automate|every morning|recurring)\b/.test(p)) return 'automation';
  if (isMemory || /\b(yggdrasil|memory|knowledge graph|atlas)\b/.test(p)) return 'memory';
  return 'chat';
}

export function validateUiSpec(spec = {}) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { valid: false, ok: false, errors: ['UISpecification must be a JSON object'], sanitized: null };
  }

  const version = Number(spec.version ?? 1);
  if (version !== 1) errors.push(`Unsupported UISpecification version: ${spec.version}`);

  const surface = String(spec.surface || 'chat');
  if (!APPROVED_SURFACES.has(surface)) {
    errors.push(`Disallowed surface "${surface}". Allowed: ${UI_SURFACES.join(', ')}`);
  }

  const title = String(spec.title || '').trim();
  if (!title) errors.push('Missing UISpecification title');

  const rawJson = JSON.stringify(spec);
  if (UNSAFE_MARKUP_RE.test(rawJson)) {
    errors.push('Rejected unsafe HTML, script tag, or inline event handler in UISpecification');
  }

  if (!Array.isArray(spec.blocks)) {
    errors.push('UISpecification.blocks must be an array');
  }

  const sanitizedBlocks = [];
  for (const [idx, block] of (Array.isArray(spec.blocks) ? spec.blocks : []).entries()) {
    if (!block || typeof block !== 'object') {
      errors.push(`Block[${idx}] must be an object`);
      continue;
    }
    const blockType = String(block.type || '');
    if (!APPROVED_BLOCK_TYPES.has(blockType)) {
      errors.push(`Block[${idx}] uses unapproved component type "${blockType}"`);
      continue;
    }
    const blockId = String(block.id || `blk-${idx + 1}`);
    const data = block.data && typeof block.data === 'object' && !Array.isArray(block.data) ? block.data : {};
    sanitizedBlocks.push({
      id: blockId,
      type: blockType,
      title: block.title ? String(block.title) : undefined,
      data,
    });
  }

  const sanitizedActions = [];
  if (spec.actions !== undefined && !Array.isArray(spec.actions)) {
    errors.push('UISpecification.actions must be an array when provided');
  } else {
    for (const [idx, act] of (spec.actions || []).entries()) {
      const actionId = String(act?.actionId || '');
      if (!APPROVED_ACTIONS.has(actionId)) {
        errors.push(`Action[${idx}] references unapproved actionId "${actionId}"`);
        continue;
      }
      sanitizedActions.push({
        id: String(act.id || `act-${idx + 1}`),
        label: String(act.label || actionId),
        actionId,
        payload: act.payload && typeof act.payload === 'object' ? act.payload : {},
        variant: act.variant === 'primary' || act.variant === 'danger' ? act.variant : 'default',
      });
    }
  }

  const normalized = {
    id: String(spec.id || `ui-${crypto.randomUUID().slice(0, 8)}`),
    version: 1,
    taskId: spec.taskId ? String(spec.taskId) : undefined,
    runId: spec.runId ? String(spec.runId) : undefined,
    surface,
    title: title || 'Task Workspace',
    assignedRoleId: spec.assignedRoleId ? String(spec.assignedRoleId) : 'mimir',
    blocks: sanitizedBlocks,
    actions: sanitizedActions,
    generatedAt: String(spec.generatedAt || new Date().toISOString()),
  };

  const contractCheck = validateContract('UISpecification', normalized);
  if (!contractCheck.valid) errors.push(...contractCheck.errors);

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? normalized : null,
  };
}

export function planUiSpecification({
  prompt = '',
  requestedSurface = '',
  answerText = '',
  sources = [],
  artifacts = [],
  toolEvents = [],
  approval = null,
  receipt = null,
  checklist = null,
  comparisonRows = null,
  chartSeries = null,
  codeFiles = null,
  browserState = null,
  yggdrasilStats = null,
  runId = null,
  taskId = null,
} = {}) {
  const specialist = selectNorseRoleForTask(prompt, requestedSurface);
  const surface = selectAdaptiveSurface({
    prompt,
    requestedSurface,
    hasResearch: (sources && sources.length > 0) || Boolean(comparisonRows),
    hasCode: Boolean(codeFiles && codeFiles.length > 0),
    hasMedia: (artifacts || []).some(a => ['png', 'svg', 'glb', 'obj', 'wav', 'music', 'mp4', 'webm'].includes(String(a?.format || '').toLowerCase())),
    isMemory: Boolean(yggdrasilStats),
  });

  const blocks = [];
  if (answerText || (sources && sources.length > 0)) {
    blocks.push({
      id: 'blk-summary',
      type: 'rich_text',
      title: `${specialist.name} · Response`,
      data: {
        markdown: String(answerText || '').trim() || `Assigned to ${specialist.name} (${specialist.roleTitle}).`,
        citations: (sources || []).slice(0, 8).map((s, idx) => ({
          index: idx + 1,
          title: String(s.title || s.url || `Source ${idx + 1}`),
          url: String(s.url || ''),
          snippet: String(s.snippet || s.excerpt || '').slice(0, 180),
        })),
      },
    });
  }

  if (approval && approval.status === 'PENDING') {
    blocks.push({
      id: 'blk-approval',
      type: 'approval_dialog',
      title: 'Sentinel Approval Required',
      data: {
        approvalId: approval.id,
        toolName: approval.toolName || approval.action || 'privileged_action',
        reason: approval.reason || 'Explicit confirmation required before execution.',
        riskTier: approval.riskTier || 'high',
        status: approval.status,
      },
    });
  }

  if (sources && sources.length > 0) {
    blocks.push({
      id: 'blk-sources',
      type: 'source_inspector',
      title: `Grounded Sources (${sources.length})`,
      data: {
        sources: sources.slice(0, 12).map((s, i) => ({
          id: s.id || `src-${i + 1}`,
          title: String(s.title || s.url || `Source ${i + 1}`),
          url: String(s.url || ''),
          verified: s.verified !== false,
          excerpt: String(s.snippet || s.excerpt || '').slice(0, 220),
        })),
      },
    });
  }

  if (Array.isArray(comparisonRows) && comparisonRows.length > 0) {
    blocks.push({
      id: 'blk-compare',
      type: 'comparison_table',
      title: 'Structured Comparison',
      data: {
        columns: Object.keys(comparisonRows[0]),
        rows: comparisonRows.slice(0, 20),
      },
    });
  }

  if (Array.isArray(chartSeries) && chartSeries.length > 0) {
    blocks.push({
      id: 'blk-chart',
      type: 'chart',
      title: 'Measured Metrics',
      data: {
        kind: 'bar',
        series: chartSeries.slice(0, 16),
      },
    });
  }

  if (Array.isArray(checklist) && checklist.length > 0) {
    blocks.push({
      id: 'blk-checklist',
      type: 'checklist',
      title: 'Execution Checklist',
      data: {
        items: checklist.map((item, i) => ({
          id: String(item.id || `chk-${i + 1}`),
          label: String(item.label || item.title || `Step ${i + 1}`),
          checked: Boolean(item.checked || item.done),
        })),
      },
    });
  }

  if (Array.isArray(codeFiles) && codeFiles.length > 0) {
    blocks.push({
      id: 'blk-code',
      type: 'code_editor',
      title: 'Workspace Files',
      data: {
        files: codeFiles.slice(0, 8).map(f => ({
          path: String(f.path || f.name || 'untitled.txt'),
          language: String(f.language || 'text'),
          content: String(f.content || '').slice(0, 4000),
        })),
      },
    });
  }

  if (browserState && browserState.url) {
    blocks.push({
      id: 'blk-browser',
      type: 'browser_preview',
      title: 'Live Browser State',
      data: {
        url: String(browserState.url),
        title: String(browserState.title || browserState.url),
        status: String(browserState.status || 'READY'),
      },
    });
  }

  for (const [idx, art] of (artifacts || []).entries()) {
    const fmt = String(art.format || '').toLowerCase();
    if (['png', 'svg', 'jpg', 'jpeg', 'webp'].includes(fmt)) {
      blocks.push({
        id: `blk-img-${idx}`,
        type: 'image_canvas',
        title: art.title || `Image (${fmt.toUpperCase()})`,
        data: { artifactId: art.id, url: art.url || '', format: fmt, sizeBytes: Number(art.size_bytes || art.bytes || 0) },
      });
    } else if (['mp4', 'webm'].includes(fmt)) {
      blocks.push({
        id: `blk-vid-${idx}`,
        type: 'video_timeline',
        title: art.title || 'Video Output',
        data: { artifactId: art.id, url: art.url || '', format: fmt, durationSec: Number(art.duration_sec || 0) },
      });
    } else if (['wav', 'mp3', 'music'].includes(fmt)) {
      blocks.push({
        id: `blk-aud-${idx}`,
        type: 'audio_player',
        title: art.title || 'Audio Output',
        data: { artifactId: art.id, url: art.url || '', format: fmt },
      });
    } else {
      blocks.push({
        id: `blk-art-${idx}`,
        type: 'artifact_preview',
        title: art.title || `Artifact (${fmt})`,
        data: {
          artifactId: art.id,
          format: fmt,
          bytes: Number(art.size_bytes || art.bytes || 0),
          url: art.url || '',
        },
      });
    }
  }

  if (Array.isArray(toolEvents) && toolEvents.length > 0) {
    blocks.push({
      id: 'blk-timeline',
      type: 'activity_timeline',
      title: 'Execution Timeline',
      data: {
        events: toolEvents.slice(0, 20).map((ev, i) => ({
          id: String(ev.id || `ev-${i + 1}`),
          label: String(ev.summary || ev.toolName || ev.type || 'Event'),
          status: String(ev.status || 'completed'),
          timestamp: String(ev.timestamp || new Date().toISOString()),
        })),
      },
    });
  }

  if (yggdrasilStats) {
    blocks.push({
      id: 'blk-yggdrasil',
      type: 'yggdrasil_graph_preview',
      title: 'Yggdrasil Knowledge Connections',
      data: yggdrasilStats,
    });
  }

  if (receipt) {
    blocks.push({
      id: 'blk-receipt',
      type: 'task_receipt',
      title: 'Verified Task Receipt',
      data: {
        receiptId: receipt.id || 'rcpt-local',
        hash: receipt.hash || 'sha256:verified',
        verified: receipt.verified !== false,
        roleId: specialist.id,
        timestamp: receipt.timestamp || new Date().toISOString(),
      },
    });
  }

  const actions = [
    { id: 'act-verify', label: 'Open Yggdrasil Atlas', actionId: 'open_surface', payload: { tab: 'map' }, variant: 'default' },
  ];
  if (sources && sources.length > 0) {
    actions.push({ id: 'act-export-md', label: 'Export Markdown', actionId: 'export_report', payload: { format: 'md' }, variant: 'primary' });
  }

  const candidate = {
    id: `ui-${crypto.randomUUID().slice(0, 8)}`,
    version: 1,
    taskId: taskId || undefined,
    runId: runId || undefined,
    surface,
    title: prompt ? String(prompt).slice(0, 64) : `${specialist.name} Workspace`,
    assignedRoleId: specialist.id,
    blocks,
    actions,
    generatedAt: new Date().toISOString(),
  };

  return validateUiSpec(candidate);
}
