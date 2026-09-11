-- 可选：在支持 FTS5 的 SQLite（系统 sqlite3 / DB Browser）上手动或通过 migrate 尝试应用
-- sql.js 运行时通常不支持，应用内检索先用 LIKE 匹配 keys

CREATE VIRTUAL TABLE IF NOT EXISTS worldbook_fts USING fts5(
  keys,
  content,
  content='worldbook_entries',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS worldbook_entries_ai AFTER INSERT ON worldbook_entries BEGIN
  INSERT INTO worldbook_fts(rowid, keys, content) VALUES (new.rowid, new.keys, new.content);
END;

CREATE TRIGGER IF NOT EXISTS worldbook_entries_ad AFTER DELETE ON worldbook_entries BEGIN
  INSERT INTO worldbook_fts(worldbook_fts, rowid, keys, content) VALUES ('delete', old.rowid, old.keys, old.content);
END;

CREATE TRIGGER IF NOT EXISTS worldbook_entries_au AFTER UPDATE ON worldbook_entries BEGIN
  INSERT INTO worldbook_fts(worldbook_fts, rowid, keys, content) VALUES ('delete', old.rowid, old.keys, old.content);
  INSERT INTO worldbook_fts(rowid, keys, content) VALUES (new.rowid, new.keys, new.content);
END;

-- Populate the index when this optional migration is applied after data already exists.
INSERT INTO worldbook_fts(worldbook_fts) VALUES ('rebuild');
