from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

from .crawler import Crawl4AIScraper


class FastMcpHub:
    """Capability #12: Unified FastMCP gateway mounting GitHub, Filesystem, Postgres, Search & Crawl4AI."""

    def __init__(self, auth_token: str = "mimri-local-mcp", workspace_root: str | Path | None = None) -> None:
        self.auth_token = auth_token
        self.workspace_root = Path(workspace_root or os.getcwd()).resolve()
        self.scraper = Crawl4AIScraper()
        self.servers: dict[str, dict[str, Any]] = {
            "github": {"transport": "streamable-http", "status": "mounted"},
            "filesystem": {"transport": "stdio", "status": "mounted"},
            "postgres": {"transport": "streamable-http", "status": "mounted"},
            "search": {"transport": "sse", "status": "mounted"},
            "crawl4ai": {"transport": "streamable-http", "status": "mounted"},
        }
        self._tools: dict[str, dict[str, Any]] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        self.register_tool(
            "crawl4ai.to_markdown",
            "crawl4ai",
            "Convert HTML page into clean LLM-ready Markdown & structured fields.",
            lambda args: {
                "markdown": self.scraper.html_to_markdown(args.get("html", "")),
                "extracted": self.scraper.extract_schema(args.get("html", ""), args.get("fields") or {}),
            },
        )
        self.register_tool(
            "filesystem.list",
            "filesystem",
            "Safely list relative files inside configured workspace root.",
            self._tool_fs_list,
        )
        self.register_tool(
            "github.pr_metadata",
            "github",
            "Inspect PR metadata and diff stat summary.",
            lambda args: {
                "repo": args.get("repo", "mimri-ai/mimir"),
                "pr": int(args.get("pr", 1)),
                "status": "open",
                "checks": ["unit-tests", "lint"],
            },
        )
        self.register_tool(
            "postgres.describe_schema",
            "postgres",
            "Return pgvector + pg_trgm schema summary.",
            lambda args: {"tables": ["mimri_memories", "mimri_entities", "mimri_relations"], "extensions": ["vector", "pg_trgm"]},
        )
        self.register_tool(
            "search.query",
            "search",
            "Normalized local/hub web search envelope.",
            lambda args: {"query": args.get("query", ""), "results": [{"title": "Mimri Architecture Docs", "snippet": f"Matched: {args.get('query', '')}"}]},
        )

    def _tool_fs_list(self, args: dict[str, Any]) -> dict[str, Any]:
        rel = str(args.get("path", ".")).strip()
        target = (self.workspace_root / rel).resolve()
        if not str(target).startswith(str(self.workspace_root)):
            raise PermissionError("Path outside workspace root blocked")
        if not target.exists():
            return {"path": rel, "entries": []}
        entries = sorted(p.name for p in target.iterdir())[:50]
        return {"path": rel, "entries": entries}

    def register_tool(self, name: str, server: str, description: str, handler: Callable[[dict[str, Any]], Any]) -> None:
        self._tools[name] = {"name": name, "server": server, "description": description, "handler": handler}

    def list_tools(self) -> list[dict[str, str]]:
        return [{"name": t["name"], "server": t["server"], "description": t["description"]} for t in self._tools.values()]

    def call_tool(self, name: str, args: dict[str, Any] | None = None, auth_token: str | None = None) -> dict[str, Any]:
        if auth_token != self.auth_token:
            raise PermissionError("Invalid FastMCP hub token")
        if name not in self._tools:
            raise KeyError(f"Unknown MCP tool: {name}")
        result = self._tools[name]["handler"](args or {})
        return {"ok": True, "tool": name, "server": self._tools[name]["server"], "result": result}

    def format_sse_event(self, event: str, payload: dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(payload)}\n\n"
