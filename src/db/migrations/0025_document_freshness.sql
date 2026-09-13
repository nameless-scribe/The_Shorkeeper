ALTER TABLE documents ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'snapshot';
ALTER TABLE documents ADD COLUMN source_modified_at INTEGER;
ALTER TABLE documents ADD COLUMN source_size INTEGER;
ALTER TABLE documents ADD COLUMN last_checked_at INTEGER;
ALTER TABLE documents ADD COLUMN freshness_status TEXT NOT NULL DEFAULT 'snapshot';
ALTER TABLE documents ADD COLUMN stale_reason TEXT;
ALTER TABLE documents ADD COLUMN sync_policy TEXT NOT NULL DEFAULT 'manual';

UPDATE documents
SET source_kind = CASE WHEN source_path IS NULL THEN 'snapshot' ELSE 'local_file' END,
    freshness_status = CASE WHEN source_path IS NULL THEN 'snapshot' ELSE 'unknown' END,
    sync_policy = 'manual';

CREATE INDEX idx_documents_freshness
  ON documents(freshness_status, last_checked_at);
CREATE INDEX idx_documents_auto_sync
  ON documents(sync_policy, last_checked_at)
  WHERE sync_policy = 'auto';
