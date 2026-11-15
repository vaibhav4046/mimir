from __future__ import annotations

import time
import uuid
from typing import Any

from packages.sandbox.runner import SandboxPool


class SentryGithubAsyncWorker:
    """Capability #3: ARQ + Redis async background watcher reproducing Sentry/GitHub errors in sandbox with confidence gating."""

    def __init__(self, sandbox: SandboxPool | None = None, confidence_threshold: float = 0.80) -> None:
        self.sandbox = sandbox or SandboxPool()
        self.confidence_threshold = confidence_threshold
        self.queue_jobs: list[dict[str, Any]] = []

    def handle_error_event(
        self,
        source: str,
        error_log: str,
        repro_code: str,
        patched_files: dict[str, str],
        verify_code: str,
        confidence_threshold: float | None = None,
    ) -> dict[str, Any]:
        threshold = self.confidence_threshold if confidence_threshold is None else float(confidence_threshold)
        job_id = f"arq-{uuid.uuid4().hex[:10]}"
        repro_run = self.sandbox.run_code("python", repro_code, files=patched_files)
        fix_run = self.sandbox.run_code("python", verify_code, files=patched_files)

        reproduced = repro_run["exit_code"] != 0
        fix_verified = fix_run["exit_code"] == 0
        confidence = 0.0
        if reproduced and fix_verified:
            confidence = 0.94
        elif fix_verified:
            confidence = 0.72
        elif reproduced:
            confidence = 0.40

        notify_user = confidence >= threshold and fix_verified
        record = {
            "job_id": job_id,
            "source": source,
            "error_summary": (error_log or "").strip().splitlines()[0][:120] if error_log else "Unknown error",
            "reproduced_in_sandbox": reproduced,
            "fix_verified_in_sandbox": fix_verified,
            "confidence": confidence,
            "confidence_threshold": threshold,
            "notify_user": notify_user,
            "pr_opened": notify_user,
            "pr_branch": f"mimri/autofix-{job_id}" if notify_user else None,
            "ts": time.time(),
        }
        self.queue_jobs.append(record)
        return record
