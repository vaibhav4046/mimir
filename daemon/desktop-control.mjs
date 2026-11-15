import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolvePythonExe } from './foundry.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CTRL_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'desktop_ctrl.py');

const WRITE_DESKTOP_ACTIONS = new Set(['click', 'type', 'hotkey', 'focus_window']);

export const DESKTOP_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'desktop_control',
    description:
      'Inspect or interact with the user’s Own Computer Windows desktop (list_windows, screenshot, focus_window, click, type). Write actions always require approval. Returns structured HEADLESS_SESSION notice when running inside a headless background daemon.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_windows', 'screenshot', 'focus_window', 'click', 'type'],
        },
        hwnd: { type: 'number', description: 'Target window handle from list_windows' },
        x: { type: 'number', description: 'Screen X pixel coordinate for click' },
        y: { type: 'number', description: 'Screen Y pixel coordinate for click' },
        text: { type: 'string', description: 'Keystrokes for type action' },
      },
      required: ['action'],
    },
  },
};

export function classifyDesktopApproval(args = {}, approvalPolicy = 'ask-writes') {
  if (approvalPolicy === 'auto-approve') {
    return { needsApproval: false, reason: '' };
  }
  const action = String(args.action || 'list_windows');
  if (approvalPolicy === 'always-ask' || WRITE_DESKTOP_ACTIONS.has(action)) {
    return {
      needsApproval: true,
      reason: `Own-Computer desktop control "${action}" requires explicit confirmation`,
      cardTitle: `Own Computer · ${action}`,
      cardSubtitle: action === 'type' ? `Type ${String(args.text || '').length} chars` : `Coords/Window target`,
      primaryLabel: 'Allow Action',
      secondaryLabel: 'Deny',
    };
  }
  return { needsApproval: false, reason: '' };
}

export async function runDesktopAction(args = {}) {
  const pythonExe = resolvePythonExe();
  const cmdArgs = [CTRL_SCRIPT, '--action', String(args.action || 'list_windows')];
  if (args.hwnd !== undefined) cmdArgs.push('--hwnd', String(Number(args.hwnd) || 0));
  if (args.x !== undefined) cmdArgs.push('--x', String(Math.round(Number(args.x) || 0)));
  if (args.y !== undefined) cmdArgs.push('--y', String(Math.round(Number(args.y) || 0)));
  if (args.text !== undefined) cmdArgs.push('--text', String(args.text));

  const { stdout } = await execFileAsync(pythonExe, cmdArgs, {
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const line = String(stdout || '{}').trim().split(/\r?\n/).pop() || '{}';
  return JSON.parse(line);
}
