ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'indexed';
ALTER TABLE documents ADD COLUMN status_error TEXT;
ALTER TABLE documents ADD COLUMN updated_at INTEGER;
ALTER TABLE documents ADD COLUMN indexed_at INTEGER;
ALTER TABLE documents ADD COLUMN deleted_at INTEGER;

UPDATE documents
SET status = 'indexed',
    updated_at = imported_at,
    indexed_at = imported_at
WHERE updated_at IS NULL OR indexed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
