-- 结构化记忆键：同一 key 更新而非重复插入（治本去重）

ALTER TABLE long_term_memory ADD COLUMN memory_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_long_term_memory_key
  ON long_term_memory (memory_key)
  WHERE memory_key IS NOT NULL;
