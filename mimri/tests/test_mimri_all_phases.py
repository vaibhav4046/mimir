from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

MIMRI_ROOT = Path(__file__).resolve().parents[1]
if str(MIMRI_ROOT) not in sys.path:
    sys.path.insert(0, str(MIMRI_ROOT))

from apps.cli.acp_bridge import AcpAggregator  # noqa: E402
from apps.cli.main import render_tui_snapshot  # noqa: E402
from packages.mcp_hub.crawler import Crawl4AIScraper  # noqa: E402
from packages.mcp_hub.hub import FastMcpHub  # noqa: E402
from packages.memory.store import MimriMemoryStore  # noqa: E402
from packages.sandbox.graders import ComputerUseEvalLogger, ReasoningDslGrader, SweBenchGrader, eval_mimri_dsl  # noqa: E402
from packages.sandbox.runner import SandboxPool  # noqa: E402
from services.core.app import MimriCoreControlPlane  # noqa: E402
from services.voice.room_worker import LiveKitPipecatWorker  # noqa: E402
from services.workers.app_builder import WebAppBuilder  # noqa: E402
from services.workers.pr_reviewer import AutoPrReviewer  # noqa: E402
from services.workers.worker import SentryGithubAsyncWorker  # noqa: E402


class TestMimriFourteenCapabilities(unittest.TestCase):
    def test_phase1_infra_memory_sandbox_crawler_mcp_phoenix_and_harness(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # #10 Persistent Memory + pgvector DDL + Entity Graph + Markdown Sync
            mem = MimriMemoryStore(db_path=tmp_path / "mem.sqlite")
            self.assertIn("CREATE EXTENSION IF NOT EXISTS pg_trgm", mem.get_postgres_ddl())
            mem.core_memory_append("persona", "Mimri autonomous engineering peer")
            mem.core_memory_replace("persona", "peer", "orchestrator")
            mem.archival_memory_insert("Rate limiter must clamp retries to at least 50ms", tags=["bugfix"])
            hits = mem.archival_memory_search("clamp retries 50ms", top_k=3)
            self.assertGreater(len(hits), 0)
            self.assertIn("50ms", hits[0]["content"])
            mem.entity_graph_upsert("Klaus", "DELEGATES_TO", "Mara")
            self.assertEqual(mem.entity_graph_query("Klaus")[0]["target"], "Mara")
            md_file = mem.export_markdown(tmp_path / "MEMORY.md")
            mem2 = MimriMemoryStore()
            counts = mem2.sync_from_markdown(md_file)
            self.assertEqual(counts["core"], 1)
            self.assertEqual(counts["archival"], 1)
            self.assertEqual(counts["entities"], 1)
            mem.close()
            mem2.close()

            # #9 Sandbox Pool (Docker+gVisor command spec + isolated execution + reaper)
            pool = SandboxPool()
            cmd = pool.build_docker_command("python", tmp_path, ["python", "main.py"])
            self.assertIn("--runtime=runsc", cmd)
            self.assertIn("--network=none", cmd)
            res = pool.run_code("python", "print(6 * 7)")
            self.assertEqual(res["exit_code"], 0)
            self.assertEqual(res["stdout"].strip(), "42")

            # #11 & #12 Crawl4AI + FastMCP Hub
            scraper = Crawl4AIScraper()
            md = scraper.html_to_markdown("<h1>Mimri Spec</h1><script>evil()</script><p>Fast MCP ready</p>")
            self.assertIn("# Mimri Spec", md)
            self.assertNotIn("evil()", md)
            hub = FastMcpHub(workspace_root=MIMRI_ROOT)
            tool_out = hub.call_tool("crawl4ai.to_markdown", {"html": "<h1>OK</h1>", "fields": {"title": "h1"}}, auth_token="mimri-local-mcp")
            self.assertEqual(tool_out["result"]["extracted"]["title"], "OK")
            with self.assertRaises(PermissionError):
                hub.call_tool("filesystem.list", {"path": "../.."}, auth_token="mimri-local-mcp")

            # Core Harness >32k context compaction + #13 Arize Phoenix OTel traces
            plane = MimriCoreControlPlane(MIMRI_ROOT)
            plane.harness.max_context_tokens = 200
            long_msgs = [{"role": "system", "content": "Root rules"}, *({"role": "user", "content": "word " * 80} for _ in range(8))]
            turn = plane.harness.run_turn(long_msgs, search_patterns=["PhoenixTracer", "FastMcpHub"])
            self.assertTrue(turn["compaction"]["compacted"])
            self.assertEqual(len(turn["subagent_searches"]), 2)
            self.assertGreater(turn["traces"]["span_count"], 2)

    def test_phase2_cli_tui_acp_and_auto_pr_reviewer(self) -> None:
        # #1 CLI TUI snapshot
        tui = render_tui_snapshot()
        self.assertIn("MIMRI CLI (TUI)", tui)

        # #2 ACP Aggregator
        acp = AcpAggregator()
        live = acp.spawn_session("mimri-cli", "ping-acp")
        self.assertEqual(live["mode"], "live-subprocess")
        self.assertIn("ping-acp", live["output"])
        ext = acp.spawn_session("claude-code", "review module")
        self.assertEqual(ext["agent"], "claude-code")
        self.assertEqual(ext["envelopes"][0]["method"], "session/start")

        # #4 Auto PR Reviewer: binary APPROVE vs BLOCK
        reviewer = AutoPrReviewer()
        approve = reviewer.review_pr(42, "Fix off-by-one", {"app.py": "def add(a, b): return a + b\n"}, "from app import add\nassert add(2, 3) == 5\n")
        self.assertEqual(approve["verdict"], "APPROVE")
        self.assertEqual(approve["inline_comments"], [])

        block = reviewer.review_pr(43, "Broken add", {"app.py": "def add(a, b): return a - b\n"}, "from app import add\nassert add(2, 3) == 5\n")
        self.assertEqual(block["verdict"], "BLOCK")
        self.assertEqual(len(block["inline_comments"]), 1)

    def test_phase3_app_builder_and_arq_sentry_worker(self) -> None:
        # #5 Full-Stack App Builder + Sandpack HTML + Dockerfile + vercel.json
        builder = WebAppBuilder()
        bundle = builder.generate_app("Build Task Telemetry Board", "telemetry-board")
        self.assertIn("frontend/App.jsx", bundle["files"])
        self.assertIn("backend/main.py", bundle["files"])
        self.assertIn("Dockerfile", bundle["files"])
        self.assertIn("Sandpack Live Full-Stack Preview", bundle["sandpack_preview_html"])

        # #3 ARQ Sentry/GitHub Worker confidence threshold gating
        worker = SentryGithubAsyncWorker(confidence_threshold=0.80)
        high_conf = worker.handle_error_event(
            "sentry",
            "ZeroDivisionError in avg()",
            "import sys; sys.exit(1)",
            {"calc.py": "def safe_div(a, b): return a / b if b else 0\n"},
            "from calc import safe_div\nassert safe_div(10, 0) == 0\n",
        )
        self.assertTrue(high_conf["notify_user"])
        self.assertTrue(high_conf["pr_opened"])

        low_conf = worker.handle_error_event(
            "sentry",
            "Unreproduced warning",
            "print('did not fail')",
            {"calc.py": "def safe_div(a, b): return a / b if b else 0\n"},
            "from calc import safe_div\nassert safe_div(10, 0) == 0\n",
            confidence_threshold=0.85,
        )
        self.assertFalse(low_conf["notify_user"])

    def test_phase4_evals_and_livekit_pipecat_voice(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            traj = Path(tmp) / "swe_traj.jsonl"
            # #6 SWE-bench Grader
            swe = SweBenchGrader(trajectory_path=traj)
            fail_run = swe.grade(None, {"rate_limit.py": "def retry_backoff_ms(attempt: int) -> int:\n    return attempt * 100\n"})
            self.assertFalse(fail_run["passed"])
            pass_run = swe.grade(None, {"rate_limit.py": "def retry_backoff_ms(attempt: int) -> int:\n    return max(50, attempt * 100)\n"})
            self.assertTrue(pass_run["passed"])
            self.assertTrue(traj.exists())

            # #7 Computer Use Eval Logger
            cua = ComputerUseEvalLogger()
            cua_res = cua.evaluate_trajectory(
                "Submit form in Mimir",
                [{"action_type": "click", "action_coords": [420, 180], "dom_nodes": 48, "url": "http://localhost:5173/#done"}],
                expected_final_url="#done",
            )
            self.assertTrue(cua_res["goal_reached"])
            self.assertEqual(cua_res["grounded_coords_pct"], 100.0)

            # #8 Reasoning Grid + MimriDSL AST Verifier
            dsl_eval = ReasoningDslGrader()
            grid_task = dsl_eval.generate_grid_task("ROTATE_90", [[1, 2], [3, 4]])
            self.assertTrue(dsl_eval.verify_grid_solution(grid_task, [[3, 1], [4, 2]])["passed"])
            dsl_res = dsl_eval.verify_dsl_task("[1, 2, 3, 4] |> MAP(*2) |> FILTER(>3) |> REV |> SUM", 18)
            self.assertTrue(dsl_res["passed"])

            # #14 LiveKit + Pipecat Multi-Party Voice Room
            voice = LiveKitPipecatWorker()
            barge = voice.process_room_turn(
                [{"speaker_id": "alex", "rms": 0.08, "transcript": "Hold on @mimir stop"}],
                silence_ms=0,
                agent_currently_speaking=True,
            )
            self.assertTrue(barge["per_speaker_tracks_isolated"])
            self.assertTrue(barge["turn_decision"]["barge_in_triggered"])
            self.assertFalse(barge["turn_decision"]["should_speak"])

            pause_reply = voice.process_room_turn(
                [
                    {"speaker_id": "alex", "rms": 0.002, "transcript": "Hey Mimir what do you think?"},
                    {"speaker_id": "maya", "rms": 0.001, "transcript": ""},
                ],
                silence_ms=800,
                agent_currently_speaking=False,
            )
            self.assertTrue(pause_reply["turn_decision"]["addressed"])
            self.assertTrue(pause_reply["turn_decision"]["should_speak"])


if __name__ == "__main__":
    unittest.main()
