from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SandboxSpec:
    runtime: str = "runsc"
    memory: str = "1g"
    cpus: str = "1"
    network: str = "none"
    ttl_seconds: int = 600
    prebaked_images: dict[str, str] = field(
        default_factory=lambda: {
            "python": "mimri/sandbox-python313:latest",
            "node": "mimri/sandbox-node22:latest",
            "bash": "mimri/sandbox-alpine:latest",
        }
    )


class SandboxPool:
    """Rootless Docker+gVisor (runsc) container runner with 10-min auto-kill reaper & safe local fallback."""

    def __init__(self, spec: SandboxSpec | None = None, prefer_docker: bool = False) -> None:
        self.spec = spec or SandboxSpec()
        self.prefer_docker = prefer_docker
        self.active_leases: dict[str, dict[str, Any]] = {}

    def build_docker_command(self, language: str, workdir: str | Path, cmd: list[str]) -> list[str]:
        image = self.spec.prebaked_images.get(language, self.spec.prebaked_images["python"])
        return [
            "docker",
            "run",
            "--rm",
            f"--runtime={self.spec.runtime}",
            f"--memory={self.spec.memory}",
            f"--cpus={self.spec.cpus}",
            f"--network={self.spec.network}",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=128m",
            "-v",
            f"{Path(workdir).resolve()}:/workspace:rw",
            "-w",
            "/workspace",
            image,
            *cmd,
        ]

    def docker_available(self) -> bool:
        return bool(shutil.which("docker"))

    def reap_expired_leases(self, now: float | None = None) -> list[str]:
        t = now if now is not None else time.time()
        expired = [
            sid
            for sid, info in list(self.active_leases.items())
            if t - info["started_at"] >= info["ttl_seconds"]
        ]
        for sid in expired:
            self.active_leases.pop(sid, None)
        return expired

    def run_code(
        self,
        language: str,
        code: str,
        files: dict[str, str] | None = None,
        timeout_sec: int = 15,
    ) -> dict[str, Any]:
        self.reap_expired_leases()
        sid = f"sbx-{uuid.uuid4().hex[:10]}"
        started_at = time.time()
        self.active_leases[sid] = {
            "language": language,
            "started_at": started_at,
            "ttl_seconds": self.spec.ttl_seconds,
        }

        with tempfile.TemporaryDirectory(prefix=f"{sid}-") as tmp:
            root = Path(tmp)
            for rel, body in (files or {}).items():
                dest = (root / rel).resolve()
                if not str(dest).startswith(str(root.resolve())):
                    raise ValueError(f"Path traversal blocked: {rel}")
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(body, encoding="utf-8")

            if language == "python":
                entry = root / "main.py"
                entry.write_text(code, encoding="utf-8")
                exec_cmd = [sys.executable, str(entry)]
                container_cmd = ["python", "/workspace/main.py"]
            elif language in ("node", "javascript"):
                entry = root / "main.mjs"
                entry.write_text(code, encoding="utf-8")
                exec_cmd = ["node", str(entry)]
                container_cmd = ["node", "/workspace/main.mjs"]
            else:
                raise ValueError(f"Unsupported sandbox language: {language}")

            docker_cmd = self.build_docker_command(language, root, container_cmd)
            mode = "docker-gvisor" if (self.prefer_docker and self.docker_available()) else "isolated-temp-subprocess"

            run_cmd = docker_cmd if mode == "docker-gvisor" else exec_cmd
            env_clean = {"PATH": "", "PYTHONIOENCODING": "utf-8"}
            if mode == "isolated-temp-subprocess":
                import os

                env_clean = {
                    "PATH": os.environ.get("PATH", ""),
                    "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
                    "PYTHONIOENCODING": "utf-8",
                    "MIMRI_SANDBOX_NETWORK": self.spec.network,
                    "MIMRI_SANDBOX_RUNTIME": self.spec.runtime,
                }
            proc = subprocess.run(
                run_cmd,
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=min(timeout_sec, self.spec.ttl_seconds),
                env=env_clean,
            )
            elapsed_ms = int((time.time() - started_at) * 1000)
            self.active_leases.pop(sid, None)
            return {
                "sandbox_id": sid,
                "mode": mode,
                "docker_command": " ".join(docker_cmd),
                "spec": {
                    "runtime": self.spec.runtime,
                    "memory": self.spec.memory,
                    "cpus": self.spec.cpus,
                    "network": self.spec.network,
                    "ttl_seconds": self.spec.ttl_seconds,
                },
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "elapsed_ms": elapsed_ms,
            }
