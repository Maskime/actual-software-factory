CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024) NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON embeddings (project_id);
