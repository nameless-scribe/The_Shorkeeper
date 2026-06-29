-- M3 记忆 / Worldbook 表（种子数据依赖此 schema）
-- 注：sql.js 默认不含 FTS5；全文检索在 M3 可用 LIKE 或改用系统 SQLite 追加 0002_worldbook_fts5.sql

CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  source_session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worldbook_entries (
  id TEXT PRIMARY KEY NOT NULL,
  keys TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worldbook_enabled_priority
  ON worldbook_entries (enabled, priority DESC);
