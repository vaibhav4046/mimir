import React, { useEffect, useRef } from 'react';

/**
 * HairlineCanvas — pointer-reactive precision hairline vector field inspired by
 * hairline.lucasmarkes.com. Responds smoothly to cursor position and intent state
 * while obeying prefers-reduced-motion and [data-reduced-motion="true"].
 */
export function HairlineCanvas({ activeIntent = null, height = 84 }) {
  const canvasRef = useRef(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, inside: false });
  const intentRef = useRef(activeIntent);
  intentRef.current = activeIntent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let width = canvas.clientWidth || 640;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      if (!canvas) return;
      width = Math.max(240, canvas.clientWidth || 640);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };
    resize();

    const reducedMotion = () =>
      document.documentElement.getAttribute('data-reduced-motion') === 'true' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const readThemePalette = () => {
      const styles = getComputedStyle(document.documentElement);
      return {
        frost: (styles.getPropertyValue('--frost') || '#3ac9ff').trim(),
        brass: (styles.getPropertyValue('--brass') || '#e6ab42').trim(),
        rule: (styles.getPropertyValue('--rule-strong') || '#45607d').trim(),
      };
    };

    const drawFrame = () => {
      const p = pointerRef.current;
      const isReduced = reducedMotion();
      if (isReduced) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (p.tx - p.x) * 0.14;
        p.y += (p.ty - p.y) * 0.14;
      }

      const palette = readThemePalette();
      const activeKind = intentRef.current?.kind || '';
      const accentHex = activeKind ? palette.brass : palette.frost;
      const cx = p.x * width;
      const cy = p.y * height;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const strandCount = 7;
      for (let i = 0; i < strandCount; i++) {
        const t = i / (strandCount - 1);
        const y0 = 14 + t * (height - 28);
        const bend = p.inside ? (p.y - 0.5) * 34 : 0;
        const spread = (t - 0.5) * (p.inside ? 22 : 10);
        const cpX = cx + (t - 0.5) * 56;
        const cpY = y0 + bend + spread;

        ctx.beginPath();
        ctx.moveTo(10, y0);
        ctx.quadraticCurveTo(cpX, cpY, width - 10, y0);
        ctx.lineWidth = i === 3 ? 1.15 : 0.75;
        ctx.strokeStyle = i === 3 ? accentHex : palette.rule;
        ctx.globalAlpha = i === 3 ? (p.inside ? 0.85 : 0.58) : 0.34 + t * 0.18;
        ctx.stroke();

        // Anchor tick nodes at curve endpoints and closest horizontal sample to pointer
        if (i % 2 === 0) {
          ctx.fillStyle = i === 2 || i === 4 ? accentHex : palette.brass;
          ctx.globalAlpha = p.inside ? 0.9 : 0.55;
          ctx.beginPath();
          ctx.arc(cpX * 0.5 + width * 0.25, (y0 + cpY) * 0.5, p.inside ? 1.9 : 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (p.inside) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentHex;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
      }
      ctx.restore();
    };

    const scheduleDraw = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        drawFrame();
        const p = pointerRef.current;
        if (!reducedMotion() && (Math.abs(p.tx - p.x) > 0.002 || Math.abs(p.ty - p.y) > 0.002)) {
          scheduleDraw();
        }
      });
    };

    const onMove = ev => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerRef.current.tx = Math.max(0.04, Math.min(0.96, (ev.clientX - rect.left) / rect.width));
      pointerRef.current.ty = Math.max(0.08, Math.min(0.92, (ev.clientY - rect.top) / rect.height));
      pointerRef.current.inside = true;
      scheduleDraw();
    };

    const onLeave = () => {
      pointerRef.current.tx = 0.5;
      pointerRef.current.ty = 0.5;
      pointerRef.current.inside = false;
      scheduleDraw();
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      resize();
      drawFrame();
    }) : null;
    observer?.observe(canvas);

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('mouseleave', onLeave);
    drawFrame();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      observer?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [height, activeIntent?.kind]);

  return (
    <canvas
      ref={canvasRef}
      className="hairline-canvas"
      data-testid="hairline-interactive-canvas"
      aria-label="Interactive hairline guide lines"
      style={{ height: `${height}px` }}
    />
  );
}
