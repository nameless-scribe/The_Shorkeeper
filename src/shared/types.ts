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

export interface AgentSendPayload {
  sessionId?: string;
  message: string;
}

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageInfo {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface AppStatus {
  model: string;
  baseUrl: string;
  apiConfigured: boolean;
  databasePath: string;
}
