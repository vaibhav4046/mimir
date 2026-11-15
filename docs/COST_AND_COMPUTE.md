# Cost, VRAM Budget & Compute Envelope

## Workstation Baseline

- **Host GPU**: `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` total VRAM)
- **Measured Cold -> Warm Profile**:
  - `qwen3:1.7b`: `4220 ms` first-task load/run, `41-51 ms` warm TTFT, up to `90.0 tok/s`, `$0` marginal API cost.
  - `qwen3.5:4b`: `15503 ms` first-task load/run, `137-140 ms` warm TTFT, up to `40.0 tok/s`, `$0` marginal API cost.
  - `qwen3.5:9b`: `24566 ms` first-task load/run, `503-518 ms` warm TTFT, `5.1-9.7 tok/s` due to weights exceeding `6144 MiB` VRAM, `$0` marginal API cost.

## Cost Guardrails

- Local Ollama execution defaults to `$0.00` token spend.
- Optional OpenAI-compatible Cloud BYOK escalation tracks estimated token burn per run in `budget-ledger.json`, preventing accidental runaway loops via bounded tool iterations, explicit approval gates, and the global `/v1/kill-switch`.
