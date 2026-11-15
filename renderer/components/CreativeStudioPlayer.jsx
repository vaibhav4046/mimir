import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchArtifactBlob, getArtifactPreview } from '../api';

function resolveKind(artifact, preview) {
  if (preview?.kind) return preview.kind;
  const fmt = String(artifact?.format || '').toLowerCase();
  if (['glb', 'obj', 'stl'].includes(fmt) || artifact?.previewKind === '3d' || artifact?.kind === '3d') return '3d';
  if (['webm', 'mp4', 'gif'].includes(fmt) || artifact?.previewKind === 'video' || artifact?.kind === 'video') return 'video';
  if (['wav', 'music'].includes(fmt) || artifact?.previewKind === 'audio' || artifact?.kind === 'audio') return 'audio';
  if (fmt === 'webapp' || artifact?.previewKind === 'webapp' || artifact?.kind === 'webapp') return 'webapp';
  if (fmt === 'game' || artifact?.previewKind === 'game' || artifact?.kind === 'game') return 'game';
  if (['png', 'svg'].includes(fmt) || artifact?.kind === 'image') return 'image';
  return artifact?.kind || 'document';
}

function hexToRgbTuple(hex, fallback = [245, 158, 11]) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  }
  return fallback;
}

function ThreeDCanvasViewer({ artifact, preview, compact }) {
  const canvasRef = useRef(null);
  const [autoSpin, setAutoSpin] = useState(true);
  const [renderMode, setRenderMode] = useState('solid'); // solid | wireframe | xray
  const rotRef = useRef({ yaw: 0.55, pitch: 0.35, zoom: 1.0, dragging: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const parts = Array.isArray(preview?.parts) ? preview.parts : [];
    const pal = preview?.palette || { bg: '#070b14', accent: '#f59e0b', secondary: '#38bdf8' };
    let raf = 0;

    const render = () => {
      if (autoSpin && !rotRef.current.dragging) {
        rotRef.current.yaw += 0.014;
      }
      const w = canvas.width;
      const h = canvas.height;
      const grad = ctx.createRadialGradient(w * 0.52, h * 0.44, 18, w * 0.5, h * 0.5, w * 0.72);
      grad.addColorStop(0, '#132038');
      grad.addColorStop(1, pal.bg || '#070b14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Perspective floor grid
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= w; gx += 48) {
        ctx.beginPath();
        ctx.moveTo(gx, h * 0.74);
        ctx.lineTo(w * 0.5 + (gx - w * 0.5) * 1.45, h);
        ctx.stroke();
      }
      for (let gy = Math.floor(h * 0.76); gy < h; gy += 22) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      const { yaw, pitch, zoom } = rotRef.current;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const scale = Math.min(w, h) * 0.34 * zoom;

      const tris = [];
      for (const part of parts) {
        const verts = part.vertices || [];
        const faces = part.faces || [];
        const baseRgb = hexToRgbTuple(part.color, [203, 213, 225]);
        const rotated = verts.map(([vx, vy, vz]) => {
          const x1 = vx * cy - vz * sy;
          const z1 = vx * sy + vz * cy;
          const y2 = vy * cp - z1 * sp;
          const z2 = vy * sp + z1 * cp;
          const p = 2.8 / Math.max(0.55, 3.2 - z2);
          return [w * 0.5 + x1 * scale * p, h * 0.46 - y2 * scale * p, z2, x1, y2];
        });

        for (const [i0, i1, i2] of faces) {
          const a = rotated[i0];
          const b = rotated[i1];
          const c = rotated[i2];
          if (!a || !b || !c) continue;
          const ax = b[3] - a[3];
          const ay = b[4] - a[4];
          const az = b[2] - a[2];
          const bx = c[3] - a[3];
          const by = c[4] - a[4];
          const bz = c[2] - a[2];
          const nx = ay * bz - az * by;
          const ny = az * bx - ax * bz;
          const nz = ax * by - ay * bx;
          const nlen = Math.hypot(nx, ny, nz) || 1;
          const light = Math.max(0.24, Math.min(1.0, (nx * 0.45 + ny * 0.65 + nz * 0.62) / nlen * 0.58 + 0.52));
          tris.push({
            depth: (a[2] + b[2] + c[2]) / 3,
            a,
            b,
            c,
            baseRgb,
            light,
          });
        }
      }

      tris.sort((p, q) => p.depth - q.depth);

      for (const t of tris) {
        ctx.beginPath();
        ctx.moveTo(t.a[0], t.a[1]);
        ctx.lineTo(t.b[0], t.b[1]);
        ctx.lineTo(t.c[0], t.c[1]);
        ctx.closePath();
        const [r, g, b] = t.baseRgb;
        if (renderMode === 'solid') {
          ctx.fillStyle = `rgb(${Math.round(r * t.light)}, ${Math.round(g * t.light)}, ${Math.round(b * t.light)})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.28)`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        } else if (renderMode === 'xray') {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.16)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(56, 189, 248, 0.58)`;
          ctx.lineWidth = 0.85;
          ctx.stroke();
        } else {
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.88)`;
          ctx.lineWidth = 1.05;
          ctx.stroke();
        }
      }

      if (!parts.length) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.fillText('Loading 3D mesh geometry...', 20, 32);
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [preview, autoSpin, renderMode]);

  const onPointerDown = ev => {
    rotRef.current.dragging = true;
    rotRef.current.lastX = ev.clientX;
    rotRef.current.lastY = ev.clientY;
  };
  const onPointerMove = ev => {
    if (!rotRef.current.dragging) return;
    const dx = ev.clientX - rotRef.current.lastX;
    const dy = ev.clientY - rotRef.current.lastY;
    rotRef.current.lastX = ev.clientX;
    rotRef.current.lastY = ev.clientY;
    rotRef.current.yaw += dx * 0.012;
    rotRef.current.pitch = Math.max(-1.4, Math.min(1.4, rotRef.current.pitch + dy * 0.012));
  };
  const stopDrag = () => {
    rotRef.current.dragging = false;
  };
  const onWheel = ev => {
    ev.preventDefault();
    rotRef.current.zoom = Math.max(0.45, Math.min(2.4, rotRef.current.zoom - ev.deltaY * 0.001));
  };

  const nextMode = renderMode === 'solid' ? 'wireframe' : renderMode === 'wireframe' ? 'xray' : 'solid';

  return (
    <div className="studio-viewport-stack">
      <div className="studio-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={compact ? 560 : 720}
          height={compact ? 280 : 380}
          className="studio-canvas"
          data-testid="studio-3d-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          onWheel={onWheel}
        />
      </div>
      <div className="studio-controls-bar">
        <span className="pill">
          3D · {String(artifact?.format || 'glb').toUpperCase()} · {preview?.archetype || 'mesh'} ·{' '}
          {preview?.stats?.vertices ?? '?'}v / {preview?.stats?.faces ?? '?'}f
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className={`btn btn-sm ${autoSpin ? 'btn-primary' : 'btn-ghost'}`}
            data-testid="studio-3d-autospin"
            onClick={() => setAutoSpin(s => !s)}
          >
            {autoSpin ? 'Auto-Spin: On' : 'Auto-Spin: Off'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-testid="studio-3d-wireframe"
            onClick={() => setRenderMode(nextMode)}
          >
            View: {renderMode === 'solid' ? 'Solid Lit' : renderMode === 'wireframe' ? 'Wireframe' : 'X-Ray'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayableGameCanvas({ artifact, preview, compact }) {
  const canvasRef = useRef(null);
  const [autopilot, setAutopilot] = useState(false);
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [viewMode, setViewMode] = useState('play'); // play | code
  const [activeFile, setActiveFile] = useState('game.js');
  const gameRef = useRef(null);

  const genre = preview?.genre || 'space-shooter';
  const pal = preview?.palette || { bg: '#040812', accent: '#f59e0b', secondary: '#38bdf8', tertiary: '#a855f7' };

  const initGameState = () => {
    const targets = [];
    for (let i = 0; i < 10; i++) {
      targets.push({
        id: i,
        x: 56 + (i % 5) * 116,
        y: genre === 'brick-breaker' ? 52 + Math.floor(i / 5) * 34 : 46 + Math.floor(i / 5) * 44,
        vx: genre === 'brick-breaker' ? 0 : (i % 2 === 0 ? 1.5 : -1.5),
        hp: 1,
      });
    }
    gameRef.current = {
      px: 280,
      py: genre === 'dungeon-crawler' ? 190 : 244,
      ballX: 280,
      ballY: 180,
      ballVx: 3.1,
      ballVy: -3.2,
      bullets: [],
      sparks: [],
      targets,
      score: 0,
      wave: 1,
      tick: 0,
      keys: {},
    };
    setScore(0);
    setWave(1);
  };

  useEffect(() => {
    initGameState();
  }, [artifact?.id, genre]);

  useEffect(() => {
    if (viewMode !== 'play') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    const onKeyDown = ev => {
      if (!gameRef.current) return;
      gameRef.current.keys[ev.code] = true;
      if (ev.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        gameRef.current.bullets.push({ x: gameRef.current.px, y: gameRef.current.py - 14, dy: -7 });
      }
    };
    const onKeyUp = ev => {
      if (gameRef.current) gameRef.current.keys[ev.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const step = () => {
      const g = gameRef.current;
      const w = canvas.width;
      const h = canvas.height;
      if (g) {
        g.tick += 1;
        g.py = h - 32;
        if (g.keys.ArrowLeft || g.keys.KeyA) g.px = Math.max(24, g.px - 5.5);
        if (g.keys.ArrowRight || g.keys.KeyD) g.px = Math.min(w - 24, g.px + 5.5);

        if (autopilot && g.targets.length) {
          const aim = g.targets[0];
          const targetX = genre === 'brick-breaker' ? g.ballX : aim.x;
          g.px += Math.sign(targetX - g.px) * Math.min(5.2, Math.abs(targetX - g.px));
          if (g.tick % 9 === 0 && genre !== 'brick-breaker') {
            g.bullets.push({ x: g.px, y: g.py - 14, dy: -8 });
          }
        }

        // Background
        ctx.fillStyle = pal.bg || '#040812';
        ctx.fillRect(0, 0, w, h);

        // Starfield
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        for (let s = 0; s < 24; s++) {
          const sx = (s * 83 + g.tick * (0.4 + (s % 3) * 0.2)) % w;
          const sy = (s * 47 + g.tick * 0.6) % h;
          ctx.fillRect(sx, sy, 2, 2);
        }

        // Bullets
        for (const b of g.bullets) {
          b.y += b.dy;
          ctx.fillStyle = pal.secondary || '#38bdf8';
          ctx.fillRect(b.x - 2, b.y - 10, 4, 12);
        }
        g.bullets = g.bullets.filter(b => b.y > -20);

        // Brick breaker ball
        if (genre === 'brick-breaker') {
          g.ballX += g.ballVx;
          g.ballY += g.ballVy;
          if (g.ballX < 10 || g.ballX > w - 10) g.ballVx *= -1;
          if (g.ballY < 10) g.ballVy = Math.abs(g.ballVy);
          if (g.ballY >= g.py - 12 && Math.abs(g.ballX - g.px) < 48 && g.ballVy > 0) {
            g.ballVy = -Math.abs(g.ballVy);
            g.score += 10;
            setScore(g.score);
          }
          if (g.ballY > h) {
            g.ballX = g.px;
            g.ballY = g.py - 28;
            g.ballVy = -3.2;
          }
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(g.ballX, g.ballY, 7, 0, Math.PI * 2);
          ctx.fill();
        }

        // Targets
        for (const t of g.targets) {
          t.x += t.vx;
          if (t.x < 28 || t.x > w - 28) t.vx *= -1;
          for (const b of g.bullets) {
            if (Math.hypot(b.x - t.x, b.y - t.y) < 22) {
              t.hp = 0;
              b.y = -999;
              g.score += 100;
              setScore(g.score);
              for (let k = 0; k < 6; k++) {
                g.sparks.push({ x: t.x, y: t.y, vx: Math.cos(k) * 2.5, vy: Math.sin(k) * 2.5, life: 16 });
              }
            }
          }
          if (genre === 'brick-breaker' && Math.hypot(g.ballX - t.x, g.ballY - t.y) < 22) {
            t.hp = 0;
            g.ballVy *= -1;
            g.score += 100;
            setScore(g.score);
          }
          if (t.hp > 0) {
            ctx.fillStyle = pal.accent || '#f59e0b';
            if (genre === 'brick-breaker') {
              ctx.fillRect(t.x - 24, t.y - 10, 48, 18);
            } else {
              ctx.beginPath();
              ctx.arc(t.x, t.y, 13, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        g.targets = g.targets.filter(t => t.hp > 0);
        if (g.targets.length === 0) {
          g.wave += 1;
          setWave(g.wave);
          for (let i = 0; i < 10; i++) {
            g.targets.push({
              id: g.wave * 100 + i,
              x: 56 + (i % 5) * 116,
              y: 44 + Math.floor(i / 5) * 42,
              vx: genre === 'brick-breaker' ? 0 : (i % 2 === 0 ? 1.7 : -1.7),
              hp: 1,
            });
          }
        }

        // Sparks
        for (const sp of g.sparks) {
          sp.x += sp.vx;
          sp.y += sp.vy;
          sp.life -= 1;
          ctx.fillStyle = pal.tertiary || '#a855f7';
          ctx.fillRect(sp.x, sp.y, 3, 3);
        }
        g.sparks = g.sparks.filter(sp => sp.life > 0);

        // Player craft / paddle
        ctx.fillStyle = pal.secondary || '#38bdf8';
        if (genre === 'brick-breaker') {
          ctx.fillRect(g.px - 42, g.py - 6, 84, 12);
        } else {
          ctx.beginPath();
          ctx.moveTo(g.px, g.py - 15);
          ctx.lineTo(g.px - 15, g.py + 12);
          ctx.lineTo(g.px + 15, g.py + 12);
          ctx.closePath();
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [viewMode, autopilot, genre, pal]);

  const fireBurst = () => {
    const g = gameRef.current;
    if (!g) return;
    if (g.targets.length) {
      g.px = g.targets[0].x;
    }
    g.bullets.push({ x: g.px, y: g.py - 14, dy: -9 });
    if (genre === 'brick-breaker' && g.targets.length) {
      g.targets[0].hp = 0;
      g.score += 100;
      setScore(g.score);
    }
  };

  const fileNames = Object.keys(preview?.files || {});

  return (
    <div className="studio-viewport-stack">
      {viewMode === 'play' ? (
        <div className="studio-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={compact ? 560 : 720}
            height={compact ? 260 : 340}
            className="studio-canvas"
            data-testid="studio-game-canvas"
            onClick={fireBurst}
          />
        </div>
      ) : (
        <pre className="mimri-code-pre" data-testid="studio-game-code">
          {preview?.files?.[activeFile] || 'No source available'}
        </pre>
      )}
      <div className="studio-controls-bar">
        <div className="row" style={{ gap: 6 }}>
          <span className="pill" data-testid="studio-game-score">
            Score: {score} · Wave: {wave} · {genre}
          </span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-primary" data-testid="studio-game-fire" onClick={fireBurst}>
            Fire / Pulse
          </button>
          <button
            type="button"
            className={`btn btn-sm ${autopilot ? 'btn-primary' : 'btn-ghost'}`}
            data-testid="studio-game-autopilot"
            onClick={() => setAutopilot(a => !a)}
          >
            {autopilot ? 'AI Autopilot: On' : 'AI Autopilot'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" data-testid="studio-game-restart" onClick={initGameState}>
            Restart
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setViewMode(m => (m === 'play' ? 'code' : 'play'))}
          >
            {viewMode === 'play' ? 'View Source' : 'Play Game'}
          </button>
          {viewMode === 'code' &&
            fileNames.map(fn => (
              <button
                key={fn}
                type="button"
                className={`btn btn-sm ${activeFile === fn ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveFile(fn)}
              >
                {fn}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function WebAppInteractiveRunner({ preview }) {
  const [items, setItems] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [filterText, setFilterText] = useState('');
  const [tab, setTab] = useState('app');

  useEffect(() => {
    setItems(Array.isArray(preview?.initialItems) ? preview.initialItems : []);
  }, [preview]);

  const fileNames = Object.keys(preview?.files || {});
  const visible = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return q ? items.filter(it => `${it.title} ${it.category}`.toLowerCase().includes(q)) : items;
  }, [items, filterText]);

  const addItem = ev => {
    ev.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setItems(prev => [{ id: `live-${Date.now().toString(36)}`, title, category: 'Harness', metric: 'Live', done: false }, ...prev]);
    setNewTitle('');
  };

  return (
    <div className="studio-viewport-stack" data-testid="studio-webapp-runner">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'app' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('app')}
        >
          Live App Runner
        </button>
        {fileNames.map(fn => (
          <button
            key={fn}
            type="button"
            className={`btn btn-sm ${tab === fn ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(fn)}
          >
            {fn}
          </button>
        ))}
      </div>

      {tab === 'app' ? (
        <div className="studio-webapp-sandbox">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{preview?.appName || 'Generated Full-Stack Web App'}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {preview?.tagline || 'FastAPI + JS interactive live preview'} · Routes: {(preview?.routes || []).join(', ')}
              </div>
            </div>
            <input
              type="search"
              placeholder="Filter records..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{ maxWidth: 180 }}
            />
          </div>
          <form className="row" style={{ gap: 8 }} onSubmit={addItem}>
            <input
              type="text"
              data-testid="studio-webapp-input"
              placeholder="Add item in live app..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm btn-primary" data-testid="studio-webapp-add">
              Add Item
            </button>
          </form>
          <div className="studio-webapp-items">
            {visible.map(it => (
              <div
                key={it.id}
                className={`studio-webapp-card ${it.done ? 'is-done' : ''}`}
                data-testid={`webapp-item-${it.id}`}
              >
                <div>
                  <strong>{it.title}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {it.category} · {it.metric || 'Active'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setItems(prev => prev.map(p => (p.id === it.id ? { ...p, done: !p.done } : p)))}
                >
                  {it.done ? 'Completed' : 'Mark Done'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <pre className="mimri-code-pre">{preview?.files?.[tab] || 'Empty file'}</pre>
      )}
    </div>
  );
}

function VideoMotionPlayer({ artifact, preview, compact }) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [posterUrl, setPosterUrl] = useState(null);
  const fmt = String(artifact?.format || '').toLowerCase();

  useEffect(() => {
    let active = true;
    const urls = [];
    (async () => {
      try {
        const videoQuery = fmt === 'gif' ? 'inline=1' : 'inline=1&preview_video=1';
        const blob = await fetchArtifactBlob(artifact.id, videoQuery);
        if (!active) return;
        const u = URL.createObjectURL(blob);
        urls.push(u);
        setMediaUrl(u);
        if (fmt !== 'gif') {
          const pBlob = await fetchArtifactBlob(artifact.id, 'inline=1&poster=1').catch(() => null);
          if (active && pBlob) {
            const pu = URL.createObjectURL(pBlob);
            urls.push(pu);
            setPosterUrl(pu);
          }
        }
      } catch {
        // Handled cleanly via fallback state
      }
    })();
    return () => {
      active = false;
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [artifact?.id, fmt]);

  return (
    <div className="studio-viewport-stack">
      <div className="studio-canvas-wrap">
        {fmt === 'gif' ? (
          mediaUrl ? (
            <img
              src={mediaUrl}
              alt={artifact.title}
              data-testid="studio-video-gif"
              style={{ maxWidth: '100%', maxHeight: compact ? 280 : 380, borderRadius: 8 }}
            />
          ) : (
            <div className="muted">Loading animated GIF...</div>
          )
        ) : mediaUrl ? (
          <video
            src={mediaUrl}
            poster={posterUrl || undefined}
            controls
            loop
            autoPlay
            muted
            playsInline
            data-testid="studio-video-el"
            style={{ width: '100%', maxHeight: compact ? 280 : 380, borderRadius: 8, background: '#040812' }}
          />
        ) : (
          <div className="muted">Loading motion stream...</div>
        )}
      </div>
      <div className="studio-controls-bar">
        <span className="pill">
          {preview?.videoTier || 'Tier 1 Video'} · {fmt.toUpperCase()} · {preview?.width || 640}×{preview?.height || 360} · {preview?.fps || 24} FPS ·{' '}
          {preview?.durationSec || 2.0}s
        </span>
        {preview?.tier2HardwareNote && (
          <span className="muted" style={{ fontSize: 11 }}>{preview.tier2HardwareNote}</span>
        )}
      </div>
    </div>
  );
}

function AudioMusicPlayer({ artifact, preview }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let active = true;
    let url = null;
    (async () => {
      try {
        const blob = await fetchArtifactBlob(artifact.id, 'inline=1');
        if (!active) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      } catch {}
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifact?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#081019';
    ctx.fillRect(0, 0, w, h);
    const bars = Array.isArray(preview?.bars) && preview.bars.length
      ? preview.bars
      : Array.from({ length: 64 }, (_, i) => 0.25 + 0.65 * Math.abs(Math.sin(i * 0.37)));
    const bw = Math.max(3, Math.floor((w - 16) / bars.length) - 2);
    bars.forEach((amp, idx) => {
      const barH = Math.max(6, Math.round(amp * (h - 18)));
      const x = 8 + idx * (bw + 2);
      const y = Math.round((h - barH) / 2);
      ctx.fillStyle = idx % 4 === 0 ? '#e6ab42' : '#3ac9ff';
      ctx.fillRect(x, y, bw, barH);
    });
  }, [preview]);

  return (
    <div className="music-studio-player" data-testid="studio-audio-player">
      <canvas ref={canvasRef} width={640} height={84} className="music-studio-canvas" />
      {audioUrl ? (
        <audio controls src={audioUrl} data-testid="studio-audio-el" style={{ width: '100%' }} />
      ) : (
        <div className="muted">Rendering stereo WAV audio stream...</div>
      )}
      <div className="studio-controls-bar">
        <span className="pill">
          Music WAV · {preview?.bpm || 110} BPM · {preview?.style || 'synthwave'} · {preview?.durationSec || 6}s · {preview?.sampleRate || 44100} Hz
        </span>
        {Array.isArray(preview?.stems) && (
          <span className="pill is-cyan">Stems: {preview.stems.join(', ')}</span>
        )}
        <span className="pill is-emerald">QA: {preview?.qaVerdict || 'VERIFIED'}</span>
      </div>
    </div>
  );
}

function ImageStudioViewer({ artifact, compact }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    let url = null;
    (async () => {
      try {
        const blob = await fetchArtifactBlob(artifact.id, 'inline=1');
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImgUrl(url);
      } catch {}
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifact?.id]);

  return (
    <div className="studio-viewport-stack">
      <div className="studio-canvas-wrap" style={{ overflow: 'auto', maxHeight: compact ? 290 : 400 }}>
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={artifact.title}
            data-testid="studio-image-el"
            style={{
              maxWidth: zoom === 1 ? '100%' : 'none',
              width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
              borderRadius: 8,
              transition: 'width 0.15s ease',
            }}
          />
        ) : (
          <div className="muted">Rendering HD image...</div>
        )}
      </div>
      <div className="studio-controls-bar">
        <span className="pill">HD Render · {String(artifact?.format || 'png').toUpperCase()} · 1280×720</span>
        <div className="row" style={{ gap: 6 }}>
          {[1, 1.5, 2].map(z => (
            <button
              key={z}
              type="button"
              className={`btn btn-sm ${zoom === z ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setZoom(z)}
            >
              {z}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CreativeStudioPlayer({ artifact, onClose = null, compact = false }) {
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    if (!artifact?.id) return undefined;
    getArtifactPreview(artifact.id)
      .then(data => {
        if (alive) setPreview(data?.preview || null);
      })
      .catch(e => {
        if (alive) setErr(e.message || 'Preview load failed');
      });
    return () => {
      alive = false;
    };
  }, [artifact?.id]);

  if (!artifact) return null;
  const kind = resolveKind(artifact, preview);

  const handleDownload = async () => {
    try {
      const blob = await fetchArtifactBlob(artifact.id, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = ['webapp', 'game'].includes(String(artifact.format || '').toLowerCase()) ? 'zip' : artifact.format;
      a.download = `${(artifact.title || artifact.id).replace(/[^a-z0-9_-]+/gi, '-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErr(e.message || 'Download failed');
    }
  };

  return (
    <div
      className={`studio-player-card ${compact ? 'is-compact' : ''}`}
      data-testid={`creative-studio-player-${artifact.id}`}
    >
      <div className="studio-player-head">
        <div>
          <strong>{artifact.title || artifact.id}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            {String(artifact.format || '').toUpperCase()} · {kind.toUpperCase()} ·{' '}
            {Math.max(1, Math.round((artifact.size_bytes || 0) / 1024))} KB
            {artifact.verified ? ' · Rust Verified' : ''}
          </div>
          {artifact.dreamLoop && (
            <div className="dream-loop-badge" data-testid="dream-loop-critic-badge">
              <span>Critic · {artifact.dreamLoop.criticVerdict}</span>
              <span className="num">
                {artifact.dreamLoop.checkSummary || `${artifact.dreamLoop.checksPassed || 3}/${artifact.dreamLoop.totalChecks || 3} checks passed`} · {artifact.dreamLoop.iterations} passes
              </span>
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm btn-ghost" data-testid="studio-download-btn" onClick={handleDownload}>
            Download
          </button>
          {onClose && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      {err && <div className="tool-card is-error">{err}</div>}
      {kind === '3d' && <ThreeDCanvasViewer artifact={artifact} preview={preview} compact={compact} />}
      {kind === 'game' && <PlayableGameCanvas artifact={artifact} preview={preview} compact={compact} />}
      {kind === 'webapp' && <WebAppInteractiveRunner preview={preview} />}
      {kind === 'video' && <VideoMotionPlayer artifact={artifact} preview={preview} compact={compact} />}
      {kind === 'audio' && <AudioMusicPlayer artifact={artifact} preview={preview} />}
      {kind === 'image' && <ImageStudioViewer artifact={artifact} compact={compact} />}
      {!['3d', 'game', 'webapp', 'video', 'audio', 'image'].includes(kind) && (
        <div className="muted" style={{ padding: 8 }}>
          {artifact.subtitle || 'Verified deliverable ready for download.'}
        </div>
      )}
    </div>
  );
}
