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
