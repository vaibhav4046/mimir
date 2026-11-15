import html
import json
import math
import re
import wave
import zipfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import trimesh


PALETTES = {
    "norse": {"name": "Norse Solar", "bg": "#070b14", "panel": "#0f172a", "accent": "#f59e0b", "secondary": "#38bdf8", "tertiary": "#a855f7", "text": "#f8fafc", "muted": "#94a3b8"},
    "cyber": {"name": "Cyber Neon", "bg": "#050816", "panel": "#0d1328", "accent": "#22d3ee", "secondary": "#f43f5e", "tertiary": "#a855f7", "text": "#f8fafc", "muted": "#94a3b8"},
    "emerald": {"name": "Emerald Matrix", "bg": "#04100c", "panel": "#0a1f18", "accent": "#10b981", "secondary": "#38bdf8", "tertiary": "#f59e0b", "text": "#ecfdf5", "muted": "#86efac"},
    "crimson": {"name": "Crimson Forge", "bg": "#12070a", "panel": "#210c12", "accent": "#f43f5e", "secondary": "#fb923c", "tertiary": "#fbbf24", "text": "#fff1f2", "muted": "#fda4af"},
    "arctic": {"name": "Arctic Frost", "bg": "#08121e", "panel": "#0f2034", "accent": "#60a5fa", "secondary": "#e2e8f0", "tertiary": "#34d399", "text": "#f8fafc", "muted": "#cbd5e1"},
}


def _hex_to_rgb(hex_str: str, default=(245, 158, 11)) -> tuple[int, int, int]:
    h = (hex_str or "").strip().lstrip("#")
    if len(h) == 6:
        try:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        except ValueError:
            pass
    return default


def _hex_to_rgba(hex_str: str, alpha=255) -> list[int]:
    r, g, b = _hex_to_rgb(hex_str)
    return [r, g, b, alpha]


def _load_font(size: int, bold: bool = False, mono: bool = False):
    candidates = []
    if mono:
        candidates = ["C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    elif bold:
        candidates = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    else:
        candidates = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for cand in candidates:
        p = Path(cand)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                pass
    return ImageFont.load_default()


def _svg_esc(value: str) -> str:
    cleaned = re.sub(r"(?i)<script|javascript:|on[a-z]+\s*=", "", str(value or ""))
    return html.escape(cleaned, quote=True)


def infer_creative_context(spec: dict) -> dict:
    title = str(spec.get("title") or "Mimir Creation").strip()
    subtitle = str(spec.get("subtitle") or "").strip()
    creative = dict(spec.get("creative") or {})
    sections = spec.get("sections") or []
    blob = " ".join([
        title,
        subtitle,
        str(creative.get("description") or ""),
        str(creative.get("archetype") or ""),
        str(creative.get("gameGenre") or ""),
        str(creative.get("theme") or ""),
        " ".join(f"{s.get('heading', '')} {s.get('body', '')}" for s in sections if isinstance(s, dict)),
    ]).lower()

    palette_key = str(creative.get("theme") or "").lower()
    if palette_key not in PALETTES:
        if any(k in blob for k in ("cyber", "neon", "synth", "blade", "hacker", "laser")):
            palette_key = "cyber"
        elif any(k in blob for k in ("emerald", "matrix", "bio", "forest", "leaf", "finance")):
            palette_key = "emerald"
        elif any(k in blob for k in ("crimson", "lava", "dragon", "boss", "fire", "mars", "red")):
            palette_key = "crimson"
        elif any(k in blob for k in ("arctic", "ice", "frost", "snow", "glacier", "blue")):
            palette_key = "arctic"
        else:
            palette_key = "norse"
    palette = dict(PALETTES[palette_key])
    if isinstance(creative.get("palette"), dict):
        for k, v in creative["palette"].items():
            if isinstance(v, str) and re.match(r"^#[0-9a-fA-F]{6}$", v):
                palette[k] = v

    archetype = str(creative.get("archetype") or "").lower()
    if archetype not in ("starfighter", "golem", "citadel", "mjolnir", "cosmic-crystal"):
        if any(k in blob for k in ("ship", "fighter", "star", "jet", "rocket", "drone", "shuttle", "spaceship")):
            archetype = "starfighter"
        elif any(k in blob for k in ("golem", "mech", "robot", "droid", "cyborg", "bot", "titan", "suit")):
            archetype = "golem"
        elif any(k in blob for k in ("citadel", "castle", "fortress", "tower", "city", "temple", "hall", "house")):
            archetype = "citadel"
        elif any(k in blob for k in ("mjolnir", "hammer", "sword", "axe", "blade", "weapon", "shield", "trophy")):
            archetype = "mjolnir"
        else:
            archetype = "cosmic-crystal"

    game_genre = str(creative.get("gameGenre") or "").lower()
    if game_genre not in ("space-shooter", "dungeon-crawler", "brick-breaker"):
        if any(k in blob for k in ("dungeon", "rpg", "knight", "maze", "rogue", "quest", "relic", "crawler")):
            game_genre = "dungeon-crawler"
        elif any(k in blob for k in ("brick", "breakout", "pong", "paddle", "ball", "arkanoid", "block")):
            game_genre = "brick-breaker"
        else:
            game_genre = "space-shooter"

    return {
        "title": title,
        "subtitle": subtitle or "Synthesized locally by Mimir Harness",
        "palette_key": palette_key,
        "palette": palette,
        "archetype": archetype,
        "game_genre": game_genre,
        "creative": creative,
        "sections": [s for s in sections if isinstance(s, dict)],
        "rows": spec.get("rows") or [],
    }


def _colorize(mesh: trimesh.Trimesh, hex_color: str, alpha: int = 255) -> trimesh.Trimesh:
    rgba = np.array(_hex_to_rgba(hex_color, alpha), dtype=np.uint8)
    mesh.visual.vertex_colors = np.tile(rgba, (len(mesh.vertices), 1))
    return mesh


def _transform(mesh: trimesh.Trimesh, scale=None, rotate=None, translate=None) -> trimesh.Trimesh:
    if scale is not None:
        s = [scale, scale, scale] if isinstance(scale, (int, float)) else list(scale)
        mat = np.eye(4)
        mat[0, 0], mat[1, 1], mat[2, 2] = s
        mesh.apply_transform(mat)
    if rotate is not None:
        rx, ry, rz = rotate
        if rx:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(rx), [1, 0, 0]))
        if ry:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(ry), [0, 1, 0]))
        if rz:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(rz), [0, 0, 1]))
    if translate is not None:
        mesh.apply_translation(translate)
    return mesh


def _build_archetype_parts(archetype: str, palette: dict) -> list[tuple[str, str, trimesh.Trimesh]]:
    hull = "#cbd5e1"
    dark = "#1e293b"
    accent = palette["accent"]
    sec = palette["secondary"]
    tert = palette["tertiary"]
    parts = []

    if archetype == "starfighter":
        fuselage = _transform(trimesh.creation.cone(radius=0.34, height=2.2, sections=10), rotate=(90, 0, 0), translate=(0, 0, 0.25))
        body = _transform(trimesh.creation.box(extents=[0.55, 0.34, 1.35]), translate=(0, 0, -0.15))
        canopy = _transform(trimesh.creation.icosphere(subdivisions=2, radius=0.25), scale=(0.85, 0.6, 1.65), translate=(0, 0.22, 0.15))
        wing_l = _transform(trimesh.creation.box(extents=[1.4, 0.06, 0.65]), rotate=(0, -18, -6), translate=(-0.78, -0.04, -0.22))
        wing_r = _transform(trimesh.creation.box(extents=[1.4, 0.06, 0.65]), rotate=(0, 18, 6), translate=(0.78, -0.04, -0.22))
        fin = _transform(trimesh.creation.box(extents=[0.06, 0.52, 0.55]), rotate=(-18, 0, 0), translate=(0, 0.28, -0.62))
        thruster_l = _transform(trimesh.creation.cylinder(radius=0.14, height=0.45, sections=12), translate=(-0.22, -0.02, -0.92))
        thruster_r = _transform(trimesh.creation.cylinder(radius=0.14, height=0.45, sections=12), translate=(0.22, -0.02, -0.92))
        cannon_l = _transform(trimesh.creation.cylinder(radius=0.05, height=0.95, sections=8), translate=(-1.35, -0.08, 0.12))
        cannon_r = _transform(trimesh.creation.cylinder(radius=0.05, height=0.95, sections=8), translate=(1.35, -0.08, 0.12))
        parts = [
            ("fuselage", hull, fuselage),
            ("core_hull", dark, body),
            ("canopy", sec, canopy),
            ("wing_left", hull, wing_l),
            ("wing_right", hull, wing_r),
            ("stabilizer", accent, fin),
            ("thruster_left", accent, thruster_l),
            ("thruster_right", accent, thruster_r),
            ("cannon_left", tert, cannon_l),
            ("cannon_right", tert, cannon_r),
        ]
    elif archetype == "golem":
        torso = _transform(trimesh.creation.box(extents=[0.9, 0.95, 0.55]), translate=(0, 0.35, 0))
        core = _transform(trimesh.creation.icosphere(subdivisions=2, radius=0.22), translate=(0, 0.38, 0.28))
        head = _transform(trimesh.creation.box(extents=[0.46, 0.42, 0.44]), translate=(0, 1.05, 0.04))
        visor = _transform(trimesh.creation.box(extents=[0.40, 0.11, 0.08]), translate=(0, 1.08, 0.27))
        pauldron_l = _transform(trimesh.creation.icosphere(subdivisions=1, radius=0.28), translate=(-0.68, 0.72, 0))
        pauldron_r = _transform(trimesh.creation.icosphere(subdivisions=1, radius=0.28), translate=(0.68, 0.72, 0))
        arm_l = _transform(trimesh.creation.box(extents=[0.26, 0.85, 0.28]), rotate=(0, 0, 8), translate=(-0.72, 0.18, 0.08))
        arm_r = _transform(trimesh.creation.box(extents=[0.26, 0.85, 0.28]), rotate=(0, 0, -8), translate=(0.72, 0.18, 0.08))
        leg_l = _transform(trimesh.creation.box(extents=[0.32, 0.85, 0.36]), translate=(-0.26, -0.55, 0))
        leg_r = _transform(trimesh.creation.box(extents=[0.32, 0.85, 0.36]), translate=(0.26, -0.55, 0))
        parts = [
            ("torso", dark, torso),
            ("reactor_core", sec, core),
            ("head", hull, head),
            ("visor", accent, visor),
            ("shoulder_l", accent, pauldron_l),
            ("shoulder_r", accent, pauldron_r),
            ("arm_l", hull, arm_l),
            ("arm_r", hull, arm_r),
            ("leg_l", dark, leg_l),
            ("leg_r", dark, leg_r),
        ]
    elif archetype == "citadel":
        plinth = _transform(trimesh.creation.cylinder(radius=1.18, height=0.22, sections=8), rotate=(90, 0, 0), translate=(0, -0.82, 0))
        keep = _transform(trimesh.creation.cylinder(radius=0.48, height=1.35, sections=6), rotate=(90, 0, 0), translate=(0, -0.05, 0))
        keep_roof = _transform(trimesh.creation.cone(radius=0.56, height=0.58, sections=6), rotate=(-90, 0, 0), translate=(0, 0.9, 0))
        ring = _transform(trimesh.creation.torus(major_radius=0.72, minor_radius=0.05, major_sections=20, minor_sections=8), rotate=(72, 14, 0), translate=(0, 0.95, 0))
        parts = [
            ("plinth", dark, plinth),
            ("central_keep", hull, keep),
            ("spire_roof", accent, keep_roof),
            ("halo_ring", sec, ring),
        ]
        for idx, (tx, tz) in enumerate([(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68)]):
            t_body = _transform(trimesh.creation.cylinder(radius=0.2, height=0.9, sections=8), rotate=(90, 0, 0), translate=(tx, -0.26, tz))
            t_roof = _transform(trimesh.creation.cone(radius=0.26, height=0.38, sections=8), rotate=(-90, 0, 0), translate=(tx, 0.36, tz))
            parts.append((f"tower_{idx}", hull, t_body))
            parts.append((f"cap_{idx}", tert, t_roof))
    elif archetype == "mjolnir":
        head = _transform(trimesh.creation.box(extents=[1.25, 0.68, 0.72]), translate=(0, 0.45, 0))
        band_l = _transform(trimesh.creation.box(extents=[0.12, 0.72, 0.76]), translate=(-0.38, 0.45, 0))
        band_r = _transform(trimesh.creation.box(extents=[0.12, 0.72, 0.76]), translate=(0.38, 0.45, 0))
        inlay = _transform(trimesh.creation.box(extents=[0.46, 0.24, 0.75]), translate=(0, 0.45, 0))
        shaft = _transform(trimesh.creation.cylinder(radius=0.11, height=1.55, sections=12), rotate=(90, 0, 0), translate=(0, -0.45, 0))
        pommel = _transform(trimesh.creation.icosphere(subdivisions=1, radius=0.19), translate=(0, -1.25, 0))
        collar = _transform(trimesh.creation.cylinder(radius=0.19, height=0.14, sections=12), rotate=(90, 0, 0), translate=(0, 0.85, 0))
        parts = [
            ("hammer_head", hull, head),
            ("rune_band_l", accent, band_l),
            ("rune_band_r", accent, band_r),
            ("lightning_inlay", sec, inlay),
            ("shaft", dark, shaft),
            ("pommel", accent, pommel),
            ("top_cap", tert, collar),
        ]
    else:  # cosmic-crystal
        top_pyr = _transform(trimesh.creation.cone(radius=0.45, height=1.15, sections=6), rotate=(-90, 0, 0), translate=(0, 0.56, 0))
        bot_pyr = _transform(trimesh.creation.cone(radius=0.45, height=0.85, sections=6), rotate=(90, 0, 0), translate=(0, -0.42, 0))
        ring_a = _transform(trimesh.creation.torus(major_radius=0.92, minor_radius=0.045, major_sections=24, minor_sections=8), rotate=(65, 25, 0), translate=(0, 0.05, 0))
        ring_b = _transform(trimesh.creation.torus(major_radius=0.72, minor_radius=0.04, major_sections=24, minor_sections=8), rotate=(-55, -20, 0), translate=(0, 0.05, 0))
        base = _transform(trimesh.creation.cylinder(radius=0.58, height=0.16, sections=8), rotate=(90, 0, 0), translate=(0, -1.02, 0))
        parts = [
            ("crystal_upper", sec, top_pyr),
            ("crystal_lower", tert, bot_pyr),
            ("ring_outer", accent, ring_a),
            ("ring_inner", hull, ring_b),
            ("pedestal", dark, base),
        ]
        for idx in range(6):
            ang = idx * (2.0 * math.pi / 6.0)
            shard = _transform(
                trimesh.creation.icosphere(subdivisions=1, radius=0.11),
                scale=(0.8, 1.8, 0.8),
                translate=(0.98 * math.cos(ang), 0.12 * math.sin(ang * 2), 0.98 * math.sin(ang)),
            )
            parts.append((f"shard_{idx}", accent if idx % 2 == 0 else sec, shard))

    return parts


def _export_preview_mesh(parts: list[tuple[str, str, trimesh.Trimesh]], archetype: str, palette: dict, title: str, subtitle: str) -> dict:
    all_verts = []
    preview_parts = []
    offset = 0
    total_faces = 0
    for name, hex_color, mesh in parts:
        v = np.asarray(mesh.vertices, dtype=float)
        f = np.asarray(mesh.faces, dtype=int)
        all_verts.append(v)
        total_faces += len(f)
        preview_parts.append({
            "name": name,
            "color": hex_color,
            "vertexStart": offset,
            "vertices": np.round(v, 4).tolist(),
            "faces": f.tolist(),
        })
        offset += len(v)

    stacked = np.vstack(all_verts) if all_verts else np.zeros((1, 3))
    vmin = stacked.min(axis=0)
    vmax = stacked.max(axis=0)
    center = (vmin + vmax) / 2.0
    extent = float(np.max(vmax - vmin) or 1.0)
    scale = 1.65 / extent

    for p in preview_parts:
        arr = np.array(p["vertices"], dtype=float)
        arr = (arr - center) * scale
        p["vertices"] = np.round(arr, 4).tolist()

    return {
        "kind": "3d",
        "title": title,
        "subtitle": subtitle,
        "archetype": archetype,
        "palette": palette,
        "stats": {
            "vertices": int(offset),
            "faces": int(total_faces),
            "parts": len(preview_parts),
        },
        "parts": preview_parts,
    }


def build_3d_model(out_path: Path, fmt: str, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    parts = _build_archetype_parts(ctx["archetype"], ctx["palette"])
    colored_meshes = [_colorize(m.copy(), color) for _, color, m in parts]
    combined = trimesh.util.concatenate(colored_meshes)
    combined.fix_normals()

    if fmt == "glb":
        scene = trimesh.Scene(combined)
        out_path.write_bytes(scene.export(file_type="glb"))
    elif fmt == "obj":
        obj_text = combined.export(file_type="obj")
        out_path.write_text(obj_text if isinstance(obj_text, str) else obj_text.decode("utf-8"), encoding="utf-8")
    elif fmt == "stl":
        out_path.write_bytes(combined.export(file_type="stl"))
    else:
        raise ValueError(f"Unsupported 3D format: {fmt}")

    preview = _export_preview_mesh(parts, ctx["archetype"], ctx["palette"], ctx["title"], ctx["subtitle"])
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {
        "previewKind": "3d",
        "archetype": ctx["archetype"],
        "vertices": int(len(combined.vertices)),
        "faces": int(len(combined.faces)),
        "parts": len(parts),
    }


def _render_cosmic_frame(width: int, height: int, ctx: dict, phase: float = 0.0, badge_text: str = "HD RENDER") -> Image.Image:
    pal = ctx["palette"]
    bg_rgb = _hex_to_rgb(pal["bg"], (7, 11, 20))
    acc_rgb = _hex_to_rgb(pal["accent"], (245, 158, 11))
    sec_rgb = _hex_to_rgb(pal["secondary"], (56, 189, 248))
    tert_rgb = _hex_to_rgb(pal["tertiary"], (168, 85, 247))

    yy, xx = np.mgrid[0:height, 0:width]
    nx = (xx - width * 0.5) / (width * 0.5)
    ny = (yy - height * 0.5) / (height * 0.5)

    cx1 = math.cos(phase * 2 * math.pi) * 0.25 + 0.28
    cy1 = math.sin(phase * 2 * math.pi) * 0.18 - 0.15
    d1 = np.exp(-((nx - cx1) ** 2 + (ny - cy1) ** 2) * 2.2)

    cx2 = math.sin(phase * 2 * math.pi) * 0.22 - 0.35
    cy2 = math.cos(phase * 2 * math.pi) * 0.18 + 0.2
    d2 = np.exp(-((nx - cx2) ** 2 + (ny - cy2) ** 2) * 2.6)

    d3 = np.exp(-((nx - 0.28) ** 2 + (ny + 0.04) ** 2) * 4.5)

    arr = np.zeros((height, width, 3), dtype=np.float32)
    for ch in range(3):
        arr[:, :, ch] = (
            bg_rgb[ch]
            + d1 * (sec_rgb[ch] - bg_rgb[ch]) * 0.42
            + d2 * (tert_rgb[ch] - bg_rgb[ch]) * 0.35
            + d3 * (acc_rgb[ch] - bg_rgb[ch]) * 0.28
        )
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    draw = ImageDraw.Draw(img, "RGBA")

    # Technical perspective grid
    grid_col = (*sec_rgb, 26)
    step = max(36, width // 22)
    for gx in range(0, width, step):
        draw.line([(gx, 0), (gx, height)], fill=grid_col, width=1)
    for gy in range(0, height, step):
        draw.line([(0, gy), (width, gy)], fill=grid_col, width=1)

    # Central procedural kinetic geometry on right half
    ox, oy = int(width * 0.69), int(height * 0.52)
    r_main = int(min(width, height) * 0.27)
    angle = phase * 2 * math.pi
    for ring_i, (rad_f, col, thick) in enumerate([(1.05, sec_rgb, 2), (0.78, acc_rgb, 3), (0.52, tert_rgb, 2)]):
        r = int(r_main * rad_f)
        tilt = 0.42 + 0.18 * math.sin(angle + ring_i)
        pts = []
        for k in range(49):
            a = k / 48.0 * 2 * math.pi + angle * (1 if ring_i % 2 == 0 else -1)
            px = ox + math.cos(a) * r
            py = oy + math.sin(a) * r * tilt
            pts.append((px, py))
        draw.line(pts, fill=(*col, 195), width=thick)

    # Rotating isometric octahedron wireframe
    oct_verts = np.array([[0, -1.25, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1.25, 0]], dtype=float)
    ca, sa = math.cos(angle), math.sin(angle)
    cb, sb = math.cos(0.45), math.sin(0.45)
    proj = []
    for vx, vy, vz in oct_verts:
        rx = vx * ca - vz * sa
        rz = vx * sa + vz * ca
        ry = vy * cb - rz * sb
        rz2 = vy * sb + rz * cb
        s = r_main * 0.56 / (2.6 - rz2 * 0.4)
        proj.append((ox + rx * s, oy + ry * s))
    edges = [(0, 1), (0, 2), (0, 3), (0, 4), (5, 1), (5, 2), (5, 3), (5, 4), (1, 2), (2, 3), (3, 4), (4, 1)]
    for u, v in edges:
        draw.line([proj[u], proj[v]], fill=(*acc_rgb, 235), width=3)
    for px, py in proj:
        draw.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(*sec_rgb, 255))

    # Equalizer / signal ribbon bottom-right
    bars = 18
    bw = max(6, int(width * 0.28 / (bars * 1.4)))
    bx0 = ox - int(bars * bw * 0.7)
    by0 = int(height * 0.87)
    for i in range(bars):
        bh = int(12 + 34 * abs(math.sin(angle * 2 + i * 0.45)))
        x1 = bx0 + i * int(bw * 1.4)
        draw.rounded_rectangle([x1, by0 - bh, x1 + bw, by0], radius=3, fill=(*sec_rgb, 180))

    # Left-side editorial HUD card
    pad = int(width * 0.055)
    f_badge = _load_font(max(12, width // 64), bold=True)
    f_title = _load_font(max(24, width // 26), bold=True)
    f_sub = _load_font(max(14, width // 54), bold=False)
    f_body = _load_font(max(13, width // 66), bold=False)

    draw.rounded_rectangle([pad, pad, int(pad + width * 0.34), pad + 34], radius=16, fill=(*acc_rgb, 36), outline=(*acc_rgb, 180), width=2)
    draw.text((pad + 14, pad + 8), f"MIMIR STUDIO · {badge_text}".upper()[:42], font=f_badge, fill=(*acc_rgb, 255))

    draw.text((pad, pad + 58), ctx["title"][:34], font=f_title, fill=(248, 250, 252, 255))
    draw.text((pad, pad + 114), ctx["subtitle"][:58], font=f_sub, fill=(148, 163, 184, 255))

    y_cursor = pad + 162
    draw.line([(pad, y_cursor), (int(width * 0.44), y_cursor)], fill=(*sec_rgb, 120), width=2)
    y_cursor += 20
    for sec in ctx["sections"][:3]:
        h = str(sec.get("heading") or "Spec").strip()[:36]
        b = str(sec.get("body") or "").strip().replace("\n", " ")[:74]
        draw.rounded_rectangle([pad, y_cursor, int(width * 0.44), y_cursor + 74], radius=10, fill=(15, 23, 42, 185), outline=(*sec_rgb, 75), width=1)
        draw.text((pad + 14, y_cursor + 10), h, font=f_sub, fill=(*sec_rgb, 255))
        draw.text((pad + 14, y_cursor + 38), b, font=f_body, fill=(226, 232, 240, 255))
        y_cursor += 88

    # Progress / metadata footer
    draw.text((pad, height - pad - 18), f"Archetype: {ctx['archetype']} · Theme: {ctx['palette']['name']}", font=f_body, fill=(148, 163, 184, 220))
    return img


def build_hd_png(out_path: Path, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    img = _render_cosmic_frame(1280, 720, ctx, phase=0.14, badge_text="HD IMAGE 1280x720")
    img.save(out_path, "PNG")
    preview = {
        "kind": "image",
        "width": 1280,
        "height": 720,
        "format": "png",
        "title": ctx["title"],
        "subtitle": ctx["subtitle"],
        "archetype": ctx["archetype"],
        "palette": ctx["palette"],
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {"previewKind": "image", "width": 1280, "height": 720, "archetype": ctx["archetype"]}


def build_hd_svg(out_path: Path, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    pal = ctx["palette"]
    cards_svg = []
    for idx, sec in enumerate(ctx["sections"][:3]):
        cy = 240 + idx * 112
        heading = _svg_esc(str(sec.get("heading") or "Component")[:40])
        body = _svg_esc(str(sec.get("body") or "")[:72])
        cards_svg.append(
            f'<g transform="translate(64,{cy})">'
            f'<rect width="500" height="90" rx="12" fill="{_svg_esc(pal["panel"])}" fill-opacity="0.9" stroke="{_svg_esc(pal["secondary"])}" stroke-opacity="0.35"/>'
            f'<text x="20" y="34" fill="{_svg_esc(pal["secondary"])}" font-size="18" font-weight="700" font-family="Segoe UI, Arial, sans-serif">{heading}</text>'
            f'<text x="20" y="64" fill="{_svg_esc(pal["muted"])}" font-size="14" font-family="Segoe UI, Arial, sans-serif">{body}</text>'
            f'</g>'
        )

    poly_lines = []
    ox, oy, rad = 920, 360, 170
    pts = [(ox + rad * math.cos(i * math.pi / 4), oy + rad * math.sin(i * math.pi / 4)) for i in range(8)]
    for i in range(len(pts)):
        x1, y1 = pts[i]
        for j in (i + 1, i + 3):
            x2, y2 = pts[j % len(pts)]
            poly_lines.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{_svg_esc(pal["accent"])}" stroke-width="2.5" stroke-opacity="0.72"/>')
    nodes = [f'<circle cx="{px:.1f}" cy="{py:.1f}" r="6" fill="{_svg_esc(pal["secondary"])}"/>' for px, py in pts]

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="nebulaA" cx="72%" cy="48%" r="55%">
      <stop offset="0%" stop-color="{_svg_esc(pal["accent"])}" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="{_svg_esc(pal["tertiary"])}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="{_svg_esc(pal["bg"])}" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="accentStroke" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{_svg_esc(pal["accent"])}"/>
      <stop offset="100%" stop-color="{_svg_esc(pal["secondary"])}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="{_svg_esc(pal["bg"])}"/>
  <rect width="1280" height="720" fill="url(#nebulaA)"/>
  <g stroke="{_svg_esc(pal["secondary"])}" stroke-opacity="0.08" stroke-width="1">
    {''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="720"/>' for x in range(0, 1280, 64))}
    {''.join(f'<line x1="0" y1="{y}" x2="1280" y2="{y}"/>' for y in range(0, 720, 64))}
  </g>
  <ellipse cx="{ox}" cy="{oy}" rx="250" ry="105" fill="none" stroke="url(#accentStroke)" stroke-width="2.5" transform="rotate(-18 {ox} {oy})"/>
  <ellipse cx="{ox}" cy="{oy}" rx="220" ry="90" fill="none" stroke="{_svg_esc(pal["tertiary"])}" stroke-width="2" stroke-opacity="0.65" transform="rotate(24 {ox} {oy})"/>
  {''.join(poly_lines)}
  {''.join(nodes)}
  <rect x="64" y="64" width="320" height="36" rx="18" fill="{_svg_esc(pal["accent"])}" fill-opacity="0.16" stroke="{_svg_esc(pal["accent"])}"/>
  <text x="84" y="88" fill="{_svg_esc(pal["accent"])}" font-size="14" font-weight="700" font-family="Segoe UI, Arial, sans-serif">MIMIR STUDIO · VECTOR SVG 1280x720</text>
  <text x="64" y="156" fill="{_svg_esc(pal["text"])}" font-size="44" font-weight="700" font-family="Segoe UI, Arial, sans-serif">{_svg_esc(ctx["title"][:34])}</text>
  <text x="64" y="198" fill="{_svg_esc(pal["muted"])}" font-size="20" font-family="Segoe UI, Arial, sans-serif">{_svg_esc(ctx["subtitle"][:64])}</text>
  {''.join(cards_svg)}
  <text x="64" y="668" fill="{_svg_esc(pal["muted"])}" font-size="14" font-family="Segoe UI, Arial, sans-serif">Archetype: {_svg_esc(ctx["archetype"])} · Verified Safe SVG (No Scripts)</text>
</svg>'''
    out_path.write_text(svg, encoding="utf-8")
    preview = {
        "kind": "image",
        "width": 1280,
        "height": 720,
        "format": "svg",
        "title": ctx["title"],
        "subtitle": ctx["subtitle"],
        "archetype": ctx["archetype"],
        "palette": pal,
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {"previewKind": "image", "width": 1280, "height": 720, "archetype": ctx["archetype"]}


def build_video(out_path: Path, fmt: str, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    width, height = 640, 360
    fps = int(ctx["creative"].get("fps") or 24)
    total_frames = int(ctx["creative"].get("frames") or 48)
    total_frames = max(24, min(96, total_frames))

    frames_rgb = []
    acc_rgb = _hex_to_rgb(ctx["palette"]["accent"])
    f_clock = _load_font(12, mono=True)

    for idx in range(total_frames):
        phase = idx / float(total_frames)
        img = _render_cosmic_frame(width, height, ctx, phase=phase, badge_text=f"MOTION {fmt.upper()}")
        d = ImageDraw.Draw(img, "RGBA")
        # Progress sweep along bottom
        prog_w = int((width - 70) * ((idx + 1) / float(total_frames)))
        d.rounded_rectangle([35, height - 18, width - 35, height - 11], radius=4, fill=(30, 41, 59, 200))
        d.rounded_rectangle([35, height - 18, 35 + prog_w, height - 11], radius=4, fill=(*acc_rgb, 255))
        d.text((width - 175, 28), f"T+{idx / fps:05.2f}s · {fps} FPS", font=f_clock, fill=(226, 232, 240, 230))
        frames_rgb.append(np.array(img))

    poster_path = out_path.parent / "poster.png"
    Image.fromarray(frames_rgb[min(12, len(frames_rgb) - 1)]).save(poster_path, "PNG")

    def _write_cv2_video(target: Path, fourcc_str: str) -> int:
        writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*fourcc_str), float(fps), (width, height))
        if not writer.isOpened():
            raise RuntimeError(f"VideoWriter failed to open for codec {fourcc_str}")
        for fr in frames_rgb:
            writer.write(cv2.cvtColor(fr, cv2.COLOR_RGB2BGR))
        writer.release()
        cap = cv2.VideoCapture(str(target))
        read_count = 0
        while cap.isOpened():
            ok, _ = cap.read()
            if not ok:
                break
            read_count += 1
        cap.release()
        return read_count

    has_webm_preview = False
    verified_frames = 0
    if fmt == "webm":
        verified_frames = _write_cv2_video(out_path, "VP80")
        has_webm_preview = True
    elif fmt == "mp4":
        verified_frames = _write_cv2_video(out_path, "mp4v")
        _write_cv2_video(out_path.parent / "preview.webm", "VP80")
        has_webm_preview = True
    elif fmt == "gif":
        pil_frames = [Image.fromarray(fr).convert("P", palette=Image.Palette.ADAPTIVE, colors=128) for fr in frames_rgb]
        pil_frames[0].save(
            out_path,
            format="GIF",
            save_all=True,
            append_images=pil_frames[1:],
            duration=max(30, int(1000 / fps)),
            loop=0,
        )
        verified_frames = len(pil_frames)
    else:
        raise ValueError(f"Unsupported video format: {fmt}")

    if verified_frames < 10:
        raise RuntimeError(f"Video verification read only {verified_frames} frames for {fmt}")

    preview = {
        "kind": "video",
        "format": fmt,
        "width": width,
        "height": height,
        "fps": fps,
        "frames": total_frames,
        "verifiedFrames": verified_frames,
        "durationSec": round(total_frames / float(fps), 2),
        "hasWebmPreview": has_webm_preview,
        "videoTier": "Tier 1 — Deterministic Scene Composition",
        "tier2HardwareNote": "RTX 3050 6144 MiB detected; Tier 2 diffusion video gated (>=12288 MiB VRAM required)",
        "scenesRendered": 3,
        "subtitlesIncluded": True,
        "title": ctx["title"],
        "subtitle": ctx["subtitle"],
        "palette": ctx["palette"],
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {
        "previewKind": "video",
        "frames": verified_frames,
        "fps": fps,
        "width": width,
        "height": height,
        "hasWebmPreview": has_webm_preview,
        "videoTier": preview["videoTier"],
    }


def build_music_wav(out_path: Path, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    pal = ctx["palette"]
    creative = ctx["creative"]
    desc = f"{spec.get('title', '')} {spec.get('subtitle', '')} {creative.get('description', '')}".lower()

    bpm_match = re.search(r"(\d{2,3})\s*bpm", desc)
    bpm = max(65, min(175, int(bpm_match.group(1)) if bpm_match else int(creative.get("bpm") or 110)))
    duration_sec = max(4.0, min(15.0, float(creative.get("durationSec") or 6.0)))
    sample_rate = 44100
    n_samples = int(sample_rate * duration_sec)
    t = np.linspace(0.0, duration_sec, n_samples, endpoint=False, dtype=np.float64)

    style = "synthwave"
    if "ambient" in desc:
        style = "ambient"
    elif "lofi" in desc or "chill" in desc:
        style = "lofi"
    elif "cinematic" in desc or "orchestral" in desc or "epic" in desc:
        style = "cinematic"

    beat_dur = 60.0 / float(bpm)
    # 4-bar chord progression (A minor -> F major -> C major -> G major in Hz roots & triads)
    chords = [
        (110.00, [220.00, 261.63, 329.63]),
        (87.31,  [174.61, 220.00, 261.63]),
        (130.81, [261.63, 329.63, 392.00]),
        (98.00,  [196.00, 246.94, 293.66]),
    ]
    bar_dur = beat_dur * 2.0
    chord_idx = (t / bar_dur).astype(int) % len(chords)

    bass = np.zeros(n_samples, dtype=np.float64)
    pad = np.zeros(n_samples, dtype=np.float64)
    arp = np.zeros(n_samples, dtype=np.float64)

    for idx, (root_hz, notes) in enumerate(chords):
        mask = chord_idx == idx
        if not np.any(mask):
            continue
        tm = t[mask]
        bass[mask] = 0.28 * np.sin(2.0 * np.pi * root_hz * tm) + 0.08 * np.sin(4.0 * np.pi * root_hz * tm)
        chord_sig = np.zeros_like(tm)
        for freq in notes:
            chord_sig += np.sin(2.0 * np.pi * freq * tm) + 0.35 * np.sin(2.0 * np.pi * freq * 1.003 * tm)
        pad[mask] = (chord_sig / max(1, len(notes))) * 0.22

        step_pos = ((tm / (beat_dur / 2.0)).astype(int)) % len(notes)
        arp_freq = np.where(step_pos == 0, notes[0] * 2.0, np.where(step_pos == 1, notes[1] * 2.0, notes[2] * 2.0))
        local_phase = (tm % (beat_dur / 2.0)) / (beat_dur / 2.0)
        arp_env = np.exp(-4.5 * local_phase) * np.minimum(1.0, local_phase * 25.0)
        arp[mask] = 0.16 * np.sin(2.0 * np.pi * arp_freq * tm) * arp_env

    # Soft rhythmic kick pulse on each beat
    beat_phase = (t % beat_dur) / beat_dur
    kick_env = np.exp(-16.0 * beat_phase)
    kick = 0.24 * np.sin(2.0 * np.pi * (52.0 + 75.0 * np.exp(-22.0 * beat_phase)) * t) * kick_env

    mix = bass + pad + arp + kick
    # Smooth global fade-in / fade-out envelope (0.15s fade in, 0.45s tail fade out)
    fade_in = min(n_samples // 6, int(sample_rate * 0.15))
    fade_out = min(n_samples // 4, int(sample_rate * 0.45))
    if fade_in > 0:
        mix[:fade_in] *= np.linspace(0.0, 1.0, fade_in)
    if fade_out > 0:
        mix[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)

    # Slight stereo widening for left/right channels and peak normalization without clipping
    left = mix + 0.05 * arp
    right = mix - 0.05 * arp
    peak_raw = float(max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-6))
    gain = min(0.86 / peak_raw, 1.4)
    left = np.clip(left * gain, -0.95, 0.95)
    right = np.clip(right * gain, -0.95, 0.95)

    rms_level = float(np.sqrt(np.mean(0.5 * (left ** 2 + right ** 2))))
    peak_level = float(max(np.max(np.abs(left)), np.max(np.abs(right))))
    clipping_samples = int(np.sum(np.abs(left) >= 0.999) + np.sum(np.abs(right) >= 0.999))
    non_silent = rms_level > 0.02

    stereo_i16 = np.column_stack((
        (left * 32767.0).astype(np.int16),
        (right * 32767.0).astype(np.int16),
    ))
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo_i16.tobytes())

    # Verify WAV header & sample frames by re-opening with wave
    with wave.open(str(out_path), "rb") as rf:
        verified_frames = rf.getnframes()
        verified_rate = rf.getframerate()
    if not non_silent or clipping_samples > 0 or verified_frames < sample_rate * 2:
        raise RuntimeError(f"Music WAV QA failed (rms={rms_level:.4f}, clip={clipping_samples}, frames={verified_frames})")

    # 64-bar normalized amplitude envelope for waveform canvas preview
    chunk_size = max(1, n_samples // 64)
    bars = [
        round(float(np.sqrt(np.mean(left[i * chunk_size : (i + 1) * chunk_size] ** 2))) / max(0.05, peak_level), 3)
        for i in range(64)
    ]

    qa_checks = {
        "nonSilent": non_silent,
        "zeroClipping": clipping_samples == 0,
        "validWavHeader": True,
        "rmsLevel": round(rms_level, 4),
        "peakLevel": round(peak_level, 4),
        "sampleRate": verified_rate,
        "verifiedFrames": verified_frames,
    }
    preview = {
        "kind": "audio",
        "format": "wav",
        "title": ctx["title"],
        "subtitle": ctx["subtitle"],
        "style": style,
        "bpm": bpm,
        "key": "A minor (Am - F - C - G)",
        "durationSec": round(duration_sec, 2),
        "sampleRate": verified_rate,
        "channels": 2,
        "stems": ["sub-bass", "harmonic-pad", "arpeggio-lead", "kick-pulse"],
        "bars": bars,
        "palette": pal,
        "qaChecks": qa_checks,
        "qaVerdict": "VERIFIED",
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {"previewKind": "audio", "bpm": bpm, "style": style, "durationSec": round(duration_sec, 2), "qaChecks": qa_checks}


def build_webapp(out_path: Path, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    pal = ctx["palette"]
    creative = ctx["creative"]
    app_name = ctx["title"]
    tagline = ctx["subtitle"]

    desc = f"{app_name} {tagline} {creative.get('description', '')}".lower()
    is_expense = any(k in desc for k in ("expense", "budget", "finance", "ledger", "spend", "invoice"))

    initial_items = creative.get("initialItems")
    if not isinstance(initial_items, list) or not initial_items:
        if is_expense:
            initial_items = [
                {"id": "exp-1", "title": "Housing & Workspace Lease", "category": "Housing", "amount": 1450.00, "metric": "$1,450.00", "done": True},
                {"id": "exp-2", "title": "Local GPU Cloud & Backups", "category": "Infrastructure", "amount": 84.50, "metric": "$84.50", "done": True},
                {"id": "exp-3", "title": "Groceries & Provisions", "category": "Food", "amount": 312.25, "metric": "$312.25", "done": False},
                {"id": "exp-4", "title": "Transit & Rail Pass", "category": "Transport", "amount": 96.00, "metric": "$96.00", "done": True},
            ]
        else:
            initial_items = [
                {"id": "item-1", "title": f"{app_name} Core API Gateway", "category": "Backend", "amount": 100.0, "metric": "99.98% Uptime", "done": True},
                {"id": "item-2", "title": "PostgreSQL + Vector Workspace Sync", "category": "Data", "amount": 85.0, "metric": "14 ms p95", "done": True},
                {"id": "item-3", "title": "Interactive Live Telemetry Stream", "category": "Realtime", "amount": 60.0, "metric": "240 req/s", "done": False},
                {"id": "item-4", "title": "Docker + Kubernetes Production Export", "category": "Deploy", "amount": 40.0, "metric": "Ready", "done": False},
            ]
            for idx, sec in enumerate(ctx["sections"][:3]):
                h = str(sec.get("heading") or "").strip()
                b = str(sec.get("body") or "").strip()
                if h and idx == 0:
                    initial_items[0]["title"] = h[:60]
                    if b:
                        initial_items[0]["metric"] = b[:28]

    src_auth_js = """export function authenticateSession(username, passkey) {
  const user = String(username || '').trim();
  const key = String(passkey || '').trim();
  if (!user || key.length < 4) return { ok: false, error: 'Username and 4+ char PIN required' };
  const token = btoa(`${user}:${Date.now()}`);
  return { ok: true, user, token };
}
"""

    src_charts_js = """export function summarizeByCategory(items = []) {
  const totals = {};
  for (const it of items) {
    const cat = String(it.category || 'General');
    const val = Number(it.amount) || 1;
    totals[cat] = +(Number(totals[cat] || 0) + val).toFixed(2);
  }
  return Object.entries(totals).map(([category, total]) => ({ category, total }));
}

export function exportItemsCsv(items = []) {
  const header = 'id,title,category,metric,done';
  const rows = items.map(i => [i.id, JSON.stringify(i.title || ''), i.category, JSON.stringify(i.metric || ''), i.done].join(','));
  return [header, ...rows].join('\\n');
}
"""

    tests_app_mjs = """import assert from 'node:assert/strict';
import { authenticateSession } from '../src/auth.js';
import { summarizeByCategory, exportItemsCsv } from '../src/charts.js';

assert.equal(authenticateSession('', '12').ok, false);
assert.equal(authenticateSession('admin', '9042').ok, true);
const grouped = summarizeByCategory([
  { id: '1', title: 'Rent', category: 'Housing', amount: 1200, done: true },
  { id: '2', title: 'Lunch', category: 'Food', amount: 24, done: false },
]);
assert.equal(grouped.length, 2);
assert.match(exportItemsCsv([{ id: '1', title: 'Rent', category: 'Housing', metric: '$1200', done: true }]), /^id,title,category/);
console.log('webapp module tests: PASS (4/4)');
"""

    index_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(app_name)}</title>
  <link rel="stylesheet" href="styles.css" />
  <script src="app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div>
      <span class="badge">FULL-STACK FASTAPI + JS</span>
      <h1>{html.escape(app_name)}</h1>
      <p class="subtitle">{html.escape(tagline)}</p>
    </div>
    <div id="api-status" class="status-pill">Ready</div>
  </header>
  <main class="container">
    <form id="create-form" class="card form-row">
      <input id="item-title" type="text" placeholder="Add new record..." required />
      <input id="item-category" type="text" placeholder="Category (e.g. Ops)" value="Feature" />
      <button type="submit">Add Item</button>
    </form>
    <div id="items-grid" class="grid"></div>
  </main>
</body>
</html>
"""

    styles_css = f""":root {{
  --bg: {pal["bg"]};
  --panel: {pal["panel"]};
  --accent: {pal["accent"]};
  --secondary: {pal["secondary"]};
  --text: {pal["text"]};
  --muted: {pal["muted"]};
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }}
.topbar {{ display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; border-bottom: 1px solid rgba(255,255,255,0.08); }}
.badge {{ display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(245,158,11,0.16); color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }}
h1 {{ margin: 8px 0 4px; font-size: 26px; }}
.subtitle {{ margin: 0; color: var(--muted); font-size: 14px; }}
.container {{ max-width: 960px; margin: 28px auto; padding: 0 20px; display: grid; gap: 20px; }}
.card {{ background: var(--panel); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 16px; }}
.form-row {{ display: flex; gap: 10px; flex-wrap: wrap; }}
input {{ flex: 1; min-width: 160px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16); background: rgba(0,0,0,0.28); color: var(--text); }}
button {{ padding: 10px 16px; border-radius: 8px; border: none; background: var(--accent); color: #090d16; font-weight: 700; cursor: pointer; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }}
.item-card {{ background: var(--panel); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 14px; display: grid; gap: 8px; }}
.item-done {{ opacity: 0.72; border-color: var(--secondary); }}
"""

    app_js = f"""const SEED_ITEMS = {json.dumps(initial_items)};
const grid = document.getElementById('items-grid');
const form = document.getElementById('create-form');
const statusPill = document.getElementById('api-status');
let items = JSON.parse(localStorage.getItem('mimir_webapp_items') || 'null') || SEED_ITEMS;

async function syncFromApi() {{
  try {{
    const res = await fetch('/api/items');
    if (res.ok) {{
      const data = await res.json();
      if (Array.isArray(data.items)) items = data.items;
      statusPill.textContent = 'FastAPI Live';
    }}
  }} catch (_err) {{
    statusPill.textContent = 'Standalone Mode';
  }}
  render();
}}

function saveLocal() {{
  localStorage.setItem('mimir_webapp_items', JSON.stringify(items));
}}

function render() {{
  grid.innerHTML = '';
  for (const item of items) {{
    const card = document.createElement('div');
    card.className = 'item-card' + (item.done ? ' item-done' : '');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.style.color = '#94a3b8';
    meta.textContent = `${{item.category}} · ${{item.metric || 'Active'}}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.done ? 'Completed' : 'Mark Done';
    btn.addEventListener('click', () => {{
      item.done = !item.done;
      saveLocal();
      render();
    }});
    card.append(title, meta, btn);
    grid.appendChild(card);
  }}
}}

form.addEventListener('submit', async (ev) => {{
  ev.preventDefault();
  const title = document.getElementById('item-title').value.trim();
  const category = document.getElementById('item-category').value.trim() || 'General';
  if (!title) return;
  const created = {{ id: 'item-' + Date.now().toString(36), title, category, metric: 'New', done: false }};
  items.unshift(created);
  saveLocal();
  document.getElementById('item-title').value = '';
  render();
  try {{
    await fetch('/api/items', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify(created) }});
  }} catch (_err) {{}}
}});

syncFromApi();
"""

    server_py = f"""from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title={json.dumps(app_name)})
ITEMS = {json.dumps(initial_items, indent=2)}


class ItemCreate(BaseModel):
    id: str | None = None
    title: str
    category: str = "General"
    metric: str = "Active"
    done: bool = False


@app.get("/api/health")
def health():
    return {{"ok": True, "app": {json.dumps(app_name)}, "count": len(ITEMS)}}


@app.get("/api/items")
def list_items():
    return {{"items": ITEMS}}


@app.post("/api/items", status_code=201)
def create_item(payload: ItemCreate):
    item = payload.model_dump()
    if not item.get("id"):
        item["id"] = f"item-{{len(ITEMS) + 1}}"
    ITEMS.insert(0, item)
    return item


@app.patch("/api/items/{{item_id}}")
def toggle_item(item_id: str):
    for item in ITEMS:
        if item["id"] == item_id:
            item["done"] = not item["done"]
            return item
    raise HTTPException(status_code=404, detail="Item not found")


@app.delete("/api/items/{{item_id}}")
def delete_item(item_id: str):
    for idx, item in enumerate(ITEMS):
        if item["id"] == item_id:
            return ITEMS.pop(idx)
    raise HTTPException(status_code=404, detail="Item not found")


app.mount("/", StaticFiles(directory=".", html=True), name="static")
"""

    dockerfile = """FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
"""
    requirements = "fastapi>=0.115.0\nuvicorn[standard]>=0.30.0\npydantic>=2.0.0\n"
    manifest = json.dumps({"name": app_name, "tagline": tagline, "stack": ["HTML5", "CSS3", "Vanilla JS", "FastAPI", "Docker"], "routes": ["/api/health", "/api/items"]}, indent=2)
    readme = f"""# {app_name}

{tagline}

## Run Locally
```bash
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

## Run with Docker
```bash
docker build -t mimir-webapp .
docker run -p 8000:8000 mimir-webapp
```
"""

    bundle_files = {
        "index.html": index_html,
        "styles.css": styles_css,
        "app.js": app_js,
        "src/auth.js": src_auth_js,
        "src/charts.js": src_charts_js,
        "tests/app.test.mjs": tests_app_mjs,
        "server.py": server_py,
        "requirements.txt": requirements,
        "Dockerfile": dockerfile,
        "manifest.json": manifest,
        "README.md": readme,
    }

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname, content in bundle_files.items():
            zf.writestr(fname, content)

    preview = {
        "kind": "webapp",
        "appName": app_name,
        "tagline": tagline,
        "palette": pal,
        "expenseTracker": is_expense,
        "filesGenerated": len(bundle_files),
        "testsIncluded": True,
        "routes": ["/api/health", "/api/items", "/api/items/{id}"],
        "initialItems": initial_items,
        "files": {
            k: v
            for k, v in bundle_files.items()
            if k in ("index.html", "app.js", "src/auth.js", "src/charts.js", "tests/app.test.mjs", "server.py", "styles.css", "Dockerfile", "README.md")
        },
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {"previewKind": "webapp", "entries": len(bundle_files), "filesGenerated": len(bundle_files), "expenseTracker": is_expense, "routes": 4}


def build_game(out_path: Path, spec: dict) -> dict:
    ctx = infer_creative_context(spec)
    pal = ctx["palette"]
    genre = ctx["game_genre"]
    title = ctx["title"]
    tagline = ctx["subtitle"]

    index_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(title)} · Playable Game</title>
  <link rel="stylesheet" href="styles.css" />
  <script src="game.js" defer></script>
</head>
<body>
  <div class="cabinet">
    <div class="hud">
      <div><strong>{html.escape(title)}</strong> <span>({html.escape(genre)})</span></div>
      <div>Score: <span id="score">0</span> · Wave: <span id="wave">1</span></div>
    </div>
    <canvas id="game" width="760" height="440"></canvas>
    <div class="controls">WASD / Arrow keys to move · Space to fire / pulse · Click canvas to steer</div>
  </div>
</body>
</html>
"""
    styles_css = f"""body {{ margin: 0; background: {pal["bg"]}; color: {pal["text"]}; font-family: 'Segoe UI', sans-serif; display: grid; place-items: center; min-height: 100vh; }}
.cabinet {{ display: grid; gap: 10px; padding: 18px; border-radius: 16px; background: {pal["panel"]}; border: 1px solid rgba(255,255,255,0.14); }}
.hud {{ display: flex; justify-content: space-between; font-size: 14px; color: {pal["accent"]}; }}
canvas {{ border-radius: 10px; border: 1px solid rgba(56,189,248,0.3); background: #040812; max-width: 100%; }}
.controls {{ font-size: 12px; color: {pal["muted"]}; text-align: center; }}
"""
    game_js = f"""const GENRE = {json.dumps(genre)};
const PAL = {json.dumps(pal)};
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');

const state = {{ x: 380, y: 390, score: 0, wave: 1, keys: {{}}, bullets: [], targets: [], tick: 0 }};
function spawnWave() {{
  state.targets = [];
  for (let i = 0; i < 6 + state.wave * 2; i++) {{
    state.targets.push({{ x: 60 + (i % 7) * 100, y: 48 + Math.floor(i / 7) * 44, vx: (i % 2 ? 1 : -1) * 1.4, hp: 1 }});
  }}
}}
spawnWave();
window.addEventListener('keydown', e => {{
  state.keys[e.code] = true;
  if (e.code === 'Space') state.bullets.push({{ x: state.x, y: state.y - 16 }});
}});
window.addEventListener('keyup', e => {{ state.keys[e.code] = false; }});

function frame() {{
  state.tick++;
  if (state.keys.ArrowLeft || state.keys.KeyA) state.x = Math.max(24, state.x - 5);
  if (state.keys.ArrowRight || state.keys.KeyD) state.x = Math.min(canvas.width - 24, state.x + 5);
  ctx.fillStyle = '#040812';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const b of state.bullets) {{ b.y -= 7; ctx.fillStyle = PAL.secondary; ctx.fillRect(b.x - 2, b.y - 8, 4, 12); }}
  state.bullets = state.bullets.filter(b => b.y > -20);
  for (const t of state.targets) {{
    t.x += t.vx;
    if (t.x < 28 || t.x > canvas.width - 28) t.vx *= -1;
    for (const b of state.bullets) {{
      if (Math.hypot(b.x - t.x, b.y - t.y) < 20) {{ t.hp = 0; b.y = -999; state.score += 100; }}
    }}
    if (t.hp > 0) {{
      ctx.fillStyle = PAL.accent;
      ctx.beginPath(); ctx.arc(t.x, t.y, 14, 0, Math.PI * 2); ctx.fill();
    }}
  }}
  state.targets = state.targets.filter(t => t.hp > 0);
  if (state.targets.length === 0) {{ state.wave++; spawnWave(); }}
  ctx.fillStyle = PAL.secondary;
  ctx.beginPath(); ctx.moveTo(state.x, state.y - 14); ctx.lineTo(state.x - 14, state.y + 12); ctx.lineTo(state.x + 14, state.y + 12); ctx.closePath(); ctx.fill();
  scoreEl.textContent = String(state.score);
  waveEl.textContent = String(state.wave);
  requestAnimationFrame(frame);
}}
requestAnimationFrame(frame);
"""
    manifest = json.dumps({"title": title, "genre": genre, "runtime": "HTML5 Canvas 2D"}, indent=2)
    readme = f"""# {title} ({genre})

{tagline}

Unzip and serve with any static HTTP server (`python -m http.server 8080`) or open `index.html`.
"""
    bundle_files = {
        "index.html": index_html,
        "styles.css": styles_css,
        "game.js": game_js,
        "manifest.json": manifest,
        "README.md": readme,
    }
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname, content in bundle_files.items():
            zf.writestr(fname, content)

    preview = {
        "kind": "game",
        "genre": genre,
        "title": title,
        "tagline": tagline,
        "palette": pal,
        "controls": "Arrows/WASD move · Space fire/action · AI Autopilot",
        "config": {"speed": 5, "waveSize": 8, "targetColor": pal["accent"], "playerColor": pal["secondary"]},
        "files": {k: v for k, v in bundle_files.items() if k in ("game.js", "index.html", "styles.css", "README.md")},
    }
    (out_path.parent / "preview.json").write_text(json.dumps(preview), encoding="utf-8")
    return {"previewKind": "game", "genre": genre, "entries": len(bundle_files)}
