from __future__ import annotations

import html as html_lib
import re
from typing import Any


class Crawl4AIScraper:
    """Capability #11: HTML -> clean LLM-ready Markdown + structured JSON extraction."""

    def html_to_markdown(self, raw_html: str) -> str:
        text = str(raw_html or "")
        text = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", text)
        text = re.sub(r"(?is)<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", lambda m: f"[{self._clean(m.group(2))}]({m.group(1)})", text)
        for level in range(1, 5):
            prefix = "#" * level
            text = re.sub(
                rf"(?is)<h{level}[^>]*>(.*?)</h{level}>",
                lambda m, p=prefix: f"\n{p} {self._clean(m.group(1))}\n",
                text,
            )
        text = re.sub(r"(?is)<li[^>]*>(.*?)</li>", lambda m: f"\n- {self._clean(m.group(1))}", text)
        text = re.sub(r"(?is)<(?:p|div|section|article|tr|br)[^>]*>", "\n", text)
        text = re.sub(r"(?is)<[^>]+>", " ", text)
        text = html_lib.unescape(text)
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
        compact = [ln for ln in lines if ln]
        return "\n".join(compact)

    def _clean(self, fragment: str) -> str:
        plain = re.sub(r"(?is)<[^>]+>", " ", fragment)
        return re.sub(r"\s+", " ", html_lib.unescape(plain)).strip()

    def extract_schema(self, raw_html: str, fields: dict[str, str]) -> dict[str, Any]:
        """Extract simple fields by tag/class regex mapping (e.g. {'title': 'h1', 'summary': 'p'})."""
        out: dict[str, Any] = {}
        for key, tag in (fields or {}).items():
            tag_safe = re.escape(tag)
            matches = re.findall(rf"(?is)<{tag_safe}[^>]*>(.*?)</{tag_safe}>", str(raw_html or ""))
            cleaned = [self._clean(m) for m in matches if self._clean(m)]
            out[key] = cleaned[0] if len(cleaned) == 1 else cleaned
        return out
