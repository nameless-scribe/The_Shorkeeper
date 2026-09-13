CREATE TABLE task_run_context_sources (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT,
  document_version INTEGER,
  source_updated_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_task_run_context_sources_run_ref
  ON task_run_context_sources(run_id, source_ref);
CREATE INDEX idx_task_run_context_sources_source
  ON task_run_context_sources(source_type, source_id, created_at DESC);
