# Multimodal Capability Matrix (`MULTIMODAL_CAPABILITY_MATRIX.md`)

| Domain | Formats | Engine / Worker | Verification Gate | Hardware Requirement |
|---|---|---|---|---|
| **Documents & Data** | `md`, `docx`, `pdf`, `pptx`, `xlsx`, `csv`, `html`, `json`, `zip` | `scripts/foundry_builder.py` (ReportLab, python-docx, python-pptx, XlsxWriter) | PyMuPDF re-read, XML/ZIP entry verification, SHA-256 digest | CPU, <500 MB RAM |
| **Music & Audio** | `wav`, `music` (44.1 kHz 16-bit Stereo PCM) | `scripts/creative_studio_builder.py` (`build_music_wav`, NumPy + `wave`) | Non-silence RMS `> 0.02`, zero clipping `== 0`, valid RIFF/WAVE header | CPU, <256 MB RAM |
| **Coding & Web Apps** | `webapp` (`.zip` + live sandbox preview) | `build_webapp` (HTML5, CSS3, `app.js`, `src/auth.js`, `src/charts.js`, `tests/app.test.mjs`, `server.py`, `Dockerfile`) | Multi-file ZIP integrity + runnable `node tests/app.test.mjs` | CPU + Node/Python |
| **Interactive Games** | `game` (`.zip` + HTML5 Canvas runtime) | `build_game` | Canvas runtime + key controls + autopilot verified | Browser 2D Canvas |
| **Video — Tier 1 (Deterministic)** | `mp4`, `webm`, `gif` | `build_video` (PIL + OpenCV + `imageio-ffmpeg` VP80/mp4v) | Reads back `>= 10` decoded frames + sidecar `poster.png` | CPU / GPU optional |
| **Video — Tier 2 (Generative)** | Hardware-Gated | Reported honestly on `/v1/hardware/capabilities` | Gated on `< 12288 MiB` VRAM -> routes cleanly to Tier 1 | `>= 12 GB` VRAM GPU or Cloud API |
| **Images & Vector Graphics** | `png` (1280x720), `svg` (multi-path) | `build_hd_png`, `build_hd_svg` | Image open/size verification & well-formed SVG XML | CPU / PIL |
| **3D Assets** | `glb`, `obj`, `stl` | `build_3d_model` (Trimesh procedural multi-part hierarchy + Orbit Canvas player) | Vertex/face count validation + binary glTF magic header | CPU + HTML5 Canvas |
