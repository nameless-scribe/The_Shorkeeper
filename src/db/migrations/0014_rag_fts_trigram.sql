-- Rebuild RAG FTS with trigram tokenizer (requires SQLite FTS5 + trigram; skipped on sql.js without FTS5)
DROP TABLE IF EXISTS document_chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  content,
  filename,
  tokenize='trigram'
);

-- Preserve the same searchable text shape used by the RAG import/reindex path.
INSERT INTO document_chunks_fts (chunk_id, document_id, content, filename)
SELECT c.id, c.document_id, '[' || d.filename || ']' || char(10) || char(10) || c.content, d.filename
FROM document_chunks c
JOIN documents d ON d.id = c.document_id;
