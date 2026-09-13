-- P0 每日管家：目标、承诺与简报记录。
-- 待办仍是唯一的做事清单；承诺在待办之上追加"答应了谁、何时、证据"，目标把待办和承诺分组。

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_goals_status_priority
  ON goals (status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_at INTEGER,
  promised_to TEXT,
  source_session_id TEXT,
  source_run_id TEXT,
  task_id TEXT,
  scheduled_task_id TEXT,
  evidence_run_id TEXT,
  evidence_artifact_id TEXT,
  last_followed_up_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_commitments_status_due
  ON commitments (status, due_at);

CREATE INDEX IF NOT EXISTS idx_commitments_task
  ON commitments (task_id);

CREATE INDEX IF NOT EXISTS idx_commitments_scheduled_task
  ON commitments (scheduled_task_id);

CREATE INDEX IF NOT EXISTS idx_commitments_goal
  ON commitments (goal_id);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY NOT NULL,
  brief_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (brief_date, kind)
);

ALTER TABLE user_tasks ADD COLUMN goal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_tasks_goal
  ON user_tasks (goal_id);
