/** 数据库表类型定义（与 migrations 对应，供 M3+ 模块引用） */

export interface UserProfileRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface LongTermMemoryRow {
  id: string;
  memory_key: string | null;
  content: string;
  importance: number;
  source_session_id: string | null;
  memory_type: string;
  confidence: number;
  sensitivity: string;
  model_use_policy: string;
  status: string;
  valid_from: number;
  expires_at: number | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface MemorySourceRow {
  id: string;
  memory_id: string;
  source_type: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_run_id: string | null;
  source_document_id: string | null;
  source_chunk_id: string | null;
  source_tool_name: string | null;
  source_entity_id: string | null;
  source_ref: string | null;
  summary: string | null;
  created_at: number;
}

export interface WorldbookEntryRow {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: number;
  created_at: number;
}

export interface TokenUsageRow {
  id: string;
  session_id: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  created_at: number;
}

export interface ScheduledTaskRow {
  id: string;
  name: string;
  cron: string;
  action_type: string;
  action_payload: string;
  enabled: number;
  last_run_at: number | null;
  schedule_kind: string;
  run_at: number | null;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentRow {
  id: string;
  filename: string;
  filepath: string;
  mime_type: string | null;
  chunk_count: number;
  imported_at: number;
  content_hash?: string | null;
  embedding_model?: string | null;
  embedding_dim?: number | null;
  status?: 'importing' | 'indexed' | 'index_failed' | 'needs_rebuild' | 'superseded' | 'deleted';
  status_error?: string | null;
  updated_at?: number | null;
  indexed_at?: number | null;
  deleted_at?: number | null;
  source_path?: string | null;
  title?: string | null;
  title_key?: string | null;
  document_version?: number;
  superseded_by?: string | null;
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface DocumentChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  embedding: Uint8Array;
}

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: number;
}

export interface BookkeepingEntryRow {
  id: string;
  session_id: string | null;
  category: string;
  amount: number;
  currency: string;
  note: string | null;
  entry_type: string;
  created_at: number;
}

export interface SessionSummaryRow {
  session_id: string;
  summary: string;
  compressed_up_to_message_id: string | null;
  updated_at: number;
}

export interface UserTaskRow {
  id: string;
  title: string;
  status: string;
  source_file: string | null;
  source_row: number | null;
  module: string | null;
  due_at: string | null;
  notes: string | null;
  goal_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  target_date: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface CommitmentRow {
  id: string;
  goal_id: string | null;
  title: string;
  owner: string;
  status: string;
  due_at: number | null;
  promised_to: string | null;
  source_session_id: string | null;
  source_run_id: string | null;
  task_id: string | null;
  scheduled_task_id: string | null;
  evidence_run_id: string | null;
  evidence_artifact_id: string | null;
  last_followed_up_at: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface BriefingRow {
  id: string;
  brief_date: string;
  kind: string;
  run_id: string | null;
  status: string;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskRunRow {
  id: string;
  session_id: string;
  kind: string;
  trigger_ref: string | null;
  phase: string;
  terminal_reason: string | null;
  error_summary: string | null;
  model_id: string | null;
  assistant_message_id: string | null;
  step_count: number;
  failed_step_count: number;
  started_at: number;
  updated_at: number;
  terminal_at: number | null;
  acknowledged_at: number | null;
}

export interface TaskRunStepRow {
  id: string;
  run_id: string;
  call_id: string;
  seq: number;
  tool_name: string;
  status: string;
  error_category: string | null;
  error_summary: string | null;
  risk_level: string | null;
  idempotent: number;
  started_at: number;
  ended_at: number | null;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  step_id: string | null;
  session_id: string;
  tool_name: string;
  relative_path: string;
  original_name: string;
  size: number;
  sha256: string | null;
  created_at: number;
}

export interface ApprovalRow {
  id: string;
  run_id: string | null;
  session_id: string | null;
  tool_name: string;
  args_summary: string;
  risk_level: string;
  status: string;
  decided_by: string | null;
  requested_at: number;
  decided_at: number | null;
}

export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT DEFAULT '新对话' NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
