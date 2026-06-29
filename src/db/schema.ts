/** 数据库表类型定义（与 migrations 对应，供 M3+ 模块引用） */

export interface UserProfileRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface LongTermMemoryRow {
  id: string;
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
