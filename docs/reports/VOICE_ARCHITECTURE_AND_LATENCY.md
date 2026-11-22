# Voice Architecture & Latency (`VOICE_ARCHITECTURE_AND_LATENCY.md`)

## 1. Full-Duplex Voice Pipeline (`daemon/voice.mjs` + `scripts/voice_engine.py`)
- **Speech Recognition (STT)**: Local `faster-whisper` persistent Python worker daemon (`--mode daemon` stdio JSON-RPC) with Web Speech browser fallback.
- **Text-to-Speech (TTS)**: Offline Windows SAPI5 (`System.Speech.Synthesis`, `david-sapi` / `zira-sapi`) enforced under `localOnly` mode, plus optional neural `edge_tts` sentence-chunk streaming (`splitSpeechChunks`).
- **Sentence Chunk Cache & Merging**: Content-addressed WAV/MP3 chunk caching (`#bufferCache`) + RIFF WAV frame concatenator (`concatWavBuffers`).

## 2. Backchannel Ignore & Natural Barge-In (`evaluateVoiceTurn`)
Implemented in `daemon/voice.mjs` and exposed via `POST /v1/voice/turn-evaluate`:
- **Backchannels Ignored (`bargeInTriggered: false`)**: Short `<= 3`-word acknowledgments (`mm-hmm`, `uh-huh`, `yeah`, `okay`, `right`, `got it`) under `1200ms` do not cancel active TTS playback (`action: "ignore_backchannel"`).
- **Genuine Interruptions (`bargeInTriggered: true`)**: Multi-word or command utterances during active TTS trigger immediate playback cancellation (`ttsCancelled: true`, `action: "barge_in_interrupt"`).

## 3. Target Latency Budgets (`GET /v1/voice/status`)
| Metric | Configured Target | Mechanism |
|---|---|---|
| First Audio Chunk | `<= 700 ms` (`firstAudioTargetMs: 700`) | Persistent warm Python daemon + sentence-level chunking |
| End-to-End Turn | `<= 1800 ms` (`endToEndTargetMs: 1800`) | Streaming Ollama local `qwen3:1.7b` + WAV cache |
| Barge-In Cancellation | `<= 250 ms` (`bargeInTargetMs: 250`) | Browser WebAudio immediate stop + turn evaluator |
