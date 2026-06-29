CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER
);
