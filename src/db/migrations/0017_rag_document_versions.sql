ALTER TABLE documents ADD COLUMN source_path TEXT;
ALTER TABLE documents ADD COLUMN title TEXT;
ALTER TABLE documents ADD COLUMN title_key TEXT;
ALTER TABLE documents ADD COLUMN document_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN superseded_by TEXT;

UPDATE documents
SET title = filename,
    title_key = lower(filename),
    document_version = 1
WHERE title IS NULL OR title_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_source_version
  ON documents (source_path, document_version);
CREATE INDEX IF NOT EXISTS idx_documents_title_version
  ON documents (title_key, document_version);
CREATE INDEX IF NOT EXISTS idx_documents_superseded_by
  ON documents (superseded_by);
