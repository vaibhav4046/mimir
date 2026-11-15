import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, resolveCoordinator } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';
import { CreativeStudioPlayer } from './CreativeStudioPlayer.jsx';

const LIB_TABS = [
  { id: 'all', label: 'All' },
  { id: '3d', label: '3D models' },
  { id: 'images', label: 'Pictures' },
  { id: 'videos', label: 'Videos' },
  { id: 'webapps', label: 'Apps' },
  { id: 'games', label: 'Games' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'folders', label: 'Folders' },
  { id: 'suggested', label: 'Suggested' },
];

const STUDIO_PRESETS = [
  {
    id: '3d',
    testId: 'preset-forge-3d',
    label: '3D spaceship',
    title: 'Valkyrie Starfighter MK-IV',
    format: 'glb',
    prompt: 'Create a metallic cyber starfighter 3D mesh with twin delta wings, thrusters, and cockpit canopy',
    creative: { archetype: 'starfighter', theme: 'cyber' },
  },
  {
    id: 'image',
    testId: 'preset-forge-image',
    label: 'Picture',
    title: 'Cosmic Odin Observatory',
    format: 'png',
    prompt: 'Render a luminous Norse cosmic observatory illustration with orbital rings and nebula glow',
    creative: { archetype: 'citadel', theme: 'norse' },
  },
  {
    id: 'video',
    testId: 'preset-forge-video',
    label: 'Short video',
    title: 'Hyperdrive Reactor Loop',
    format: 'webm',
    prompt: 'Animate a smooth orbital octahedron reactor pulse motion video loop with cyber neon rings',
    creative: { archetype: 'cosmic-crystal', theme: 'cyber' },
  },
  {
    id: 'webapp',
    testId: 'preset-forge-webapp',
    label: 'Web app',
    title: 'Valhalla Ops Command Center',
    format: 'webapp',
    prompt: 'Build an interactive FastAPI and JS operational command web app with live item tracking and Docker config',
    creative: { theme: 'norse' },
  },
  {
    id: 'game',
    testId: 'preset-forge-game',
    label: 'Game',
    title: 'Galactic Star Defender',
    format: 'game',
    prompt: 'Create a playable 60fps HTML5 canvas space shooter arcade game with enemy waves and laser cannons',
    creative: { gameGenre: 'space-shooter', theme: 'cyber' },
  },
];

const FORMAT_ASSET = {
  pdf: 'codex',
  docx: 'scroll',
  pptx: 'runestone',
  xlsx: 'scroll',
  csv: 'scroll',
  zip: 'forge-anvil',
  webapp: 'forge-anvil',
  game: 'forge-anvil',
  glb: 'runestone',
  obj: 'runestone',
  stl: 'runestone',
  webm: 'odin-eye',
  mp4: 'odin-eye',
  gif: 'odin-eye',
  png: 'odin-eye',
  svg: 'odin-eye',
};

function AuthArtifactImg({ url, token, alt }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    if (!token || !url) { setBlobUrl(''); return; }
    let active = true;
    let created = '';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => {
        if (!b || !active) return;
        created = URL.createObjectURL(b);
        setBlobUrl(created);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, token]);
  const resolved = token ? blobUrl : url;
  if (!resolved) return <MimirAsset category="artifacts" name="codex" size={44} />;
  return <img src={resolved} alt={alt} />;
}

export function LibraryView({ activeBotId }) {
  const [coordUrl, setCoordUrl] = useState('');
  const [coordToken, setCoordToken] = useState('');
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // grid | list
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeStudioArtifact, setActiveStudioArtifact] = useState(null);
  const [studioPrompt, setStudioPrompt] = useState('');
  const [studioFormat, setStudioFormat] = useState('glb');
  const [forgingPreset, setForgingPreset] = useState('');
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    format: 'pdf',
    folder: 'Reports',
    sectionsText: 'Executive Summary\nKey Findings\nNext Actions',
    rowsText: 'Item,Owner,Status\nRust Core WAL,Mimir,Active',
  });
  const dialogRef = useRef(null);

  const load = async () => {
    setErr('');
    try {
      const cfg = await resolveCoordinator();
      setCoordUrl(cfg.url);
      setCoordToken(cfg.token || '');
      const data = await apiFetch('/v1/library/artifacts');
      setArtifacts(data?.artifacts || []);
    } catch (e) {
      setErr(e.message || 'Could not load your files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const folders = useMemo(
    () => Array.from(new Set(artifacts.map(a => a.folder || 'General'))).sort(),
    [artifacts]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return artifacts.filter(a => {
      const fmt = String(a.format || '').toLowerCase();
      if (tab === 'favorites' && !a.favorite) return false;
      if (tab === '3d' && !['glb', 'obj', 'stl'].includes(fmt)) return false;
      if (tab === 'images' && fmt !== 'png' && fmt !== 'svg') return false;
      if (tab === 'videos' && !['webm', 'mp4', 'gif'].includes(fmt)) return false;
      if (tab === 'webapps' && fmt !== 'webapp') return false;
      if (tab === 'games' && fmt !== 'game') return false;
      if (tab === 'folders' && activeFolder && (a.folder || 'General') !== activeFolder) return false;
      if (tab === 'suggested' && !a.favorite && fmt !== 'pdf' && fmt !== 'svg' && fmt !== 'pptx' && fmt !== 'glb' && fmt !== 'game') {
        if (artifacts.length > 6) return false;
      }
      if (q) {
        const hay = `${a.title || ''} ${a.subtitle || ''} ${a.folder || ''} ${fmt}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [artifacts, tab, search, activeFolder]);

  const forgeWithStudio = async ({ title = '', prompt = '', format = 'glb', creative = null, presetId = 'custom' }) => {
    setErr('');
    setForgingPreset(presetId);
    try {
      const created = await apiFetch('/v1/library/create', {
        method: 'POST',
        body: JSON.stringify({
          title,
          prompt,
          format,
          creative,
          botId: activeBotId || 'bot-grok-default',
        }),
      });
      await load();
      if (created?.id) setActiveStudioArtifact(created);
      if (presetId === 'custom') setStudioPrompt('');
    } catch (e2) {
      setErr(e2.message || 'Could not make that. Please try again.');
    } finally {
      setForgingPreset('');
    }
  };

  const handleCreate = async e => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setErr('');
    try {
      const sections = form.sectionsText
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map((heading, idx) => ({ heading: `Section ${idx + 1}`, body: heading }));
      const rows = form.rowsText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.split(',').map(c => c.trim()));
      const created = await apiFetch('/v1/library/create', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          subtitle: form.subtitle.trim(),
          prompt: form.subtitle.trim() || form.title.trim(),
          format: form.format,
          folder: form.folder.trim() || undefined,
          sections,
          rows,
          botId: activeBotId || 'bot-grok-default',
        }),
      });
      dialogRef.current?.close();
      setForm(f => ({ ...f, title: '', subtitle: '' }));
      await load();
      if (created?.id) setActiveStudioArtifact(created);
    } catch (e2) {
      setErr(e2.message || 'Could not make that file. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const toggleFavorite = async art => {
    await apiFetch(`/v1/library/artifacts/${encodeURIComponent(art.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite: !art.favorite }),
    });
    await load();
  };

  const removeArtifact = async id => {
    await apiFetch(`/v1/library/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="view-scroll" data-testid="library-view">
      <div className="view-container library-shell">
        <div className="library-toolbar">
          <div>
            <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MimirAsset category="artifacts" name="codex" size={22} />
              <span>Your files</span>
            </h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>
              Everything Mimir has made for you: documents, pictures, videos, 3D models, apps and games.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="search"
              className="input"
              data-testid="library-search"
              placeholder="Search your files..."
              aria-label="Search your files"
              style={{ width: 200 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}`}
              data-testid="library-view-grid"
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : ''}`}
              data-testid="library-view-list"
              onClick={() => setViewMode('list')}
            >
              List
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="library-new-btn"
              onClick={() => dialogRef.current?.showModal()}
            >
              + Make something
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {LIB_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              data-testid={`library-tab-${t.id}`}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`}
              onClick={() => {
                setTab(t.id);
                if (t.id !== 'folders') setActiveFolder('');
              }}
            >
              {t.label}
            </button>
          ))}
          {tab === 'folders' && folders.map(fl => (
            <button
              key={fl}
              type="button"
              className={`btn btn-sm ${activeFolder === fl ? 'btn-primary' : ''}`}
              onClick={() => setActiveFolder(prev => (prev === fl ? '' : fl))}
            >
              {fl}
            </button>
          ))}
        </div>

        {err && <div className="tool-card is-error">{err}</div>}

        <section className="harness-studio-bar" data-testid="harness-creative-studio">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>Quick make</strong>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                Pick an example or describe what you want: a 3D model, picture, video, app or game
              </span>
            </div>
            {forgingPreset && <span className="pill">Making it now...</span>}
          </div>

          <div className="harness-studio-presets">
            {STUDIO_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid={p.testId}
                disabled={Boolean(forgingPreset)}
                onClick={() =>
                  forgeWithStudio({
                    title: p.title,
                    prompt: p.prompt,
                    format: p.format,
                    creative: p.creative,
                    presetId: p.id,
                  })
                }
              >
                {forgingPreset === p.id ? 'Making...' : p.label}
              </button>
            ))}
          </div>

          <form
            className="harness-studio-form"
            onSubmit={e => {
              e.preventDefault();
              if (!studioPrompt.trim()) return;
              forgeWithStudio({
                prompt: studioPrompt.trim(),
                format: studioFormat,
                presetId: 'custom',
              });
            }}
          >
            <input
              type="text"
              className="input"
              data-testid="studio-prompt-input"
              placeholder="Describe what you want, e.g. a picture of a red tractor at sunrise"
              aria-label="Describe what you want Mimir to make"
              value={studioPrompt}
              onChange={e => setStudioPrompt(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
            />
            <select
              className="select"
              data-testid="studio-format-select"
              aria-label="What kind of file to make"
              value={studioFormat}
              onChange={e => setStudioFormat(e.target.value)}
            >
              <option value="glb">3D model</option>
              <option value="obj">3D model (simple, .obj)</option>
              <option value="stl">3D model for printing</option>
              <option value="png">Picture</option>
              <option value="svg">Drawing (logo or icon)</option>
              <option value="webm">Video</option>
              <option value="mp4">Video (.mp4)</option>
              <option value="gif">Moving picture (GIF)</option>
              <option value="webapp">App</option>
              <option value="game">Game</option>
              <option value="pdf">Document (PDF)</option>
              <option value="docx">Word document</option>
              <option value="pptx">Slides</option>
              <option value="xlsx">Spreadsheet</option>
            </select>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              data-testid="studio-forge-submit"
              disabled={Boolean(forgingPreset) || !studioPrompt.trim()}
            >
              {forgingPreset === 'custom' ? 'Making...' : 'Make'}
            </button>
          </form>
        </section>

        {activeStudioArtifact && (
          <CreativeStudioPlayer
            artifact={activeStudioArtifact}
            onClose={() => setActiveStudioArtifact(null)}
          />
        )}

        {loading ? (
          <div className="card">Loading your files...</div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <MimirAsset category="ui" name="empty-realm" size={32} />
            <div style={{ fontWeight: 700 }}>No files here yet</div>
            <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
              Ask Mimir to make a document, spreadsheet, slides or picture. It will show up here.
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => dialogRef.current?.showModal()}>
              Make your first file
            </button>
          </div>
        ) : (
          <div className={viewMode === 'grid' ? 'library-grid' : 'library-list'}>
            {filtered.map(art => {
              const fmt = String(art.format || 'pdf').toLowerCase();
              const isImg = fmt === 'png' || fmt === 'svg';
              const dlUrl = `${coordUrl}/v1/artifacts/${encodeURIComponent(art.id)}/download`;
              return (
                <article
                  key={art.id}
                  className="library-card"
                  data-testid={`library-card-${art.id}`}
                  style={viewMode === 'list' ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' } : undefined}
                >
                  {viewMode === 'grid' && (
                    <div className="library-thumb">
                      {isImg && coordUrl ? (
                        <AuthArtifactImg url={`${dlUrl}?inline=1`} token={coordToken} alt={art.title || 'Picture preview'} />
                      ) : (
                        <MimirAsset category="artifacts" name={FORMAT_ASSET[fmt] || 'scroll'} size={44} />
                      )}
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                      <span className="pill" style={{ fontSize: 10 }}>{fmt.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-subtle)' }}>{art.folder || 'General'}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>{art.title}</div>
                    {art.subtitle && (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{art.subtitle}</div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--ink-subtle)', fontFamily: 'var(--sand-mono)', marginTop: 2 }}>
                      {art.size_bytes ?? art.bytes ?? 0} bytes
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      data-testid={`open-studio-${art.id}`}
                      onClick={() => setActiveStudioArtifact(art)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={art.favorite ? 'Remove favorite' : 'Mark favorite'}
                      onClick={() => toggleFavorite(art)}
                    >
                      {art.favorite ? '★ Saved' : '☆ Star'}
                    </button>
                    <a
                      className="btn btn-primary btn-sm"
                      href={dlUrl}
                      download
                      onClick={async e => {
                        if (!coordToken) return;
                        e.preventDefault();
                        try {
                          const r = await fetch(dlUrl, { headers: { Authorization: `Bearer ${coordToken}` } });
                          if (!r.ok) return;
                          const b = await r.blob();
                          const u = URL.createObjectURL(b);
                          const link = document.createElement('a');
                          link.href = u;
                          const dlExt = fmt === 'webapp' || fmt === 'game' ? 'zip' : fmt;
                          link.download = `${art.title || art.id}.${dlExt}`;
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                          setTimeout(() => URL.revokeObjectURL(u), 2000);
                        } catch {}
                      }}
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removeArtifact(art.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <dialog ref={dialogRef} className="mimir-dialog" aria-labelledby="new-deliverable-title">
        <div className="mimir-dialog-head">
          <strong id="new-deliverable-title">Make something</strong>
          <button type="button" className="btn btn-sm" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>
        <form className="mimir-dialog-body" onSubmit={handleCreate}>
          <label className="field-label">
            Title
            <input
              className="input"
              required
              data-testid="library-create-title"
              placeholder="e.g. Harvest plan for spring"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </label>
          <div className="grid-2">
            <label className="field-label">
              Kind of file
              <select
                className="select"
                data-testid="library-create-format"
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
              >
                <option value="pdf">Document (PDF)</option>
                <option value="docx">Word document</option>
                <option value="pptx">Slides</option>
                <option value="xlsx">Spreadsheet</option>
                <option value="glb">3D model</option>
                <option value="obj">3D model (simple, .obj)</option>
                <option value="stl">3D model for printing</option>
                <option value="png">Picture</option>
                <option value="svg">Drawing (logo or icon)</option>
                <option value="webm">Video</option>
                <option value="mp4">Video (.mp4)</option>
                <option value="gif">Moving picture (GIF)</option>
                <option value="webapp">App</option>
                <option value="game">Game</option>
                <option value="zip">Starter folder (zip)</option>
                <option value="csv">Table (CSV)</option>
              </select>
            </label>
            <label className="field-label">
              Folder
              <input
                className="input"
                value={form.folder}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
              />
            </label>
          </div>
          <label className="field-label">
            Short description
            <input
              className="input"
              placeholder="e.g. What to plant and when"
              value={form.subtitle}
              onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
            />
          </label>
          <label className="field-label">
            Main points (one per line)
            <textarea
              className="textarea"
              rows={3}
              value={form.sectionsText}
              onChange={e => setForm(f => ({ ...f, sectionsText: e.target.value }))}
            />
          </label>
          <label className="field-label">
            Table rows (for spreadsheets: one row per line, commas between columns)
            <textarea
              className="textarea"
              rows={2}
              value={form.rowsText}
              onChange={e => setForm(f => ({ ...f, rowsText: e.target.value }))}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="submit" className="btn btn-primary" data-testid="library-create-submit" disabled={creating}>
              {creating ? 'Making...' : 'Make'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
