from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from apps.cli.acp_bridge import AcpAggregator  # noqa: E402
from services.core.app import MimriCoreControlPlane  # noqa: E402


def render_tui_snapshot(model: str = "ollama/qwen3:1.7b", est_tokens: int = 12400, max_tokens: int = 32000, subagents: int = 3) -> str:
    pct = min(100, int((est_tokens / max(1, max_tokens)) * 100))
    return "\n".join(
        [
            "+----------------------------------------------------------------------+",
            f"| MIMRI CLI (TUI)   Model: {model:<24} Ctx: {pct:>3}% ({est_tokens}/{max_tokens}) |",
            "+----------------------------------------------------------------------+",
            f"| [Sub-Agents Active: {subagents}]  [Compaction Threshold: {max_tokens} tok]     |",
            "| > Tools: read | write | patch | bash | parallel_file_search         |",
            "| > ACP Bridge: ready (claude-code / codex / opencode / mimri-cli)     |",
            "+----------------------------------------------------------------------+",
        ]
    )


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mimri", description="Mimri Coding Agent CLI & 14-Capability Control Plane")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="Inspect Control Plane health & tools")
    sub.add_parser("tui-snapshot", help="Print ANSI TUI frame")
    sub.add_parser("compact-demo", help="Run context compaction over >32k simulated tokens + parallel search")
    acp_p = sub.add_parser("acp-spawn", help="Spawn ACP headless bridge session")
    acp_p.add_argument("--agent", default="mimri-cli")
    acp_p.add_argument("--prompt", default="Inspect repo layout")

    args = parser.parse_args(argv)
    plane = MimriCoreControlPlane(ROOT_DIR)

    if args.cmd == "status":
        print(json.dumps(plane.health(), indent=2))
        return 0
    if args.cmd == "tui-snapshot":
        print(render_tui_snapshot())
        return 0
    if args.cmd == "compact-demo":
        big_history = [{"role": "user", "content": f"Turn {i}: " + ("token " * 1200)} for i in range(10)]
        res = plane.harness.run_turn(big_history, search_patterns=["PhoenixTracer", "FastMcpHub"])
        print(json.dumps({"compaction": res["compaction"], "searches": len(res["subagent_searches"]), "spans": res["traces"]["span_count"]}, indent=2))
        return 0
    if args.cmd == "acp-spawn":
        bridge = AcpAggregator()
        print(json.dumps(bridge.spawn_session(agent=args.agent, prompt=args.prompt, cwd=str(ROOT_DIR)), indent=2))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(run_cli())
