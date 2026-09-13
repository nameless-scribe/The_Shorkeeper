ALTER TABLE long_term_memory ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE long_term_memory ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;
ALTER TABLE long_term_memory ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE long_term_memory ADD COLUMN model_use_policy TEXT NOT NULL DEFAULT 'allow';
ALTER TABLE long_term_memory ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE long_term_memory ADD COLUMN valid_from INTEGER;
ALTER TABLE long_term_memory ADD COLUMN expires_at INTEGER;
ALTER TABLE long_term_memory ADD COLUMN superseded_by TEXT;
ALTER TABLE long_term_memory ADD COLUMN updated_at INTEGER;

UPDATE long_term_memory
SET valid_from = COALESCE(valid_from, created_at),
    updated_at = COALESCE(updated_at, created_at);

DROP INDEX IF EXISTS idx_long_term_memory_key;
CREATE UNIQUE INDEX idx_long_term_memory_active_key
  ON long_term_memory(memory_key)
  WHERE memory_key IS NOT NULL AND status = 'active';
CREATE INDEX idx_long_term_memory_status_updated
  ON long_term_memory(status, updated_at DESC);
CREATE INDEX idx_long_term_memory_expiry
  ON long_term_memory(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE memory_candidates ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE memory_candidates ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE memory_candidates ADD COLUMN model_use_policy TEXT NOT NULL DEFAULT 'allow';
ALTER TABLE memory_candidates ADD COLUMN valid_from INTEGER;
ALTER TABLE memory_candidates ADD COLUMN expires_at INTEGER;
ALTER TABLE memory_candidates ADD COLUMN conflicts_with_memory_id TEXT;
ALTER TABLE memory_candidates ADD COLUMN proposed_action TEXT NOT NULL DEFAULT 'create';
ALTER TABLE memory_candidates ADD COLUMN source_message_id TEXT;
ALTER TABLE memory_candidates ADD COLUMN source_run_id TEXT;

CREATE TABLE memory_sources (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_session_id TEXT,
  source_message_id TEXT,
  source_run_id TEXT,
  source_document_id TEXT,
  source_chunk_id TEXT,
  source_tool_name TEXT,
  source_entity_id TEXT,
  source_ref TEXT,
  summary TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES long_term_memory(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_sources_memory_created
  ON memory_sources(memory_id, created_at DESC);
CREATE INDEX idx_memory_sources_source_ref
  ON memory_sources(source_type, source_ref)
  WHERE source_ref IS NOT NULL;

INSERT INTO memory_sources (
  id,
  memory_id,
  source_type,
  source_session_id,
  summary,
  created_at
)
SELECT
  'legacy:' || id,
  id,
  CASE WHEN source_session_id IS NULL THEN 'legacy' ELSE 'conversation' END,
  source_session_id,
  '由 0023 migration 从既有长期记忆回填',
  created_at
FROM long_term_memory;
