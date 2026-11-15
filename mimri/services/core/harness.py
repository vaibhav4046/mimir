from __future__ import annotations

import asyncio
import difflib
import os
from pathlib import Path
from typing import Any

from packages.sandbox.runner import SandboxPool
from .router import LiteLLMRouter
from .telemetry import PhoenixTracer


def estimate_tokens(messages: list[dict[str, str]]) -> int:
    return sum(max(1, len(str(m.get("content", ""))) // 4) for m in messages)


class RecursiveAgentHarness:
    """Capability #1 & Core Loop: read/write/patch/bash tools + 32k context compaction + async sub-agent file search."""

    def __init__(
        self,
        workspace_root: str | Path,
        router: LiteLLMRouter | None = None,
        tracer: PhoenixTracer | None = None,
        max_context_tokens: int = 32_000,
    ) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.tracer = tracer or (router.tracer if router else PhoenixTracer())
        self.router = router or LiteLLMRouter(tracer=self.tracer)
        self.sandbox = SandboxPool()
        self.max_context_tokens = max_context_tokens

    def _safe_path(self, rel_path: str) -> Path:
        target = (self.workspace_root / rel_path).resolve()
        if not str(target).startswith(str(self.workspace_root)):
            raise PermissionError(f"Sandbox path escape blocked: {rel_path}")
        return target

    def tool_read(self, rel_path: str) -> str:
        return self._safe_path(rel_path).read_text(encoding="utf-8")

    def tool_write(self, rel_path: str, content: str) -> dict[str, Any]:
        target = self._safe_path(rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"path": rel_path, "bytes": len(content.encode("utf-8"))}

    def tool_patch(self, rel_path: str, old_text: str, new_text: str) -> dict[str, Any]:
        target = self._safe_path(rel_path)
        before = target.read_text(encoding="utf-8")
        if old_text not in before:
            raise ValueError(f"Target block not found in {rel_path}")
        after = before.replace(old_text, new_text, 1)
        target.write_text(after, encoding="utf-8")
        diff = "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile=rel_path, tofile=rel_path))
        return {"path": rel_path, "diff": diff}

    def tool_run_script(self, language: str, code: str) -> dict[str, Any]:
        return self.sandbox.run_code(language, code)

    def compact_context_if_needed(self, messages: list[dict[str, str]], keep_recent: int = 4) -> tuple[list[dict[str, str]], dict[str, Any]]:
        tokens_before = estimate_tokens(messages)
        if tokens_before <= self.max_context_tokens or len(messages) <= keep_recent + 1:
            return list(messages), {"compacted": False, "tokens_before": tokens_before, "tokens_after": tokens_before}

        with self.tracer.start_span(
            "harness.context_compaction",
            span_kind="CHAIN",
            attributes={"tokens_before": tokens_before, "max_context_tokens": self.max_context_tokens},
        ):
            system_msgs = [m for m in messages if m.get("role") == "system"][:1]
            non_system = [m for m in messages if m.get("role") != "system"]
            head = non_system[:-keep_recent] if len(non_system) > keep_recent else []
            tail = non_system[-keep_recent:]
            bullets = [f"- [{m.get('role', 'user')}] {str(m.get('content', '')).strip()[:140]}" for m in head[-12:]]
            summary_msg = {
                "role": "system",
                "content": "[COMPACTED_CONTEXT_SUMMARY]\n"
                + f"Compacted {len(head)} earlier turns ({tokens_before} est. tokens > {self.max_context_tokens} threshold):\n"
                + "\n".join(bullets),
            }
            compacted = [*system_msgs, summary_msg, *tail]
            tokens_after = estimate_tokens(compacted)
            return compacted, {
                "compacted": True,
                "dropped_turns": len(head),
                "tokens_before": tokens_before,
                "tokens_after": tokens_after,
            }

    async def spawn_parallel_file_searches(self, patterns: list[str]) -> list[dict[str, Any]]:
        """Spawn parallel asyncio sub-agents for concurrent codebase pattern searches."""

        async def _search_one(pattern: str) -> dict[str, Any]:
            with self.tracer.start_span("subagent.file_search", span_kind="TOOL", attributes={"tool.name": "grep", "pattern": pattern}):
                matches: list[dict[str, Any]] = []
                pat_l = pattern.lower()
                for dirpath, dirnames, filenames in os.walk(self.workspace_root):
                    dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__", "target", ".venv")]
                    for fname in filenames:
                        fpath = Path(dirpath) / fname
                        if fpath.suffix.lower() not in (".py", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".md", ".yml", ".yaml", ".json"):
                            continue
                        try:
                            txt = fpath.read_text(encoding="utf-8", errors="ignore")
                        except OSError:
                            continue
                        for idx, line in enumerate(txt.splitlines(), 1):
                            if pat_l in line.lower():
                                matches.append({"file": str(fpath.relative_to(self.workspace_root)), "line": idx, "preview": line.strip()[:120]})
                                if len(matches) >= 8:
                                    break
                        if len(matches) >= 8:
                            break
                    if len(matches) >= 8:
                        break
                return {"pattern": pattern, "match_count": len(matches), "matches": matches}

        return await asyncio.gather(*(_search_one(p) for p in patterns))

    def run_turn(
        self,
        messages: list[dict[str, str]],
        search_patterns: list[str] | None = None,
        prefer_local: bool = True,
    ) -> dict[str, Any]:
        compacted, stats = self.compact_context_if_needed(messages)
        searches = asyncio.run(self.spawn_parallel_file_searches(search_patterns)) if search_patterns else []
        if searches:
            compacted = [*compacted, {"role": "system", "content": f"[SUBAGENT_SEARCH_RESULTS] {len(searches)} parallel query batches complete."}]
        completion = self.router.complete(compacted, prefer_local=prefer_local)
        return {
            "compaction": stats,
            "subagent_searches": searches,
            "completion": completion,
            "traces": self.tracer.summary(),
        }
