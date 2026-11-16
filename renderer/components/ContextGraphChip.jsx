import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

/** Header chip: shows what the HydraDB tool memory did for the latest request. Renders nothing while it is off. */
export function ContextGraphChip() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await apiFetch('/v1/context-graph/status');
        if (alive) setStatus(s);
      } catch {
        if (alive) setStatus(null);
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!status?.enabled) return null;
  const pull = status.lastPull;
  const text = pull && !pull.error && pull.pulled != null ? `Tool memory: ${pull.pulled} of ${pull.of} tools` : status.connected ? 'Tool memory: ready' : 'Tool memory: connecting';
  return (
    <span
      className="chat-session-chip"
      data-testid="context-graph-chip"
      title={pull?.tools?.length ? `HydraDB offered: ${pull.tools.join(', ')}` : 'Tool memory on a local HydraDB graph'}
      style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line, #2a3a44)', color: 'var(--frost-hi, #a9eeff)' }}
    >
      {text}
    </span>
  );
}
