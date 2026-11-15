from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from .runner import SandboxPool


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def _grid_rotate_90(grid: list[list[int]]) -> list[list[int]]:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    return [[grid[rows - 1 - r][c] for r in range(rows)] for c in range(cols)]


def _grid_flip_h(grid: list[list[int]]) -> list[list[int]]:
    return [list(reversed(row)) for row in grid]


def _grid_invert(grid: list[list[int]], max_color: int = 9) -> list[list[int]]:
    return [[max_color - cell if cell > 0 else 0 for cell in row] for row in grid]


def _grid_border_fill(grid: list[list[int]], color: int = 7) -> list[list[int]]:
    h = len(grid)
    w = len(grid[0]) if h else 0
    return [
        [color if (r in (0, h - 1) or c in (0, w - 1)) else grid[r][c] for c in range(w)]
        for r in range(h)
    ]


def eval_mimri_dsl(program: str) -> dict[str, Any]:
    """
    Deterministic MimriDSL pipeline interpreter & AST verifier:
      e.g. "[1, 2, 3, 4] |> MAP(*2) |> FILTER(>3) |> REV |> SUM"
    """
    stages = [s.strip() for s in (program or "").split("|>") if s.strip()]
    if not stages:
        raise ValueError("Empty MimriDSL program")

    seed = json.loads(stages[0])
    if not isinstance(seed, list) or not all(isinstance(x, (int, float)) for x in seed):
        raise ValueError("MimriDSL seed must be a numeric JSON list")

    ast: list[dict[str, Any]] = [{"op": "LITERAL", "value": list(seed)}]
    val: Any = [int(x) if isinstance(x, int) or float(x).is_integer() else float(x) for x in seed]

    for op_raw in stages[1:]:
        m_map = re.fullmatch(r"MAP\(([+\-*/])(-?\d+(?:\.\d+)?)\)", op_raw)
        m_flt = re.fullmatch(r"FILTER\((>=|<=|==|!=|>|<)(-?\d+(?:\.\d+)?)\)", op_raw)
        if m_map:
            if not isinstance(val, list):
                raise TypeError("MAP expects list")
            op, num_s = m_map.group(1), m_map.group(2)
            num = int(num_s) if num_s.lstrip("-").isdigit() else float(num_s)
            ast.append({"op": "MAP", "operator": op, "operand": num})
            if op == "+":
                val = [x + num for x in val]
            elif op == "-":
                val = [x - num for x in val]
            elif op == "*":
                val = [x * num for x in val]
            elif op == "/":
                if num == 0:
                    raise ZeroDivisionError("MimriDSL division by zero")
                val = [round(x / num, 4) for x in val]
        elif m_flt:
            if not isinstance(val, list):
                raise TypeError("FILTER expects list")
            cmp_op, num_s = m_flt.group(1), m_flt.group(2)
            num = int(num_s) if num_s.lstrip("-").isdigit() else float(num_s)
            ast.append({"op": "FILTER", "cmp": cmp_op, "operand": num})
            ops = {
                ">": lambda a, b: a > b,
                "<": lambda a, b: a < b,
                ">=": lambda a, b: a >= b,
                "<=": lambda a, b: a <= b,
                "==": lambda a, b: a == b,
                "!=": lambda a, b: a != b,
            }
            val = [x for x in val if ops[cmp_op](x, num)]
        elif op_raw == "REV":
            if not isinstance(val, list):
                raise TypeError("REV expects list")
            ast.append({"op": "REV"})
            val = list(reversed(val))
        elif op_raw == "SORT":
            if not isinstance(val, list):
                raise TypeError("SORT expects list")
            ast.append({"op": "SORT"})
            val = sorted(val)
        elif op_raw == "SUM":
            if not isinstance(val, list):
                raise TypeError("SUM expects list")
            ast.append({"op": "SUM"})
            val = sum(val)
        elif op_raw == "LEN":
            if not isinstance(val, list):
                raise TypeError("LEN expects list")
            ast.append({"op": "LEN"})
            val = len(val)
        else:
            raise ValueError(f"Unknown MimriDSL stage: {op_raw}")

    return {"ast": ast, "output": val}


class SweBenchGrader:
    """Capability #6: SWE-bench JSONL task schema + Docker/isolated grader + reasoning trace logger."""

    DEFAULT_TASK = {
        "task_id": "swe-mimri-rate-clamp-01",
        "repo_url": "https://github.com/mimri-ai/core-utils.git",
        "base_commit": "a1b2c3d4e5f6",
        "problem_statement": "Fix retry_backoff_ms() so backoff never drops below 50ms when attempt=0.",
        "files": {
            "rate_limit.py": "def retry_backoff_ms(attempt: int) -> int:\n    return attempt * 100\n"
        },
        "test_patch": (
            "from rate_limit import retry_backoff_ms\n"
            "assert retry_backoff_ms(0) == 50, f'expected 50 got {retry_backoff_ms(0)}'\n"
            "assert retry_backoff_ms(2) == 200\n"
            "print('ALL_TESTS_PASSED')\n"
        ),
    }

    def __init__(self, sandbox: SandboxPool | None = None, trajectory_path: str | Path | None = None) -> None:
        self.sandbox = sandbox or SandboxPool()
        self.trajectory_path = Path(trajectory_path) if trajectory_path else None

    def grade(
        self,
        task: dict[str, Any] | None,
        candidate_files: dict[str, str],
        reasoning_trace: str = "",
    ) -> dict[str, Any]:
        spec = task or self.DEFAULT_TASK
        merged_files = {**(spec.get("files") or {}), **(candidate_files or {})}
        run = self.sandbox.run_code("python", spec["test_patch"], files=merged_files)
        passed = run["exit_code"] == 0 and "ALL_TESTS_PASSED" in run["stdout"]
        record = {
            "task_id": spec["task_id"],
            "repo_url": spec["repo_url"],
            "base_commit": spec["base_commit"],
            "passed": passed,
            "mode": run["mode"],
            "elapsed_ms": run["elapsed_ms"],
            "reasoning_trace": reasoning_trace,
            "stdout": run["stdout"].strip(),
            "stderr": run["stderr"].strip(),
            "ts": time.time(),
        }
        if self.trajectory_path:
            self.trajectory_path.parent.mkdir(parents=True, exist_ok=True)
            with self.trajectory_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        return record


class ComputerUseEvalLogger:
    """Capability #7: OSWorld-style trajectory logger (screenshot, dom_nodes, a11y_tree, action_coords)."""

    def __init__(self, log_path: str | Path | None = None) -> None:
        self.log_path = Path(log_path) if log_path else None

    def evaluate_trajectory(
        self,
        goal: str,
        steps: list[dict[str, Any]],
        expected_final_url: str = "",
    ) -> dict[str, Any]:
        normalized: list[dict[str, Any]] = []
        valid_coords = 0
        for idx, step in enumerate(steps):
            coords = step.get("action_coords") or [0, 0]
            has_xy = isinstance(coords, (list, tuple)) and len(coords) == 2 and all(isinstance(n, (int, float)) for n in coords)
            if has_xy:
                valid_coords += 1
            dom_nodes = int(step.get("dom_nodes", len(step.get("a11y_tree") or [])))
            snap_seed = f"{idx}:{step.get('url', '')}:{step.get('action_type', 'click')}:{coords}"
            normalized.append(
                {
                    "step_idx": idx,
                    "screenshot_hash": step.get("screenshot_hash") or hashlib.sha256(snap_seed.encode()).hexdigest()[:16],
                    "dom_nodes": dom_nodes,
                    "a11y_tree": step.get("a11y_tree") or [{"role": "button", "name": step.get("target", "Submit")}],
                    "action_type": step.get("action_type", "click"),
                    "action_coords": list(coords),
                    "url": step.get("url", ""),
                }
            )
        final_url = normalized[-1]["url"] if normalized else ""
        goal_reached = bool(normalized) and (not expected_final_url or expected_final_url in final_url)
        result = {
            "goal": goal,
            "step_count": len(normalized),
            "grounded_coords_pct": round(100.0 * valid_coords / max(1, len(normalized)), 1),
            "goal_reached": goal_reached,
            "steps": normalized,
        }
        if self.log_path:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(result) + "\n")
        return result


class ReasoningDslGrader:
    """Capability #8: Deterministic ARC-AGI 2D grid puzzles + MimriDSL AST/output verifier."""

    TRANSFORMS = {
        "ROTATE_90": _grid_rotate_90,
        "FLIP_H": _grid_flip_h,
        "COLOR_INVERT": _grid_invert,
        "BORDER_FILL": _grid_border_fill,
    }

    def generate_grid_task(self, transform: str = "ROTATE_90", grid: list[list[int]] | None = None) -> dict[str, Any]:
        fn = self.TRANSFORMS[transform]
        inp = grid or [[1, 2, 0], [0, 3, 4], [5, 0, 6]]
        return {"transform": transform, "input": inp, "expected_output": fn(inp)}

    def verify_grid_solution(self, task: dict[str, Any], candidate_output: list[list[int]]) -> dict[str, Any]:
        passed = candidate_output == task["expected_output"]
        return {"passed": passed, "transform": task["transform"], "expected": task["expected_output"], "actual": candidate_output}

    def verify_dsl_task(self, program: str, expected_output: Any) -> dict[str, Any]:
        parsed = eval_mimri_dsl(program)
        return {
            "passed": parsed["output"] == expected_output,
            "expected": expected_output,
            "actual": parsed["output"],
            "ast_ops": [node["op"] for node in parsed["ast"]],
        }
