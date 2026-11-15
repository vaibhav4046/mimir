import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NORSE_ROLE_BY_ID } from './norse-agents.mjs';
import { classifyToolApproval } from './local-exec.mjs';
import { validateContract } from './contracts.mjs';

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /reveal\s+(?:the\s+)?(?:vault|api[_ ]?key|secret|password|token)/i,
  /exfiltrate\s+/i,
  /\.\.[\\/].*\.(?:env|pem|key|vault)/i,
  /(?:curl|wget|Invoke-WebRequest)\s+.*(?:\$\{?\w*(?:KEY|TOKEN|SECRET|PASS)\w*\}?|vault\.enc|sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|xoxb-)/i,
  /powershell.*-EncodedCommand/i,
  /rm\s+-rf\s+[\/\\](?:\s|$|\*)/i,
];

const DESTRUCTIVE_SHELL_RE = /\b(rm\s+-rf|del\s+\/f|format\s+[a-z]:|cipher\s+\/w|reg\s+delete|shutdown|taskkill\s+\/f)\b/i;
const SENSITIVE_PATH_RE = /(?:^|[\\/])(?:\.vault|vault\.enc|\.ssh|\.aws|id_rsa|\.env(?:\.local)?)(?:$|[\\/])/i;
const PRIVATE_METADATA_IP_RE = /^https?:\/\/(?:169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)/i;

export class SentinelPolicyService {
  constructor({ dataDir, onAuditEvent } = {}) {
    this.dataDir = dataDir ? path.resolve(dataDir) : null;
    this.auditPath = this.dataDir ? path.join(this.dataDir, 'sentinel-audit.jsonl') : null;
    this.onAuditEvent = typeof onAuditEvent === 'function' ? onAuditEvent : null;
    this.events = [];
    if (this.auditPath && fs.existsSync(this.auditPath)) {
      try {
        const lines = fs.readFileSync(this.auditPath, 'utf8').split(/\r?\n/).filter(Boolean);
        this.events = lines.slice(-250).map(l => JSON.parse(l));
      } catch {
        this.events = [];
      }
    }
  }

  #redactArgs(obj) {
    try {
      const json = JSON.stringify(obj || {});
      return json.replace(/(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/g, '[REDACTED]').slice(0, 400);
    } catch {
      return '{}';
    }
  }

  recordAuditEvent(entry) {
    const record = {
      id: `sent-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.events.push(record);
    if (this.events.length > 500) this.events = this.events.slice(-500);
    if (this.auditPath) {
      try {
        fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
        fs.appendFileSync(this.auditPath, `${JSON.stringify(record)}\n`, 'utf8');
      } catch {
        // non-fatal disk write error
      }
    }
    if (this.onAuditEvent) {
      try {
        this.onAuditEvent(record);
      } catch {
        // ignore listener failure
      }
    }
    return record;
  }

  inspectTextForThreats(text = '') {
    const raw = String(text || '');
    const matched = [];
    for (const pat of PROMPT_INJECTION_PATTERNS) {
      if (pat.test(raw)) matched.push(pat.source);
    }
    return {
      suspicious: matched.length > 0,
      patterns: matched,
    };
  }

  evaluateToolRequest({
    agentId = 'mimir',
    toolName = '',
    args = {},
    bot = null,
    executionMode = 'auto',
    approvalPolicy = null,
    localOnly = false,
    approved = false,
    runId = 'run-direct',
  } = {}) {
    const cleanRoleId = String(bot?.norseRoleId || agentId || 'mimir').replace(/^norse-/, '').toLowerCase();
    const role = NORSE_ROLE_BY_ID[cleanRoleId] || NORSE_ROLE_BY_ID.mimir;
    const cleanTool = String(toolName || '').trim();
    const argPreview = this.#redactArgs(args);

    validateContract('ToolRequest', {
      id: `req-${crypto.randomUUID().slice(0, 8)}`,
      runId,
      agentId: role.id,
      toolName: cleanTool || 'unknown',
      arguments: typeof args === 'object' && args ? args : {},
      requestedAt: new Date().toISOString(),
    });

    const finalize = (decision, policyRuleId, reason, riskTier = 'guarded') => {
      const audit = this.recordAuditEvent({
        kind: 'tool_request',
        runId,
        agentId: role.id,
        toolName: cleanTool,
        decision,
        policyRuleId,
        reason,
        riskTier,
        argPreview,
      });
      return { decision, policyRuleId, reason, riskTier, auditId: audit.id, roleId: role.id };
    };

    // 1. Explicit denied tools per role capability profile (enforced outside prompts)
    if ((role.deniedTools || []).includes(cleanTool)) {
      return finalize('DENY', 'SENTINEL_ROLE_DENY_LIST', `Role "${role.name}" is prohibited from calling "${cleanTool}".`, 'critical');
    }

    // 2. Enforce role allowlist when calling Norse specialists or explicit non-legacy tools
    if (bot?.norseRoleId && role.allowedTools && !role.allowedTools.includes(cleanTool) && !cleanTool.startsWith('mcp_')) {
      return finalize('DENY', 'SENTINEL_CAPABILITY_SCOPE', `Tool "${cleanTool}" is outside "${role.name}" capability profile (${role.allowedTools.join(', ')}).`, 'high');
    }

    // 3. Block sensitive credential/vault paths or secret dumping
    const serializedArgs = JSON.stringify(args || {});
    if (SENSITIVE_PATH_RE.test(serializedArgs)) {
      return finalize('DENY', 'SENTINEL_SECRET_BOUNDARY', 'Access to raw Vault, SSH keys, or .env secret files is blocked by Sentinel.', 'critical');
    }

    // 4. Block cloud metadata SSRF targets
    const targetUrl = String(args?.url || args?.href || '');
    if (targetUrl && PRIVATE_METADATA_IP_RE.test(targetUrl)) {
      return finalize('DENY', 'SENTINEL_SSRF_METADATA', `Cloud metadata URL blocked: ${targetUrl}`, 'critical');
    }

    // 5. Block local-only outbound network violations
    if (localOnly && ['web_search', 'web_fetch', 'browser_open', 'browser_search', 'browser_fetch', 'browser_navigate', 'browser_act'].includes(cleanTool)) {
      const isLoopback = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(targetUrl);
      if (targetUrl && !isLoopback) {
        return finalize('DENY', 'SENTINEL_LOCAL_ONLY', `External URL "${targetUrl}" blocked while Local-Only mode is active.`, 'high');
      }
      if (!targetUrl && (cleanTool === 'web_search' || cleanTool === 'browser_search')) {
        return finalize('DENY', 'SENTINEL_LOCAL_ONLY', 'Public web search blocked while Local-Only mode is active.', 'high');
      }
    }

    // 6. Inspect arguments for prompt-injection / exfiltration patterns
    const argThreat = this.inspectTextForThreats(serializedArgs);
    if (argThreat.suspicious) {
      return finalize('DENY', 'SENTINEL_INJECTION_SHIELD', 'Blocked suspicious exfiltration or instruction-override payload in tool arguments.', 'critical');
    }

    // 7. Destructive shell commands always require explicit approval (or deny in read-only mode)
    const cmdText = String(args?.command || args?.cmd || '');
    if (cleanTool === 'shell_exec' && DESTRUCTIVE_SHELL_RE.test(cmdText)) {
      if (!approved) {
        return finalize('REQUIRE_APPROVAL', 'SENTINEL_DESTRUCTIVE_SHELL', `Destructive shell command requires explicit user approval: ${cmdText.slice(0, 80)}`, 'critical');
      }
    }

    // 8. Check standard approval classifier
    const effectivePolicy = approvalPolicy || (['ask-writes', 'always-ask', 'reversibility', 'auto-approve'].includes(executionMode) ? executionMode : 'auto-approve');
    const baseApproval = classifyToolApproval(cleanTool, args, effectivePolicy, { bot });
    if (baseApproval?.needsApproval && !approved) {
      return finalize('REQUIRE_APPROVAL', 'SENTINEL_ACTION_APPROVAL', baseApproval.reason || `Tool "${cleanTool}" requires user approval.`, baseApproval.tier || 'high');
    }

    return finalize('ALLOW', 'SENTINEL_POLICY_PASS', `Authorized "${cleanTool}" under role "${role.name}".`, baseApproval?.tier || 'safe');
  }

  evaluateUiAction({ actionId = '', payload = {}, surface = 'chat', approved = false, roleId = 'mimir' } = {}) {
    const allowedActions = new Set([
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
    const cleanAction = String(actionId || '').trim();
    if (!allowedActions.has(cleanAction)) {
      const audit = this.recordAuditEvent({
        kind: 'ui_action',
        agentId: roleId,
        actionId: cleanAction,
        surface,
        decision: 'DENY',
        policyRuleId: 'SENTINEL_UNREGISTERED_UI_ACTION',
        reason: `Unregistered UI action "${cleanAction}" rejected.`,
        riskTier: 'high',
      });
      return { decision: 'DENY', reason: audit.reason, policyRuleId: audit.policyRuleId, auditId: audit.id };
    }

    const threat = this.inspectTextForThreats(JSON.stringify(payload || {}));
    if (threat.suspicious) {
      const audit = this.recordAuditEvent({
        kind: 'ui_action',
        agentId: roleId,
        actionId: cleanAction,
        surface,
        decision: 'DENY',
        policyRuleId: 'SENTINEL_UI_PAYLOAD_THREAT',
        reason: 'Suspicious payload rejected by Sentinel UI action gateway.',
        riskTier: 'critical',
      });
      return { decision: 'DENY', reason: audit.reason, policyRuleId: audit.policyRuleId, auditId: audit.id };
    }

    if (cleanAction === 'submit_form' && payload?.requiresApproval === true && !approved) {
      const audit = this.recordAuditEvent({
        kind: 'ui_action',
        agentId: roleId,
        actionId: cleanAction,
        surface,
        decision: 'REQUIRE_APPROVAL',
        policyRuleId: 'SENTINEL_FORM_APPROVAL',
        reason: 'Sensitive form action requires explicit user confirmation.',
        riskTier: 'high',
      });
      return { decision: 'REQUIRE_APPROVAL', reason: audit.reason, policyRuleId: audit.policyRuleId, auditId: audit.id };
    }

    const audit = this.recordAuditEvent({
      kind: 'ui_action',
      agentId: roleId,
      actionId: cleanAction,
      surface,
      decision: 'ALLOW',
      policyRuleId: 'SENTINEL_UI_ACTION_ALLOW',
      reason: `Authorized UI action "${cleanAction}" on "${surface}".`,
      riskTier: 'safe',
    });
    return { decision: 'ALLOW', reason: audit.reason, policyRuleId: audit.policyRuleId, auditId: audit.id };
  }

  listAuditEvents(limit = 50) {
    return this.events.slice(-Math.max(1, Math.min(250, Number(limit) || 50))).reverse();
  }

  getStats() {
    let allowed = 0;
    let denied = 0;
    let approvalRequired = 0;
    for (const ev of this.events) {
      if (ev.decision === 'ALLOW') allowed += 1;
      else if (ev.decision === 'DENY') denied += 1;
      else if (ev.decision === 'REQUIRE_APPROVAL') approvalRequired += 1;
    }
    return { total: this.events.length, allowed, denied, approvalRequired };
  }
}
