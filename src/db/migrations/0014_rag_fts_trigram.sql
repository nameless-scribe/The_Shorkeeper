-- Rebuild RAG FTS with trigram tokenizer (requires SQLite FTS5 + trigram; skipped on sql.js without FTS5)
DROP TABLE IF EXISTS document_chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  content,
  filename,
  tokenize='trigram'
);
