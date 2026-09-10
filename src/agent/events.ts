import { v4 as uuid } from 'uuid';
import type { AgentPresenceState, AgUiEvent, AgentPlanItem, CallState } from './types';
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

  runError(runId: string, message: string, sessionId?: string): AgUiEvent {
    return sessionId
      ? { type: 'run_error', runId, message, sessionId }
      : { type: 'run_error', runId, message };
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

  planUpdated(runId: string, items: AgentPlanItem[]): AgUiEvent {
    return { type: 'plan_updated', runId, items };
  },

  stateUpdate(state: AgentPresenceState): AgUiEvent {
    return { type: 'state_update', state };
  },

  ttsChunk(runId: string, audio: ArrayBuffer): AgUiEvent {
    return { type: 'tts_chunk', runId, audio };
  },

  usage(runId: string, promptTokens: number, completionTokens: number, cachedTokens?: number): AgUiEvent {
    return { type: 'usage', runId, promptTokens, completionTokens, cachedTokens };
  },

  callState(callId: string, state: CallState): AgUiEvent {
    return { type: 'call_state', callId, state };
  },

  callTranscript(
    callId: string,
    role: 'user' | 'assistant',
    text: string,
    final: boolean,
  ): AgUiEvent {
    return { type: 'call_transcript', callId, role, text, final };
  },

  callError(callId: string, message: string): AgUiEvent {
    return { type: 'call_error', callId, message };
  },

  callDegraded(callId: string, reason: 'stream_failures', message: string): AgUiEvent {
    return { type: 'call_degraded', callId, reason, message };
  },

  callAudioChunk(
    callId: string,
    audio: ArrayBuffer,
    seq: number,
    mime: string,
  ): AgUiEvent {
    return { type: 'call_audio_chunk', callId, audio, seq, mime };
  },

  callSpeechEnd(callId: string): AgUiEvent {
    return { type: 'call_speech_end', callId };
  },
};
