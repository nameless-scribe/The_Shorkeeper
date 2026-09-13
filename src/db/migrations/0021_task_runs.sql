-- P0 闭环骨架：持久化 Agent 运行、工具步骤、完成证据与审批记录。
-- task_runs 记录每一次 run 的生命周期；应用重启时所有非终态 run 会被标记为 interrupted。

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat',
  trigger_ref TEXT,
  phase TEXT NOT NULL DEFAULT 'created',
  terminal_reason TEXT,
  error_summary TEXT,
  model_id TEXT,
  assistant_message_id TEXT,
  step_count INTEGER NOT NULL DEFAULT 0,
  failed_step_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  terminal_at INTEGER,
  acknowledged_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_task_runs_session_started
  ON task_runs (session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_phase
  ON task_runs (phase);

CREATE TABLE IF NOT EXISTS task_run_steps (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_category TEXT,
  error_summary TEXT,
  risk_level TEXT,
  idempotent INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES task_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_task_run_steps_run_seq
  ON task_run_steps (run_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run
  ON artifacts (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_session
  ON artifacts (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  session_id TEXT,
  tool_name TEXT NOT NULL,
  args_summary TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_approvals_status_requested
  ON approvals (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_run
  ON approvals (run_id);
