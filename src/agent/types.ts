import type { ToolResult } from '../tools/types';

export interface AgentPresenceState {
  online: boolean;
  mood: 'happy' | 'calm' | 'sleepy' | 'thinking';
  activity: 'idle' | 'accompanying' | 'feeding' | 'working';
  /** 羁绊阶段名（不含数值） */
  affectionStage: string;
  currentModel: string;
  tokenUsageToday: number;
}

export type AgUiEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'run_finished'; runId: string }
  | { type: 'run_error'; runId: string; message: string; sessionId?: string }
  | { type: 'text_delta'; runId: string; delta: string }
  | { type: 'reasoning_delta'; runId: string; delta: string }
  | { type: 'tool_call_start'; runId: string; callId: string; name: string; args: unknown }
  | { type: 'tool_call_end'; runId: string; callId: string; result: ToolResult }
  | { type: 'state_update'; state: AgentPresenceState }
  | { type: 'live2d_motion'; motion: string; priority?: number }
  | { type: 'tts_chunk'; runId: string; audio: ArrayBuffer }
  | { type: 'usage'; runId: string; promptTokens: number; completionTokens: number; cachedTokens?: number };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Messages sent to the LLM API (includes tool roles). */
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AgentRunRequest {
  sessionId: string;
  userMessage: string;
  options?: {
    modelId?: string;
    style?: 'gentle' | 'default' | 'formal';
    reasoning?: 'auto' | 'on' | 'off';
    activeSkillIds?: string[];
  };
}

export type PermissionDecision = 'allow' | 'deny' | 'confirm';

export type PermissionFlag =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network'
  | 'mcp'
  | 'shell';

export interface PermissionPolicy {
  filesystem: {
    allowedRoots: string[];
    writeAllowed: boolean;
    requireConfirmOnWrite: boolean;
  };
  network: boolean;
  mcp: boolean;
}
