ALTER TABLE documents ADD COLUMN content_hash TEXT;
ALTER TABLE documents ADD COLUMN embedding_model TEXT;
ALTER TABLE documents ADD COLUMN embedding_dim INTEGER;

CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents (content_hash);
