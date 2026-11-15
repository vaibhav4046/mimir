from __future__ import annotations

import json
import time
import urllib.request
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator


@dataclass
class OTelSpan:
    trace_id: str
    span_id: str
    name: str
    span_kind: str
    parent_span_id: str | None = None
    start_ns: int = 0
    end_ns: int = 0
    attributes: dict[str, Any] = field(default_factory=dict)
    status: str = "OK"

    @property
    def duration_ms(self) -> float:
        return round((self.end_ns - self.start_ns) / 1_000_000.0, 2)

    def to_otlp_dict(self) -> dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id or "",
            "name": self.name,
            "kind": self.span_kind,
            "startTimeUnixNano": str(self.start_ns),
            "endTimeUnixNano": str(self.end_ns),
            "attributes": [
                {"key": k, "value": {"stringValue": json.dumps(v) if not isinstance(v, (str, int, float, bool)) else str(v)}}
                for k, v in self.attributes.items()
            ],
            "status": {"code": self.status},
        }


class PhoenixTracer:
    """Capability #13: OpenTelemetry (OpenInference) + Arize Phoenix trace recorder."""

    def __init__(self, endpoint: str | None = None, service_name: str = "mimri-core") -> None:
        self.endpoint = endpoint
        self.service_name = service_name
        self.spans: list[OTelSpan] = []

    @contextmanager
    def start_span(
        self,
        name: str,
        span_kind: str = "AGENT",
        trace_id: str | None = None,
        parent_span_id: str | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> Iterator[OTelSpan]:
        span = OTelSpan(
            trace_id=trace_id or uuid.uuid4().hex,
            span_id=uuid.uuid4().hex[:16],
            name=name,
            span_kind=span_kind,
            parent_span_id=parent_span_id,
            start_ns=time.time_ns(),
            attributes={"openinference.span.kind": span_kind, "service.name": self.service_name, **(attributes or {})},
        )
        try:
            yield span
        except Exception as exc:
            span.status = "ERROR"
            span.attributes["error.message"] = str(exc)
            raise
        finally:
            span.end_ns = time.time_ns()
            self.spans.append(span)
            if len(self.spans) > 250:
                self.spans = self.spans[-250:]

    def export_otlp_payload(self) -> dict[str, Any]:
        return {
            "resourceSpans": [
                {
                    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": self.service_name}}]},
                    "scopeSpans": [{"scope": {"name": "mimri.openinference"}, "spans": [s.to_otlp_dict() for s in self.spans]}],
                }
            ]
        }

    def flush_to_phoenix(self, timeout_sec: float = 1.5) -> bool:
        if not self.endpoint or not self.spans:
            return False
        req = urllib.request.Request(
            f"{self.endpoint.rstrip('/')}/v1/traces",
            data=json.dumps(self.export_otlp_payload()).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False

    def summary(self) -> dict[str, Any]:
        total_prompt = sum(int(s.attributes.get("llm.token_count.prompt", 0) or 0) for s in self.spans)
        total_completion = sum(int(s.attributes.get("llm.token_count.completion", 0) or 0) for s in self.spans)
        total_cost = round(sum(float(s.attributes.get("llm.cost_usd", 0.0) or 0.0) for s in self.spans), 6)
        return {
            "span_count": len(self.spans),
            "prompt_tokens": total_prompt,
            "completion_tokens": total_completion,
            "total_cost_usd": total_cost,
            "spans": [
                {
                    "trace_id": s.trace_id,
                    "span_id": s.span_id,
                    "name": s.name,
                    "span_kind": s.span_kind,
                    "duration_ms": s.duration_ms,
                    "status": s.status,
                    "attributes": s.attributes,
                }
                for s in self.spans[-30:]
            ],
        }
