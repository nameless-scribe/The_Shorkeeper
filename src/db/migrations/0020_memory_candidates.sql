CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  memory_key TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  source_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_status_created
  ON memory_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_key_content
  ON memory_candidates (memory_key, content);
