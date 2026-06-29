import type { OpenAIToolCall } from '../agent/types';

export type { AgUiEvent, AgentPresenceState } from '../agent/types';
export type { ToolResult } from '../tools/types';

export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | {
      type: 'round_complete';
      content: string | null;
      toolCalls: OpenAIToolCall[];
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface WorkspaceAttachment {
  relativePath: string;
  originalName: string;
  size: number;
}

export interface AgentSendPayload {
  sessionId?: string;
  message: string;
  attachments?: WorkspaceAttachment[];
}

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ModelProtocol = 'openai' | 'anthropic';

export interface McpServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface PerformanceSettingsInfo {
  ragEnabled: boolean;
  memoryExtractMode: 'always' | 'manual' | 'every_n';
  memoryExtractInterval: number;
  maxHistoryMessages: number;
  compressThreshold: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];
  trigger: 'manual' | 'auto';
  enabled: boolean;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  compressed?: boolean;
}

export interface MessageInfo {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface WorldbookEntryInfo {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: boolean;
  createdAt: number;
}

export interface ProfileEntryInfo {
  key: string;
  value: string;
  updatedAt: number;
}

export interface AppStatus {
  model: string;
  baseUrl: string;
  apiConfigured: boolean;
  databasePath: string;
}

export interface DockPreferencesInfo {
  alwaysOnTop: boolean;
  positionLocked: boolean;
}

export interface TokenUsageSummaryInfo {
  today: number;
  week: number;
  total: number;
  dailyLast7: { date: string; tokens: number }[];
}

export type ScheduleKind = 'recurring' | 'once';

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  scheduleKind: ScheduleKind;
  cron: string;
  runAt: number | null;
  actionType: string;
  actionPayload: string;
  enabled: boolean;
  lastRunAt: number | null;
}

export interface DocumentInfo {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunkCount: number;
  importedAt: number;
}

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'done'; document: DocumentInfo };
