import { v4 as uuid } from 'uuid';
import type { AgentPresenceState, AgUiEvent } from './types';
import type { ToolResult } from '../tools/types';

export function createRunId(): string {
  return uuid();
}

export function createCallId(): string {
  return uuid();
}

export const ev = {
  runStarted(runId: string, sessionId: string): AgUiEvent {
    return { type: 'run_started', runId, sessionId };
  },

  runFinished(runId: string): AgUiEvent {
    return { type: 'run_finished', runId };
  },

  runError(runId: string, message: string): AgUiEvent {
    return { type: 'run_error', runId, message };
  },

  textDelta(runId: string, delta: string): AgUiEvent {
    return { type: 'text_delta', runId, delta };
  },

  reasoningDelta(runId: string, delta: string): AgUiEvent {
    return { type: 'reasoning_delta', runId, delta };
  },

  toolCallStart(
    runId: string,
    callId: string,
    name: string,
    args: unknown,
  ): AgUiEvent {
    return { type: 'tool_call_start', runId, callId, name, args };
  },

  toolCallEnd(runId: string, callId: string, result: ToolResult): AgUiEvent {
    return { type: 'tool_call_end', runId, callId, result };
  },

  stateUpdate(state: AgentPresenceState): AgUiEvent {
    return { type: 'state_update', state };
  },

  live2dMotion(motion: string, priority?: number): AgUiEvent {
    return { type: 'live2d_motion', motion, priority };
  },

  ttsChunk(runId: string, audio: ArrayBuffer): AgUiEvent {
    return { type: 'tts_chunk', runId, audio };
  },

  usage(runId: string, promptTokens: number, completionTokens: number): AgUiEvent {
    return { type: 'usage', runId, promptTokens, completionTokens };
  },
};
