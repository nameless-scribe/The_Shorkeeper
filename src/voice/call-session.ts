import { ev, createCallId } from '../agent/events';
import { resolveAgentSession } from '../agent/resolve-session';
import { runOrchestrator } from '../agent/orchestrator';
import {
  acquireSessionRun,
  getSessionRun,
  releaseSessionRun,
  setSessionRunId,
} from '../agent/session-run-lock';
import type { AgUiEvent, CallState } from '../agent/types';
import { getModelConfigSafe } from '../models/config';
import { recordTokenUsage } from '../db/token-usage';

export interface CallSessionRecord {
  callId: string;
  sessionId: string;
  state: CallState;
}

export type CallSessionResult = { ok: true } | { ok: false; error: string };
export type CallSessionStartResult =
  | { ok: true; callId: string }
  | { ok: false; error: string };

export interface CallSessionHost {
  broadcast(event: AgUiEvent): void;
  onRunStarted(): void;
  onRunFinished(): void;
  onRunError(): void;
}

class CallSessionManager {
  constructor(private readonly host: CallSessionHost) {}

  private readonly sessions = new Map<string, CallSessionRecord>();

  get(callId: string): CallSessionRecord | undefined {
    return this.sessions.get(callId);
  }

  isActive(sessionId?: string): boolean {
    for (const record of this.sessions.values()) {
      if (record.state === 'idle') continue;
      if (!sessionId || record.sessionId === sessionId) return true;
    }
    return false;
  }

  start(sessionId?: string): CallSessionStartResult {
    const session = resolveAgentSession(sessionId);
    if (!session) {
      return { ok: false, error: '会话不存在' };
    }

    const callId = createCallId();
    const record: CallSessionRecord = {
      callId,
      sessionId: session.id,
      state: 'listening',
    };
    this.sessions.set(callId, record);
    this.host.broadcast(ev.callState(callId, 'listening'));
    return { ok: true, callId };
  }

  async submitUserText(callId: string, text: string): Promise<CallSessionResult> {
    const record = this.sessions.get(callId);
    if (!record) {
      return { ok: false, error: '通话不存在' };
    }
    if (record.state !== 'listening') {
      return { ok: false, error: '当前无法接收语音' };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, error: '识别文本为空' };
    }

    record.state = 'thinking';
    this.host.broadcast(ev.callState(callId, 'thinking'));
    this.host.broadcast(ev.callTranscript(callId, 'user', trimmed, true));

    const controller = acquireSessionRun(record.sessionId);
    if (!controller) {
      record.state = 'listening';
      this.host.broadcast(ev.callState(callId, 'listening'));
      return { ok: false, error: '上一条消息仍在处理中' };
    }

    this.host.onRunStarted();
    let runId: string | null = null;
    let assistantText = '';
    let terminalError: string | null = null;

    try {
      for await (const agEvent of runOrchestrator(trimmed, record.sessionId, controller.signal)) {
        if (controller.signal.aborted) break;

        if (agEvent.type === 'run_started') {
          runId = agEvent.runId;
          setSessionRunId(record.sessionId, agEvent.runId);
        }

        if (agEvent.type === 'text_delta') {
          assistantText += agEvent.delta;
        }

        if (agEvent.type === 'usage') {
          const config = getModelConfigSafe();
          if (config) {
            recordTokenUsage({
              sessionId: record.sessionId,
              model: config.model,
              promptTokens: agEvent.promptTokens,
              completionTokens: agEvent.completionTokens,
              cachedTokens: agEvent.cachedTokens,
            });
          }
        }

        if (agEvent.type === 'run_finished') {
          this.host.onRunFinished();
        } else if (agEvent.type === 'run_error') {
          this.host.onRunError();
          terminalError = agEvent.message;
        }

        this.host.broadcast(agEvent);
      }

      if (controller.signal.aborted) {
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
        return { ok: true };
      }

      if (terminalError) {
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
        this.host.broadcast(ev.callError(callId, terminalError));
        return { ok: false, error: terminalError };
      }

      const finalText = assistantText.trim();
      if (finalText) {
        record.state = 'speaking';
        // Transcript must arrive before speaking state so CallStage has text when playback starts.
        this.host.broadcast(ev.callTranscript(callId, 'assistant', finalText, true));
        this.host.broadcast(ev.callState(callId, 'speaking'));
      } else {
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
      }

      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.host.onRunError();
      if (runId) {
        this.host.broadcast(ev.runError(runId, message, record.sessionId));
      }
      record.state = 'listening';
      this.host.broadcast(ev.callState(callId, 'listening'));
      this.host.broadcast(ev.callError(callId, message));
      return { ok: false, error: message };
    } finally {
      releaseSessionRun(record.sessionId);
    }
  }

  speakingDone(callId: string): CallSessionResult {
    const record = this.sessions.get(callId);
    if (!record) {
      return { ok: false, error: '通话不存在' };
    }
    if (record.state !== 'speaking') {
      return { ok: true };
    }
    record.state = 'listening';
    this.host.broadcast(ev.callState(callId, 'listening'));
    return { ok: true };
  }

  end(callId: string): CallSessionResult {
    const record = this.sessions.get(callId);
    if (!record) {
      return { ok: false, error: '通话不存在' };
    }

    const activeRun = getSessionRun(record.sessionId);
    if (activeRun) {
      activeRun.controller.abort();
      this.host.onRunError();
      if (activeRun.runId) {
        this.host.broadcast(
          ev.runError(activeRun.runId, '通话已结束', record.sessionId),
        );
      }
      releaseSessionRun(record.sessionId);
    }

    record.state = 'idle';
    this.host.broadcast(ev.callState(callId, 'idle'));
    this.sessions.delete(callId);
    return { ok: true };
  }
}

let manager: CallSessionManager | null = null;

export function getCallSessionManager(host?: CallSessionHost): CallSessionManager {
  if (!manager) {
    if (!host) {
      throw new Error('CallSessionManager requires a host on first init');
    }
    manager = new CallSessionManager(host);
  }
  return manager;
}

/** Test-only reset. */
export function resetCallSessionManager(): void {
  manager = null;
}

export function createCallSessionManager(host: CallSessionHost): CallSessionManager {
  return new CallSessionManager(host);
}
