import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';

function inferLanguage(path = '', explicitLang = '', content = '') {
  const cleanLang = String(explicitLang || '').trim().toLowerCase();
  if (cleanLang) return cleanLang;
  const lowerPath = String(path || '').trim().toLowerCase();
  const ext = lowerPath.includes('.') ? lowerPath.split('.').pop() : '';
  if (ext === 'htm' || ext === 'html') return 'html';
  if (ext === 'svg') return 'svg';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'py') return 'python';
  const trimmed = String(content || '').trim().toLowerCase();
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) return 'html';
  if (trimmed.startsWith('<svg')) return 'svg';
  return 'text';
}

function defaultPathForLanguage(lang) {
  switch (lang) {
    case 'html':
      return 'scratch/preview.html';
    case 'svg':
      return 'scratch/graphic.svg';
    case 'markdown':
    case 'md':
      return 'scratch/notes.md';
    case 'javascript':
    case 'js':
      return 'scratch/script.js';
    case 'jsx':
      return 'scratch/component.jsx';
    case 'python':
    case 'py':
      return 'scratch/script.py';
    case 'json':
      return 'scratch/data.json';
    case 'css':
      return 'scratch/styles.css';
    default:
      return 'scratch/canvas.txt';
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(raw) {
  let out = escapeHtml(raw);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

function renderMarkdownDocument(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const htmlParts = [];
  let inCode = false;
  let codeLines = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeList();
      if (inCode) {
        htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }
    if (trimmed.startsWith('> ')) {
      closeList();
      htmlParts.push(`<blockquote>${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      htmlParts.push(`<li>${formatInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }
    closeList();
    htmlParts.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }
  closeList();
  if (inCode) {
    htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body {
    margin: 0;
    padding: 18px 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #181611;
    background: #faf7f0;
  }
  h1, h2, h3, h4 { margin: 1.1em 0 0.45em; line-height: 1.25; }
  h1:first-child, h2:first-child { margin-top: 0; }
  p { margin: 0 0 0.8em; }
  ul { margin: 0 0 0.9em; padding-left: 1.4em; }
  li { margin: 0.25em 0; }
  blockquote { margin: 0 0 0.9em; padding: 6px 12px; border-left: 3px solid #91610e; background: #efe9dc; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: #ece5d6; padding: 1px 4px; border-radius: 3px; }
  pre { background: #141c27; color: #e5edf4; padding: 12px; border-radius: 6px; overflow: auto; }
  pre code { background: transparent; padding: 0; color: inherit; }
  a { color: #0f5482; }
</style>
</head>
<body>${htmlParts.join('\n')}</body>
</html>`;
}

function buildPreviewSrcDoc(content, lang) {
  if (lang === 'html' || lang === 'htm') {
    const raw = String(content || '');
    if (/<html[\s>]/i.test(raw)) return raw;
    return `<!doctype html><html><head><meta charset="utf-8" /></head><body>${raw}</body></html>`;
  }
  if (lang === 'svg') {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #f5efe2; display: flex; align-items: center; justify-content: center; overflow: auto; }
  svg { max-width: 96%; max-height: 96%; }
</style>
</head>
<body>${String(content || '')}</body>
</html>`;
  }
  if (lang === 'markdown' || lang === 'md') {
    return renderMarkdownDocument(content);
  }
  return '';
}

export function CanvasPane({ botId, threadId = null, fileTarget = null, onSaved }) {
  const [filePath, setFilePath] = useState('');
  const [language, setLanguage] = useState('text');
  const [content, setContent] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [viewMode, setViewMode] = useState('code'); // code | preview
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revising, setRevising] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [instruction, setInstruction] = useState('');
  const [pendingRevision, setPendingRevision] = useState(null);
  const [undoContent, setUndoContent] = useState(null);

  useEffect(() => {
    if (!fileTarget) return;
    let cancelled = false;
    setError('');
    setNotice('');
    setPendingRevision(null);
    setUndoContent(null);

    const applyLoaded = (loadedPath, loadedContent, explicitLang = '') => {
      const lang = inferLanguage(loadedPath, explicitLang, loadedContent);
      setFilePath(loadedPath || defaultPathForLanguage(lang));
      setLanguage(lang);
      setContent(loadedContent);
      setSavedSnapshot(loadedContent);
      if (['html', 'htm', 'svg', 'markdown', 'md'].includes(lang) && !fileTarget.preferCode) {
        setViewMode('preview');
      } else {
        setViewMode('code');
      }
    };

    if (typeof fileTarget.content === 'string') {
      applyLoaded(fileTarget.path || '', fileTarget.content, fileTarget.language || '');
      return undefined;
    }

    if (fileTarget.path && botId) {
      setLoading(true);
      apiFetch(`/v1/workspace/${encodeURIComponent(botId)}/file?path=${encodeURIComponent(fileTarget.path)}`)
        .then(res => {
          if (cancelled) return;
          const loadedContent = typeof res?.content === 'string' ? res.content : '';
          applyLoaded(res?.path || fileTarget.path, loadedContent, fileTarget.language || '');
        })
        .catch(err => {
          if (cancelled) return;
          setError(err?.message || `Could not open ${fileTarget.path}.`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [botId, fileTarget]);

  const effectiveLanguage = useMemo(
    () => inferLanguage(filePath, language, content),
    [filePath, language, content]
  );
  const isPreviewable = ['html', 'htm', 'svg', 'markdown', 'md'].includes(effectiveLanguage);
  const isDirty = content !== savedSnapshot;
  const lineCount = useMemo(() => (content ? content.split(/\r?\n/).length : 0), [content]);

  const previewSrcDoc = useMemo(() => {
    if (!isPreviewable || viewMode !== 'preview') return '';
    return buildPreviewSrcDoc(content, effectiveLanguage);
  }, [content, effectiveLanguage, isPreviewable, viewMode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard copy was blocked by the browser.');
    }
  };

  const handleSave = async () => {
    const cleanPath = filePath.trim() || defaultPathForLanguage(effectiveLanguage);
    if (!botId || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch(`/v1/workspace/${encodeURIComponent(botId)}/file`, {
        method: 'PUT',
        body: JSON.stringify({
          path: cleanPath,
          content,
          ...(threadId ? { threadId } : {}),
        }),
      });
      setFilePath(res?.path || cleanPath);
      setSavedSnapshot(content);
      setNotice(`Saved to ${res?.path || cleanPath}`);
      await onSaved?.();
    } catch (err) {
      setError(err?.message || 'Could not save file to workspace.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async e => {
    e.preventDefault();
    const cleanInstruction = instruction.trim();
    if (!cleanInstruction || !botId || revising) return;
    setRevising(true);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch('/v1/canvas/edit', {
        method: 'POST',
        body: JSON.stringify({
          botId,
          ...(threadId ? { threadId } : {}),
          ...(filePath.trim() ? { path: filePath.trim() } : {}),
          content,
          instruction: cleanInstruction,
        }),
      });
      const updated = typeof res?.updatedContent === 'string' ? res.updatedContent : content;
      setPendingRevision({
        updatedContent: updated,
        previousContent: content,
        diffSummary: res?.diffSummary || 'Suggested revision ready to review.',
        hunks: Array.isArray(res?.hunks) ? res.hunks : [],
      });
      setInstruction('');
    } catch (err) {
      setError(err?.message || 'Could not generate a revision for this file.');
    } finally {
      setRevising(false);
    }
  };

  const applyPendingRevision = () => {
    if (!pendingRevision) return;
    setUndoContent(content);
    setContent(pendingRevision.updatedContent);
    setPendingRevision(null);
    setNotice('Applied suggested revision. Save to write it to disk.');
  };

  const handleUndo = () => {
    if (undoContent === null) return;
    setContent(undoContent);
    setUndoContent(null);
    setNotice('Reverted the last revision.');
  };

  const createBlankDraft = kind => {
    setError('');
    setNotice('');
    setPendingRevision(null);
    setUndoContent(null);
    if (kind === 'html') {
      setFilePath('scratch/prototype.html');
      setLanguage('html');
      const starter = '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8" />\n  <style>\n    body { font-family: system-ui, sans-serif; padding: 24px; background: #faf7f0; color: #181611; }\n  </style>\n</head>\n<body>\n  <h1>Workspace Prototype</h1>\n  <p>Edit this HTML or ask Mimir to revise it below.</p>\n</body>\n</html>\n';
      setContent(starter);
      setSavedSnapshot('');
      setViewMode('preview');
    } else {
      setFilePath('scratch/notes.md');
      setLanguage('markdown');
      const starter = '# Workspace Note\n\nWrite markdown here, or open any file from the Files tab.\n';
      setContent(starter);
      setSavedSnapshot('');
      setViewMode('code');
    }
  };

  if (!fileTarget && !filePath && !content && !loading) {
    return (
      <div className="canvas-pane" data-testid="canvas-pane">
        <div className="card" style={{ padding: 16, gap: 10 }}>
          <strong style={{ fontSize: 13 }}>Canvas workbench</strong>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)' }}>
            Open a file from the Files tab, click Open in Canvas on any code block in chat, or start a fresh draft here.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" data-testid="canvas-new-md-btn" onClick={() => createBlankDraft('md')}>
              New Markdown note
            </button>
            <button type="button" className="btn btn-sm" data-testid="canvas-new-html-btn" onClick={() => createBlankDraft('html')}>
              New HTML prototype
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-pane" data-testid="canvas-pane">
      <div className="canvas-toolbar">
        <input
          type="text"
          className="input"
          data-testid="canvas-path-input"
          aria-label="Workspace file path"
          placeholder="scratch/draft.txt"
          value={filePath}
          onChange={e => {
            setFilePath(e.target.value);
            setLanguage('');
          }}
          style={{ flex: '1 1 140px', minWidth: 0, fontFamily: 'var(--sand-mono)', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'code' ? 'btn-primary' : ''}`}
            data-testid="canvas-mode-code"
            aria-pressed={viewMode === 'code'}
            onClick={() => setViewMode('code')}
          >
            Code
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'preview' ? 'btn-primary' : ''}`}
            data-testid="canvas-mode-preview"
            aria-pressed={viewMode === 'preview'}
            disabled={!isPreviewable}
            title={isPreviewable ? 'Render live preview' : 'Preview supports HTML, SVG, and Markdown'}
            onClick={() => setViewMode('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="canvas-copy-btn"
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            data-testid="canvas-save-btn"
            disabled={saving || loading || !botId}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : isDirty ? 'Save*' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--ink-subtle)', gap: 8, flexWrap: 'wrap' }}>
        <span>
          {effectiveLanguage.toUpperCase()} · {lineCount} line{lineCount === 1 ? '' : 's'}
          {isDirty ? ' · Unsaved changes' : ''}
        </span>
        {undoContent !== null && (
          <button type="button" className="btn btn-sm" data-testid="canvas-undo-btn" onClick={handleUndo}>
            Undo revision
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert" data-testid="canvas-error-banner">
          {error}
        </div>
      )}

      {notice && !error && (
        <div style={{ fontSize: 11.5, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }} role="status" data-testid="canvas-notice">
          {notice}
        </div>
      )}

      {pendingRevision && (
        <div className="canvas-diff-banner" data-testid="canvas-diff-banner" role="status">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>Suggested revision</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-primary btn-sm" data-testid="canvas-apply-diff-btn" onClick={applyPendingRevision}>
                Apply
              </button>
              <button type="button" className="btn btn-sm" data-testid="canvas-discard-diff-btn" onClick={() => setPendingRevision(null)}>
                Undo
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{pendingRevision.diffSummary}</div>
        </div>
      )}

      {loading ? (
        <div className="card" role="status" aria-live="polite" style={{ padding: 14, fontSize: 12.5, color: 'var(--ink-muted)' }}>
          Loading file from workspace...
        </div>
      ) : viewMode === 'preview' && isPreviewable ? (
        <iframe
          className="canvas-preview-frame"
          data-testid="canvas-preview-frame"
          title={`Live preview for ${filePath || 'Canvas'}`}
          sandbox="allow-scripts"
          srcDoc={previewSrcDoc}
        />
      ) : (
        <textarea
          className="canvas-editor"
          data-testid="canvas-editor"
          aria-label="Canvas file editor"
          spellCheck={false}
          value={content}
          onChange={e => setContent(e.target.value)}
        />
      )}

      <form className="canvas-ai-bar" onSubmit={handleRevise}>
        <input
          type="text"
          className="input"
          data-testid="canvas-revise-input"
          aria-label="Ask Mimir to revise this file"
          placeholder="Ask Mimir to revise (e.g. simplify layout or add comments)..."
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          data-testid="canvas-revise-btn"
          disabled={revising || loading || !instruction.trim()}
        >
          {revising ? 'Revising...' : 'Revise'}
        </button>
      </form>
    </div>
  );
}
