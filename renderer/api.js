const STORAGE_KEY = 'mimir.pairedRuntime';
let cachedConfig = null;

export function isLoopbackRuntimeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return /^https?:$/i.test(u.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function readStoredSession() {
  try {
    const raw = window.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.url || !isLoopbackRuntimeUrl(parsed.url)) return null;
    if (parsed.expiresAt && Date.now() >= Number(parsed.expiresAt)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCoordinatorSession() {
  cachedConfig = null;
  try {
    window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {}
}

export function setCoordinatorConnection({ url, token = '', expiresAt = null, clientName = '', mode = 'paired' }) {
  const cleanUrl = String(url || '').replace(/\/+$/, '');
  if (!isLoopbackRuntimeUrl(cleanUrl)) {
    throw new Error('Runtime URL must point to http://127.0.0.1:<port> or http://localhost:<port>.');
  }
  const payload = { url: cleanUrl, token: String(token || ''), expiresAt, clientName, mode };
  cachedConfig = { url: payload.url, token: payload.token };
  try {
    window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  return payload;
}

export function getRuntimeEnvironment() {
  if (typeof window === 'undefined') return { isElectron: false, isPublicWeb: false, hasStoredSession: false };
  const isElectron = Boolean(window.desktop?.getCoordinator);
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  const isLoopbackPage = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(host) || proto === 'file:';
  return {
    isElectron,
    isLoopbackPage,
    isPublicWeb: !isElectron && !isLoopbackPage && proto === 'https:',
    hasStoredSession: Boolean(readStoredSession()),
  };
}

export async function probeCoordinatorHealth(url = 'http://127.0.0.1:4567') {
  const cleanUrl = String(url || '').replace(/\/+$/, '');
  if (!isLoopbackRuntimeUrl(cleanUrl)) {
    return { reachable: false, error: 'Runtime URL must use localhost or 127.0.0.1.' };
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), 3000);
  try {
    const res = await fetch(`${cleanUrl}/v1/health`, {
      signal: ctrl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { reachable: false, status: res.status, error: data.error || `HTTP ${res.status}` };
    }
    return { reachable: true, url: cleanUrl, ...data };
  } catch (err) {
    return { reachable: false, error: err?.name === 'AbortError' ? 'Connection timed out' : (err?.message || 'Coordinator unreachable') };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestPairingCode(url = 'http://127.0.0.1:4567', clientName = 'Mimir Web Workspace') {
  const cleanUrl = String(url || '').replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/v1/pairing/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Pairing request failed (${res.status})`), { status: res.status, code: data.code });
  }
  return data;
}

export async function exchangePairingCode(url = 'http://127.0.0.1:4567', { code, requestId, clientName = 'Mimir Web Workspace' }) {
  const cleanUrl = String(url || '').replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/v1/pairing/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, requestId, clientName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Pairing exchange failed (${res.status})`), { status: res.status, code: data.code });
  }
  return setCoordinatorConnection({
    url: cleanUrl,
    token: data.sessionToken,
    expiresAt: data.expiresAt || null,
    clientName: data.clientName || clientName,
    mode: 'paired',
  });
}

export async function resolveCoordinator() {
  if (window.desktop?.getCoordinator) {
    const info = await window.desktop.getCoordinator();
    cachedConfig = { url: info.url.replace(/\/+$/, ''), token: info.token || '' };
    return cachedConfig;
  }

  const stored = readStoredSession();
  if (stored) {
    cachedConfig = { url: stored.url, token: stored.token || '' };
    return cachedConfig;
  }

  if (cachedConfig) return cachedConfig;

  const params = new URLSearchParams(window.location.search);
  // Never ingest or keep bearer tokens in URL query strings.
  if (params.has('token') && typeof window.history?.replaceState === 'function') {
    params.delete('token');
    const cleanSearch = params.toString();
    const cleanHref = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(null, '', cleanHref);
  }

  const queryUrl = params.get('coordinator');
  if (queryUrl && isLoopbackRuntimeUrl(queryUrl)) {
    cachedConfig = { url: queryUrl.replace(/\/+$/, ''), token: '' };
    return cachedConfig;
  }

  const devPort = params.get('port') || '4567';
  cachedConfig = { url: `http://127.0.0.1:${devPort}`, token: '' };
  return cachedConfig;
}

export async function apiFetch(path, options = {}) {
  const cfg = await resolveCoordinator();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

  let res;
  try {
    res = await fetch(`${cfg.url}${path}`, { ...options, headers });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    const err = new Error("Can't reach Mimir's background service. Make sure Mimir is running; this retries on its own.", { cause });
    err.code = 'OFFLINE';
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      clearCoordinatorSession();
      window.dispatchEvent(new CustomEvent('mimir:auth-required', {
        detail: { status: 401, code: data?.code || 'UNAUTHORIZED', error: data?.error || 'Unauthorized' },
      }));
    }
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export async function getArtifactPreview(id) {
  return apiFetch(`/v1/artifacts/${encodeURIComponent(id)}/preview-data`);
}

export async function fetchArtifactBlob(id, query = 'inline=1') {
  const cfg = await resolveCoordinator();
  const headers = {};
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const qs = query ? `?${query}` : '';
  const res = await fetch(`${cfg.url}/v1/artifacts/${encodeURIComponent(id)}/download${qs}`, { headers });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      clearCoordinatorSession();
      window.dispatchEvent(new CustomEvent('mimir:auth-required', {
        detail: { status: 401, code: 'SESSION_EXPIRED', error: 'Artifact download unauthorized or session expired.' },
      }));
    }
    throw new Error(`Artifact download failed (HTTP ${res.status})`);
  }
  return res.blob();
}

export function subscribeEvents(onMessage, onStatusChange) {
  let ws = null;
  let closed = false;
  let retryTimer = null;
  let retryDelayMs = 1000;

  const connect = async () => {
    if (closed) return;
    onStatusChange?.('connecting');
    try {
      const cfg = await resolveCoordinator();
      const wsUrl = cfg.url.replace(/^http/, 'ws') + '/ws' + (cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : '');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        retryDelayMs = 1000;
        onStatusChange?.('connected');
      };
      ws.onmessage = evt => {
        try {
          onMessage(JSON.parse(evt.data));
        } catch {}
      };
      ws.onclose = () => {
        if (!closed) {
          onStatusChange?.('reconnecting');
          const wait = retryDelayMs;
          retryDelayMs = Math.min(8000, Math.round(retryDelayMs * 1.6));
          retryTimer = setTimeout(connect, wait);
        }
      };
    } catch {
      if (!closed) {
        onStatusChange?.('reconnecting');
        const wait = retryDelayMs;
        retryDelayMs = Math.min(8000, Math.round(retryDelayMs * 1.6));
        retryTimer = setTimeout(connect, wait);
      }
    }
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retryTimer);
    ws?.close();
  };
}

export function playSoftCue(kind = 'done') {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'alert' ? 520 : 660;
    gain.gain.setValueAtTime(0.03, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

export function isFileDragEvent(evt) {
  const types = evt?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/** Encode dropped, pasted, or picked File objects into base64 payloads for /stage-file. */
export async function encodeFilesForStaging(fileList, { maxFiles = 6, maxBytes = 5 * 1024 * 1024 } = {}) {
  const all = Array.from(fileList || []).filter(Boolean);
  const skipped = [];
  const eligible = [];
  for (const file of all) {
    if (eligible.length >= maxFiles) {
      skipped.push(`${file.name} (max ${maxFiles} files per drop)`);
      continue;
    }
    if (typeof file.size === 'number' && file.size > maxBytes) {
      skipped.push(`${file.name} (> ${Math.round(maxBytes / (1024 * 1024))} MB limit)`);
      continue;
    }
    eligible.push(file);
  }
  const encoded = await Promise.all(
    eligible.map(
      f =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = String(reader.result || '').split(',')[1] || '';
            resolve({ name: f.name || 'dropped-file.bin', size: f.size || 0, contentBase64: b64 });
          };
          reader.onerror = () => reject(new Error(`Failed reading ${f.name || 'file'}`));
          reader.readAsDataURL(f);
        })
    )
  );
  return { encoded, skipped };
}
