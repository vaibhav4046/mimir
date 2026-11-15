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
