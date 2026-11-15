# Model & Hardware Support (`MODEL_AND_HARDWARE_SUPPORT.md`)

## 1. Live Measured Hardware (`GET /v1/hardware/capabilities`)
- **Host CPU**: `12th Gen Intel(R) Core(TM) i5-12450HX`
- **System Memory**: `15.72 GB` (`16,478,072 KB`)
- **Primary Dedicated GPU**: `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` VRAM total)
- **Secondary Display Adapter**: `Intel(R) UHD Graphics`

## 2. Verified Ollama Models (`127.0.0.1:11434`)
| Model | On-Disk Size | Fit Rating on 6GB VRAM | Recommended Role |
|---|---|---|---|
| `qwen3:1.7b` | `1.4 GB` | Fast | Default low-latency tool calling, routing & voice dialogue |
| `qwen3.5:4b` | `3.3 GB` | Optimal | Balanced planning, coding, & multimodal reasoning |
| `qwen3.5:9b` | `6.6 GB` | Heavy (Partial Offload) | Deep long-context synthesis when latency is secondary |

## 3. Model Policy & Cloud Fallback
- **`localOnly: true` Guarantee**: Forces Ollama + offline Windows SAPI5 TTS + local `faster-whisper`, blocking remote APIs and web search.
- **Model Council Opt-In Policy**: `/v1/council/seats` publishes `councilEnabledByDefault: false` so single-model fast execution runs by default unless explicitly requested.
- **Video Tier Honesty**: Because local VRAM is `6144 MiB` (`< 12288 MiB` threshold for local video diffusion), `/v1/hardware/capabilities` reports `videoGenerativeTier2.status = "HARDWARE_GATED_VRAM_LIMIT"` and routes automatically to Tier 1 Deterministic Video Composition.
