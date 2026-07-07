CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL,
  source_type  TEXT NOT NULL,
  source_path  TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_hash TEXT,
  embedding    VECTOR(1024) NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON embeddings (project_id);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id          SERIAL PRIMARY KEY,
  agent_key   TEXT NOT NULL,
  label       TEXT,
  content     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un seul is_active=TRUE par agent_key (garde-fou DB, choix opérateur)
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_active
  ON prompt_versions (agent_key) WHERE is_active;
