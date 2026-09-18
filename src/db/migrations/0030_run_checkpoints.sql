-- 有界、加密的显式续跑检查点；旧运行不生成假检查点。
CREATE TABLE IF NOT EXISTS task_run_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  root_run_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_run_id TEXT UNIQUE,
  FOREIGN KEY (run_id) REFERENCES task_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_session ON task_run_checkpoints(session_id);
CREATE TRIGGER IF NOT EXISTS delete_session_run_checkpoints AFTER DELETE ON sessions
BEGIN
  DELETE FROM task_run_checkpoints WHERE session_id = OLD.id;
END;
