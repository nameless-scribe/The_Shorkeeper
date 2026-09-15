-- P6.2 ask_user 提问账本：问了什么、给了哪些选项、用户怎么答的。
-- 不复用 approvals：它的语义是"允许不允许"，参数只存摘要，塞进回答会让两种记录互相污染。
-- 正文限长由仓储层保证（问题 300 字、回答 4000 字）。

CREATE TABLE IF NOT EXISTS user_questions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  session_id TEXT,
  question TEXT NOT NULL,
  why TEXT,
  -- 选项数组 JSON：[{ id, label, hint? }]
  options_json TEXT NOT NULL DEFAULT '[]',
  allow_free_text INTEGER NOT NULL DEFAULT 1,
  -- 用户的回答；选项作答时同时记 option_id
  answer TEXT,
  option_id TEXT,
  -- pending / answered / expired / cancelled / interrupted
  status TEXT NOT NULL DEFAULT 'pending',
  -- user / timeout / abort / window_closed / startup
  decided_by TEXT,
  asked_at INTEGER NOT NULL,
  answered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_questions_run
  ON user_questions (run_id, asked_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_questions_status
  ON user_questions (status, asked_at DESC);
