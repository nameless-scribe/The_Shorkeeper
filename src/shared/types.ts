export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type AgUiEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'run_finished'; runId: string }
  | { type: 'run_error'; runId: string; message: string }
  | { type: 'text_delta'; runId: string; delta: string }
  | { type: 'usage'; runId: string; promptTokens: number; completionTokens: number };

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
