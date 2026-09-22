-- ERP 对话报工：草稿、获批批次与逐条发送账本。
-- 外部提交不可依赖聊天正文、进程内 Map 或短期 run checkpoint 防重。

CREATE TABLE IF NOT EXISTS erp_report_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  connection_key TEXT NOT NULL,
  erp_origin TEXT NOT NULL,
  erp_user_id TEXT,
  work_date TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  items_json TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (revision >= 1),
  CHECK (status IN ('draft', 'ready', 'submitted', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_erp_report_drafts_session_date
  ON erp_report_drafts (session_id, work_date, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_erp_report_drafts_connection_status
  ON erp_report_drafts (connection_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS erp_report_batches (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  preview_revision TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  authorized_run_id TEXT NOT NULL,
  execution_status TEXT NOT NULL DEFAULT 'approved',
  active_claim_key TEXT,
  claim_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (draft_id, draft_revision),
  FOREIGN KEY (draft_id) REFERENCES erp_report_drafts(id),
  CHECK (execution_status IN ('approved', 'running', 'partially_verified', 'verified', 'cancelled', 'failed', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_report_batches_active_claim
  ON erp_report_batches (active_claim_key)
  WHERE active_claim_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_erp_report_batches_status
  ON erp_report_batches (execution_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS erp_report_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  logical_operation_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  previous_attempt_id TEXT,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  state TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  before_entries_json TEXT NOT NULL DEFAULT '[]',
  remote_time_entry_id TEXT,
  evidence_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (logical_operation_id, attempt_no),
  FOREIGN KEY (batch_id) REFERENCES erp_report_batches(id),
  CHECK (attempt_no >= 1),
  CHECK (state IN ('prepared', 'dispatching', 'verifying', 'unknown', 'verified', 'known_not_written', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_report_submissions_live_operation
  ON erp_report_submissions (logical_operation_id)
  WHERE state IN ('prepared', 'dispatching', 'verifying', 'unknown', 'verified');

CREATE INDEX IF NOT EXISTS idx_erp_report_submissions_batch
  ON erp_report_submissions (batch_id, created_at);

