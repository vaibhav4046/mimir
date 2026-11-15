from __future__ import annotations

from typing import Any

from packages.sandbox.runner import SandboxPool


class AutoPrReviewer:
    """Capability #4: Executes tests in sandbox first; emits binary APPROVE / BLOCK with inline diffs ONLY on failure."""

    def __init__(self, sandbox: SandboxPool | None = None) -> None:
        self.sandbox = sandbox or SandboxPool()

    def review_pr(
        self,
        pr_number: int,
        title: str,
        files: dict[str, str],
        test_code: str,
        target_file: str = "app.py",
    ) -> dict[str, Any]:
        run = self.sandbox.run_code("python", test_code, files=files)
        if run["exit_code"] == 0:
            return {
                "pr_number": pr_number,
                "title": title,
                "verdict": "APPROVE",
                "checks_passed": True,
                "inline_comments": [],
                "summary": f"PR #{pr_number} sandbox checks passed in {run['elapsed_ms']}ms. Binary verdict: APPROVE.",
            }

        lines = (files.get(target_file) or "").splitlines()
        fail_line = max(1, len(lines))
        detail = (run["stderr"] or run["stdout"] or "Assertion or build failure").strip().splitlines()[-1]
        return {
            "pr_number": pr_number,
            "title": title,
            "verdict": "BLOCK",
            "checks_passed": False,
            "inline_comments": [
                {
                    "path": target_file,
                    "line": fail_line,
                    "severity": "error",
                    "body": f"Blocking test failure: {detail}",
                    "suggested_patch": f"@@ -{fail_line},1 +{fail_line},1 @@\n- {lines[fail_line - 1] if lines else ''}\n+ # Fix failing assertion before merge",
                }
            ],
            "summary": f"PR #{pr_number} failed sandbox test suite. Binary verdict: BLOCK.",
        }
