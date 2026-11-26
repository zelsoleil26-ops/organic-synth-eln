CREATE TABLE IF NOT EXISTS eln_pages (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_eln_pages_owner_updated
  ON eln_pages (owner_id, updated_at DESC);
