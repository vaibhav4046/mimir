# Mimir

**Describe your workflow once. Mimir runs it.**

Type a job in one sentence — *"Every day at 8am, research competitor pricing, then write a short brief, then draft one reply idea."* Mimir splits it into steps, gives each step to the right bot, hands results from step to step, saves the output, and runs it on your schedule. It runs on your own computer with free local models; your data stays there unless you connect something.

Website: https://mimir-site-dusky.vercel.app

## What works today

- **Workflows from one sentence** — daily, interval or "when this folder changes" triggers; failed steps resume where they stopped.
- **A team of bots** — a chief of staff hands work to specialists (research, writing, design, ops) and each runs in its own sandbox.
- **Memory across chats** — say "remember that …" once and every bot knows it.
- **Any model** — local models through Ollama (the app detects your hardware and recommends one), or cloud models through an OpenRouter sign-in or your own API key. A local-only switch blocks every call that would leave the computer.
- **Real tools** — browser automation (Playwright), files, shell, MCP servers (local or remote with OAuth sign-in), PDF/DOCX/PPTX/XLSX/SVG output.
- **You stay in control** — anything irreversible (shell commands, sending, uploads) waits for your approval; one kill switch stops everything.

## Requirements

- Windows 10/11 x64 (the tested build). macOS and Linux run from source but have no packaged build yet.
- [Ollama](https://ollama.com/download) for local models. 8 GB RAM minimum; a GPU with 4 GB+ makes replies much faster.
- Optional: Python 3.11+ for voice and document generation (`python -m pip install -r scripts/requirements.txt`).

## Install

Download `Mimir-Setup-<version>.exe` from [Releases](../../releases). The build is **unsigned**, so Windows SmartScreen will warn: choose *More info → Run anyway*.

## Run from source

```bash
npm install
npm run dev:daemon      # coordinator on 127.0.0.1
npm run dev:renderer    # UI on http://127.0.0.1:5173
npm test                # unit + integration tests (needs Ollama running with qwen3:1.7b)
```

## Honest limits

- Mimir runs while your computer is on. A sleeping or switched-off PC runs nothing; missed scheduled runs catch up once on wake.
- Small local models (1–4B) are fast and private but not frontier-quality; research steps on them lean on general knowledge.
- Sending email or Slack messages as a workflow step is not built yet.

## License

MIT — see [LICENSE](LICENSE). All artwork is original; Mimir is not affiliated with any game or AI company.
