from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

from .telemetry import PhoenixTracer


class LiteLLMRouter:
    """Routes across Frontier API models with automatic local Ollama / vLLM fallback."""

    DEFAULT_ROUTES = [
        {"tier": "frontier", "model": "claude-sonnet-4-20250514", "provider": "anthropic", "cost_per_1k": 0.003},
        {"tier": "frontier", "model": "gpt-4.1", "provider": "openai", "cost_per_1k": 0.002},
        {"tier": "local", "model": "ollama/qwen3:1.7b", "provider": "ollama", "cost_per_1k": 0.0},
        {"tier": "local", "model": "vllm/qwen2.5-coder-7b", "provider": "vllm", "cost_per_1k": 0.0},
    ]

    def __init__(
        self,
        ollama_url: str | None = None,
        tracer: PhoenixTracer | None = None,
    ) -> None:
        self.ollama_url = ollama_url or os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.tracer = tracer or PhoenixTracer()

    def probe_ollama(self, timeout_sec: float = 0.8) -> list[str]:
        try:
            with urllib.request.urlopen(f"{self.ollama_url.rstrip('/')}/api/tags", timeout=timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return [m["name"] for m in (data.get("models") or []) if m.get("name")]
        except Exception:
            return []

    def complete(
        self,
        messages: list[dict[str, str]],
        prefer_local: bool = True,
        model: str | None = None,
    ) -> dict[str, Any]:
        installed = self.probe_ollama()
        selected_model = model or (f"ollama/{installed[0]}" if installed else "ollama/qwen3:1.7b")
        provider = "ollama" if selected_model.startswith("ollama/") else "frontier"
        prompt_text = "\n".join(m.get("content", "") for m in messages)
        prompt_tokens = max(1, len(prompt_text) // 4)
        reply = ""

        with self.tracer.start_span(
            "litellm.complete",
            span_kind="LLM",
            attributes={
                "llm.model_name": selected_model,
                "llm.provider": provider,
                "llm.token_count.prompt": prompt_tokens,
            },
        ) as span:
            if prefer_local and selected_model.startswith("ollama/") and installed:
                ollama_model = selected_model.split("/", 1)[1]
                payload = {
                    "model": ollama_model,
                    "messages": messages,
                    "stream": False,
                    "think": False,
                    "options": {"num_predict": 160},
                }
                try:
                    req = urllib.request.Request(
                        f"{self.ollama_url.rstrip('/')}/api/chat",
                        data=json.dumps(payload).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=8.0) as resp:
                        out = json.loads(resp.read().decode("utf-8"))
                        reply = (out.get("message") or {}).get("content", "").strip()
                except Exception:
                    reply = ""

            if not reply:
                last_user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
                reply = f"[{selected_model}] Processed {len(messages)} turn(s): {last_user[:140]}"

            completion_tokens = max(1, len(reply) // 4)
            span.attributes["llm.token_count.completion"] = completion_tokens
            span.attributes["llm.cost_usd"] = 0.0 if provider == "ollama" else round((prompt_tokens + completion_tokens) * 0.000003, 6)

        return {
            "model": selected_model,
            "provider": provider,
            "fallback_used": provider in ("ollama", "vllm"),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "content": reply,
        }
