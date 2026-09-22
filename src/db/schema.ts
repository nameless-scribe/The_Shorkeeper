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
  last_error?: string | null;
  last_error_at?: number | null;
  failure_count?: number | null;
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
  source_kind?: string;
  source_modified_at?: number | null;
  source_size?: number | null;
  last_checked_at?: number | null;
  freshness_status?: string;
  stale_reason?: string | null;
  sync_policy?: string;
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

export interface TaskRunContextSourceRow {
  id: string;
  run_id: string;
  source_type: string;
  source_id: string;
  source_ref: string;
  label: string;
  summary: string | null;
  document_version: number | null;
  source_updated_at: number | null;
  created_at: number;
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
  args_digest: string | null;
  preview_revision: string | null;
  call_id: string | null;
  risk_level: string;
  status: string;
  decided_by: string | null;
  requested_at: number;
  decided_at: number | null;
}

/** P7 数据源（密码为 protectSecret 密文） */
export interface DataSourceRow {
  id: string;
  name: string;
  kind: string;
  host: string;
  port: number;
  database_name: string;
  user: string;
  password: string;
  options_json: string;
  last_ok_at: number | null;
  last_error: string | null;
  writable_account: number | null;
  created_at: number;
  updated_at: number;
}

/** P7 数据字典：骨架与人工层分开存 */
export interface DataDictionaryRow {
  id: string;
  data_source_id: string;
  object_key: string;
  auto_json: string;
  manual_json: string;
  updated_at: number;
}

/** P7 指标定义 */
export interface MetricRow {
  id: string;
  data_source_id: string;
  name: string;
  sql_fragment: string;
  grain: string | null;
  notes: string | null;
  source: string;
  updated_at: number;
}

/** P7 命名查询：存做法（方案与 SQL），不存结果 */
export interface NamedQueryRow {
  id: string;
  data_source_id: string;
  name: string;
  question: string;
  plan_json: string;
  sql: string;
  notes: string | null;
  question_embedding: Uint8Array | null;
  created_at: number;
  last_run_at: number | null;
  last_row_count: number | null;
}

/** P7 查询记录：只有统计与产物路径 */
export interface QueryRunRow {
  id: string;
  run_id: string | null;
  data_source_id: string;
  named_query_id: string | null;
  plan_json: string;
  sql: string;
  status: string;
  row_count: number | null;
  duration_ms: number | null;
  artifact_path: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

/** P6.2 ask_user 提问账本 */
export interface UserQuestionRow {
  id: string;
  run_id: string | null;
  session_id: string | null;
  question: string;
  why: string | null;
  options_json: string;
  allow_free_text: number;
  answer: string | null;
  option_id: string | null;
  status: string;
  decided_by: string | null;
  asked_at: number;
  answered_at: number | null;
}

/** P4 录音转写账本；正文不入库，只存产物路径。 */
export interface AudioTranscriptRow {
  id: string;
  source_path: string;
  source_hash: string;
  size_bytes: number;
  duration_ms: number | null;
  provider: string;
  engine_type: string;
  diarization: number;
  status: string;
  attempt_id: string | null;
  transcript_path: string | null;
  sentence_count: number | null;
  speaker_count: number | null;
  error: string | null;
  provider_code: number | null;
  provider_request_id: string | null;
  sensitivity: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ProactiveEventRow {
  id: string;
  domain: string;
  kind: string;
  source_type: string;
  source_id: string;
  source_ref: string | null;
  dedupe_key: string;
  source_version: number;
  title: string;
  summary: string | null;
  urgency: string;
  status: string;
  due_at: number | null;
  occurred_at: number;
  expires_at: number | null;
  snoozed_until: number | null;
  resolved_at: number | null;
  resolved_reason: string | null;
  read_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProactivityDecisionRow {
  id: string;
  event_id: string | null;
  decision_key: string;
  subject_kind: string;
  subject_id: string;
  policy: string;
  route: string;
  reason: string;
  rule_version: string;
  evaluated_at: number;
}

export interface ProactivityDeliveryRow {
  id: string;
  event_id: string | null;
  delivery_key: string;
  subject_kind: string;
  subject_id: string;
  channel: string;
  status: string;
  scheduled_at: number | null;
  sent_at: number | null;
  error_category: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProactivityFeedbackRow {
  id: string;
  event_id: string;
  action: string;
  reason_code: string | null;
  created_at: number;
}

export interface TaskRunCheckpointRow {
  id: string;
  run_id: string;
  session_id: string;
  root_run_id: string;
  payload: string;
  created_at: number;
  expires_at: number;
  claimed_run_id: string | null;
}

export interface ErpReportDraftRow {
  id: string;
  session_id: string;
  connection_key: string;
  erp_origin: string;
  erp_user_id: string | null;
  work_date: string;
  revision: number;
  status: string;
  items_json: string;
  source_message_ids_json: string;
  created_at: number;
  updated_at: number;
}

export interface ErpReportBatchRow {
  id: string;
  draft_id: string;
  draft_revision: number;
  payload_json: string;
  payload_digest: string;
  preview_revision: string;
  approval_id: string;
  authorized_run_id: string;
  execution_status: string;
  active_claim_key: string | null;
  claim_run_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface ErpReportSubmissionRow {
  id: string;
  logical_operation_id: string;
  batch_id: string;
  item_id: string;
  attempt_no: number;
  previous_attempt_id: string | null;
  run_id: string;
  step_id: string;
  call_id: string;
  approval_id: string;
  state: string;
  request_digest: string;
  before_entries_json: string;
  remote_time_entry_id: string | null;
  evidence_json: string | null;
  error_code: string | null;
  created_at: number;
  sent_at: number | null;
  updated_at: number;
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
