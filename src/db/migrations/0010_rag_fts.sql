-- Independent FTS table (document_chunks uses TEXT PK; manual sync on insert/delete)
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  content,
  filename,
  tokenize='unicode61'
);
