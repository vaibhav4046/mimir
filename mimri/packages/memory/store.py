from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

PGVECTOR_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS mimri_memories (
    id BIGSERIAL PRIMARY KEY,
    block_type TEXT NOT NULL DEFAULT 'archival',
    block_name TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    embedding VECTOR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mimri_memories_trgm ON mimri_memories USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mimri_memories_vec ON mimri_memories USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS mimri_entities (
    name TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'concept',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mimri_relations (
    id BIGSERIAL PRIMARY KEY,
    source_entity TEXT NOT NULL REFERENCES mimri_entities(name) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    target_entity TEXT NOT NULL REFERENCES mimri_entities(name) ON DELETE CASCADE,
    weight REAL NOT NULL DEFAULT 1.0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
""".strip()


def hash_embed_text(text: str, dims: int = 64) -> list[float]:
    """Deterministic lightweight semantic/lexical embedding usable offline and compatible with pgvector."""
    vec = [0.0] * dims
    tokens = re.findall(r"[a-z0-9_]+", (text or "").lower())
    if not tokens:
        return vec
    for tok in tokens:
        digest = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:2], "big") % dims
        sign = 1.0 if (digest[2] & 1) == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def trigram_jaccard(a: str, b: str) -> float:
    def trigrams(s: str) -> set[str]:
        norm = f"  {re.sub(r'\\s+', ' ', (s or '').lower().strip())} "
        if len(norm) < 3:
            return {norm}
        return {norm[i : i + 3] for i in range(len(norm) - 2)}

    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


class MimriMemoryStore:
    """PostgreSQL (pgvector + pg_trgm) compatible memory + entity graph + Markdown mirror."""

    def __init__(self, db_path: str | Path | None = None, postgres_dsn: str | None = None) -> None:
        self.postgres_dsn = postgres_dsn
        self.db_path = Path(db_path) if db_path else None
        if self.db_path:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path) if self.db_path else ":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        cur = self.conn.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS core_memory (
                block TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS archival_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS entity_graph (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                relation TEXT NOT NULL,
                target TEXT NOT NULL,
                weight REAL NOT NULL DEFAULT 1.0,
                updated_at REAL NOT NULL,
                UNIQUE(source, relation, target)
            );
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def get_postgres_ddl(self) -> str:
        return PGVECTOR_SCHEMA_SQL

    def core_memory_append(self, block: str, content: str) -> dict[str, Any]:
        block = block.strip()
        row = self.conn.execute("SELECT content FROM core_memory WHERE block = ?", (block,)).fetchone()
        existing = row["content"] if row else ""
        updated = f"{existing}\n{content}".strip() if existing else content.strip()
        self.conn.execute(
            "INSERT OR REPLACE INTO core_memory(block, content, updated_at) VALUES (?, ?, ?)",
            (block, updated, time.time()),
        )
        self.conn.commit()
        return {"block": block, "content": updated}

    def core_memory_replace(self, block: str, old_text: str, new_text: str) -> dict[str, Any]:
        block = block.strip()
        row = self.conn.execute("SELECT content FROM core_memory WHERE block = ?", (block,)).fetchone()
        if not row:
            raise KeyError(f"Core memory block '{block}' not found")
        current = row["content"]
        if old_text not in current:
            raise ValueError(f"Text '{old_text}' not found in block '{block}'")
        updated = current.replace(old_text, new_text, 1)
        self.conn.execute(
            "UPDATE core_memory SET content = ?, updated_at = ? WHERE block = ?",
            (updated, time.time(), block),
        )
        self.conn.commit()
        return {"block": block, "content": updated}

    def list_core_memory(self) -> dict[str, str]:
        rows = self.conn.execute("SELECT block, content FROM core_memory ORDER BY block ASC").fetchall()
        return {r["block"]: r["content"] for r in rows}

    def archival_memory_insert(
        self,
        text: str,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        vec = hash_embed_text(text)
        cur = self.conn.execute(
            "INSERT INTO archival_memory(content, tags_json, metadata_json, embedding_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (text.strip(), json.dumps(tags or []), json.dumps(metadata or {}), json.dumps(vec), time.time()),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def archival_memory_search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        qvec = hash_embed_text(query)
        rows = self.conn.execute("SELECT * FROM archival_memory ORDER BY id DESC").fetchall()
        scored: list[dict[str, Any]] = []
        q_lower = (query or "").lower()
        for r in rows:
            emb = json.loads(r["embedding_json"])
            cos = cosine_similarity(qvec, emb)
            trgm = trigram_jaccard(query, r["content"])
            substr_bonus = 0.25 if q_lower and q_lower in r["content"].lower() else 0.0
            score = round(0.55 * cos + 0.45 * trgm + substr_bonus, 4)
            scored.append(
                {
                    "id": r["id"],
                    "content": r["content"],
                    "tags": json.loads(r["tags_json"]),
                    "metadata": json.loads(r["metadata_json"]),
                    "score": score,
                    "vector_score": round(cos, 4),
                    "trgm_score": round(trgm, 4),
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[: max(1, top_k)]

    def entity_graph_upsert(self, source: str, relation: str, target: str, weight: float = 1.0) -> dict[str, Any]:
        s, rel, t = source.strip(), relation.strip().upper(), target.strip()
        self.conn.execute(
            """
            INSERT INTO entity_graph(source, relation, target, weight, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(source, relation, target)
            DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at
            """,
            (s, rel, t, float(weight), time.time()),
        )
        self.conn.commit()
        return {"source": s, "relation": rel, "target": t, "weight": float(weight)}

    def entity_graph_query(self, entity: str) -> list[dict[str, Any]]:
        key = entity.strip().lower()
        rows = self.conn.execute(
            "SELECT source, relation, target, weight FROM entity_graph WHERE LOWER(source) = ? OR LOWER(target) = ? ORDER BY weight DESC, id DESC",
            (key, key),
        ).fetchall()
        return [dict(r) for r in rows]

    def export_markdown(self, md_path: str | Path) -> Path:
        out = Path(md_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# Mimri Shared Memory (Auditable Markdown Mirror)", "", "## Core Memory"]
        for block, content in self.list_core_memory().items():
            lines.append(f"### [{block}]")
            lines.append(content)
            lines.append("")
        lines.append("## Archival Memory")
        for r in self.conn.execute("SELECT id, content, tags_json FROM archival_memory ORDER BY id ASC").fetchall():
            tags = json.loads(r["tags_json"])
            tag_str = ", ".join(tags) if tags else "untagged"
            lines.append(f"- ({r['id']}) [{tag_str}] {r['content']}")
        lines.append("")
        lines.append("## Entity Graph")
        for r in self.conn.execute("SELECT source, relation, target, weight FROM entity_graph ORDER BY id ASC").fetchall():
            lines.append(f"- `{r['source']}` -[{r['relation']} w={r['weight']}]-> `{r['target']}`")
        out.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
        return out

    def sync_from_markdown(self, md_path: str | Path) -> dict[str, int]:
        text = Path(md_path).read_text(encoding="utf-8")
        imported = {"core": 0, "archival": 0, "entities": 0}
        section = None
        current_block = None
        block_buf: list[str] = []

        def flush_block() -> None:
            nonlocal current_block, block_buf
            if current_block and block_buf:
                self.conn.execute(
                    "INSERT OR REPLACE INTO core_memory(block, content, updated_at) VALUES (?, ?, ?)",
                    (current_block, "\n".join(block_buf).strip(), time.time()),
                )
                imported["core"] += 1
            current_block = None
            block_buf = []

        for line in text.splitlines():
            if line.startswith("## "):
                flush_block()
                section = line[3:].strip().lower()
                continue
            if section == "core memory":
                m = re.match(r"^### \[([^\]]+)\]", line.strip())
                if m:
                    flush_block()
                    current_block = m.group(1).strip()
                elif current_block is not None:
                    block_buf.append(line)
            elif section == "archival memory":
                m = re.match(r"^- \(\d+\) \[([^\]]*)\] (.+)$", line.strip())
                if m:
                    tags = [t.strip() for t in m.group(1).split(",") if t.strip() and t.strip() != "untagged"]
                    content = m.group(2).strip()
                    exists = self.conn.execute("SELECT 1 FROM archival_memory WHERE content = ?", (content,)).fetchone()
                    if not exists:
                        self.archival_memory_insert(content, tags=tags)
                        imported["archival"] += 1
            elif section == "entity graph":
                m = re.match(r"^- `([^`]+)` -\[([A-Z0-9_]+) w=([0-9.]+)\]-> `([^`]+)`$", line.strip())
                if m:
                    self.entity_graph_upsert(m.group(1), m.group(2), m.group(4), weight=float(m.group(3)))
                    imported["entities"] += 1
        flush_block()
        self.conn.commit()
        return imported
