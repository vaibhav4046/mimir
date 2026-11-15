# Intelligent UI Specification (`INTELLIGENT_UI_SPEC.md`)

## 1. Architecture
MIMIR renders structured task workspaces using a schema-driven `UISpecification` contract (`daemon/contracts.mjs`, `daemon/intelligent-ui.mjs`) and a trusted React registry (`renderer/components/IntelligentUiRenderer.jsx`). Models and tools never inject arbitrary React components, raw HTML, `<script>` tags, or inline event handlers.

## 2. Adaptive Surfaces (`UI_SURFACES`)
1. `chat` — Conversational responses, quick actions, and inline checklists/receipts.
2. `research` — Grounded `source_inspector`, citations, `comparison_table`, and quantitative `chart` blocks.
3. `code` — `code_editor` file previews, diffs, and build verification output.
4. `media` — `image_canvas`, `video_timeline`, `audio_player`, and studio artifacts.
5. `voice` — Full-duplex voice live interface synchronized with Mimir's speaking/listening state.
6. `automation` — Routines, workflows, and background job progress.
7. `memory` — Yggdrasil Atlas preview and deep knowledge navigation.

## 3. Approved Component Blocks (`UI_BLOCK_TYPES` — 16 Types)
`rich_text`, `source_inspector`, `comparison_table`, `chart`, `checklist`, `interactive_form`, `activity_timeline`, `code_editor`, `browser_preview`, `artifact_preview`, `image_canvas`, `video_timeline`, `audio_player`, `approval_dialog`, `task_receipt`, `yggdrasil_graph_preview`.

## 4. Validator & Action Security
- **`validateUiSpec(spec)`**: Validates `version === 1`, surface membership, block types against `UI_BLOCK_TYPES`, unregistered `actionId`s, and rejects `<script>`, `javascript:`, `<iframe>`, `dangerouslySetInnerHTML`, or `on*=` strings.
- **Sentinel Action Gateway (`POST /v1/ui/action`)**: Every button click, checklist toggle (`toggle_checklist_item`), form submit (`submit_form`), approval decision, or Space creation (`pin_space`) passes `sentinel.evaluateUiAction(...)` before mutating store state.
- **Endpoints**: `POST /v1/ui/plan`, `POST /v1/ui/validate`, `POST /v1/ui/action`, `GET /v1/ui/checklists`, `GET/POST/DELETE /v1/spaces`.
