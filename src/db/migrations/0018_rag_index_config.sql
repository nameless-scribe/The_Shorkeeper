ALTER TABLE documents ADD COLUMN chunk_size INTEGER NOT NULL DEFAULT 800;
ALTER TABLE documents ADD COLUMN chunk_overlap INTEGER NOT NULL DEFAULT 64;

UPDATE documents
SET chunk_size = 800,
    chunk_overlap = 64
WHERE chunk_size IS NULL OR chunk_overlap IS NULL;
