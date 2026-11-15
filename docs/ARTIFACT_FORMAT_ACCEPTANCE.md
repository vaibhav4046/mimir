# Artifact Foundry Format Verification & Delivery Security

## Supported Deliverable Formats (`daemon/foundry.mjs`)

Every generated artifact in `POST /v1/library/create` is written to workspace-isolated Foundry storage, hashed (`SHA-256`), recorded in the Rust/JSON artifact index, and validated structurally before returning `verified: true`:

| Format | Generator Stack | Structural Acceptance Check | HTTP Download Protections |
|---|---|---|---|
| `pdf` | ReportLab / structured PDF bytes | `%PDF-` header signature + byte size > 0 | `X-Content-Type-Options: nosniff` |
| `docx` | `python-docx` / OOXML package | PK ZIP header + valid document part | `X-Content-Type-Options: nosniff` |
| `pptx` | `python-pptx` / OOXML slide deck | PK ZIP header + slide XML parts | `X-Content-Type-Options: nosniff` |
| `xlsx` | `openpyxl` / structured workbook | PK ZIP header + sheet XML parts | `X-Content-Type-Options: nosniff` |
| `png` | Pillow RGBA raster renderer | `89 50 4E 47` PNG magic header | `X-Content-Type-Options: nosniff` |
| `svg` | Norse-palette vector builder | Clean `<svg ...>` XML with no `<script>` or event handlers | `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` |
| `zip` | Standard ZIP bundle archive | Valid PK central directory | `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` |
