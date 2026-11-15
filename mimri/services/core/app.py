from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from packages.mcp_hub.hub import FastMcpHub
from packages.memory.store import MimriMemoryStore
from packages.sandbox.graders import ComputerUseEvalLogger, ReasoningDslGrader, SweBenchGrader
from packages.sandbox.runner import SandboxPool
from .harness import RecursiveAgentHarness
from .router import LiteLLMRouter
from .telemetry import PhoenixTracer


class MimriCoreControlPlane:
    """Phase 1 Unified Control Plane gluing Memory, FastMCP Hub, Sandbox Pool, LiteLLM Router, and OTel Phoenix."""

    def __init__(self, workspace_root: str | Path, db_path: str | Path | None = None) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.tracer = PhoenixTracer()
        self.router = LiteLLMRouter(tracer=self.tracer)
        self.memory = MimriMemoryStore(db_path=db_path)
        self.sandbox = SandboxPool()
        self.mcp_hub = FastMcpHub(workspace_root=self.workspace_root)
        self.harness = RecursiveAgentHarness(workspace_root=self.workspace_root, router=self.router, tracer=self.tracer)
        self.swe_grader = SweBenchGrader(sandbox=self.sandbox)
        self.cua_logger = ComputerUseEvalLogger()
        self.dsl_grader = ReasoningDslGrader()

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "service": "mimri-core",
            "installed_ollama_models": self.router.probe_ollama(),
            "mcp_tools": len(self.mcp_hub.list_tools()),
            "traces": self.tracer.summary()["span_count"],
        }


def serve_http(workspace_root: str | Path, port: int = 8080) -> None:
    plane = MimriCoreControlPlane(workspace_root)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            payload = plane.health() if self.path == "/health" else {"spans": plane.tracer.summary()}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()
