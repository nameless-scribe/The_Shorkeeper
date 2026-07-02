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
import { getVoiceSettings } from '../config/voice';
import { getModelConfigSafe } from '../models/config';
import { recordTokenUsage } from '../db/token-usage';
import { createTtsStreamSession, type TtsStreamSession } from './tts-engine';
import { DeltaSentenceBuffer } from './delta-sentence-buffer';
import { synthesizeVoiceChunk } from './synthesize-chunk';
import { hasSpeakableDialogue } from './text-for-speech';
import type { TtsOptions } from './types';

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
  onRunFinished(options?: { recordAffection?: boolean }): void;
  onRunError(): void;
}

type StreamMode = 'ws' | 'rest-fallback';

interface CallTurnContext {
  sentenceBuffer: DeltaSentenceBuffer;
  ttsStream: TtsStreamSession | null;
  audioSeq: number;
  speakingStarted: boolean;
  streamMode: StreamMode;
  assistantText: string;
}

function buildTtsOptions(): TtsOptions | null {
  const settings = getVoiceSettings();
  if (!settings.ttsEnabled || !settings.ttsVoiceId.trim()) {
    return null;
  }
  return {
    model: settings.ttsModel,
    voiceId: settings.ttsVoiceId,
    rate: settings.ttsRate,
    volume: settings.ttsVolume,
    format: 'mp3',
    languageHint:
      settings.sttLanguage === 'en' ? 'en' : settings.sttLanguage === 'zh' ? 'zh' : undefined,
  };
}

class CallSessionManager {
  constructor(private readonly host: CallSessionHost) {}

  private readonly sessions = new Map<string, CallSessionRecord>();
  private readonly turnContexts = new Map<string, CallTurnContext>();
  private readonly streamFailureCounts = new Map<string, number>();

  private static readonly STREAM_FAILURE_DEGRADE_THRESHOLD = 2;

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

  private noteStreamFailure(callId: string): void {
    const count = (this.streamFailureCounts.get(callId) ?? 0) + 1;
    this.streamFailureCounts.set(callId, count);
    if (count >= CallSessionManager.STREAM_FAILURE_DEGRADE_THRESHOLD) {
      this.host.broadcast(
        ev.callDegraded(
          callId,
          'stream_failures',
          '语音服务连接不稳定，建议切换半双工或稍后重试',
        ),
      );
    }
  }

  private resetStreamFailures(callId: string): void {
    this.streamFailureCounts.delete(callId);
  }

  private createTurnContext(): CallTurnContext {
    return {
      sentenceBuffer: new DeltaSentenceBuffer(),
      ttsStream: null,
      audioSeq: 0,
      speakingStarted: false,
      streamMode: 'ws',
      assistantText: '',
    };
  }

  private clearTurnContext(callId: string): void {
    const ctx = this.turnContexts.get(callId);
    if (ctx?.ttsStream) {
      ctx.ttsStream.abort();
    }
    this.turnContexts.delete(callId);
  }

  private emitAudioChunk(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    audio: ArrayBuffer,
    mime: string,
  ): void {
    const seq = ctx.audioSeq;
    ctx.audioSeq += 1;
    if (!ctx.speakingStarted) {
      ctx.speakingStarted = true;
      record.state = 'speaking';
      this.host.broadcast(ev.callState(record.callId, 'speaking'));
    }
    this.host.broadcast(ev.callAudioChunk(record.callId, audio, seq, mime));
  }

  private async ensureTtsStream(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    options: TtsOptions,
  ): Promise<void> {
    if (ctx.streamMode !== 'ws' || ctx.ttsStream) return;

    try {
      ctx.ttsStream = await createTtsStreamSession(options, {
        onAudioChunk: (audio) => {
          this.emitAudioChunk(record, ctx, audio, 'audio/mpeg');
        },
        onError: () => {
          ctx.ttsStream?.abort();
          ctx.ttsStream = null;
          if (!ctx.speakingStarted) {
            ctx.streamMode = 'rest-fallback';
            this.noteStreamFailure(record.callId);
          }
        },
      });
    } catch {
      ctx.streamMode = 'rest-fallback';
      this.noteStreamFailure(record.callId);
    }
  }

  private async pushSentences(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    sentences: string[],
    options: TtsOptions | null,
  ): Promise<void> {
    if (sentences.length === 0) return;
    if (ctx.streamMode === 'rest-fallback' || !options) return;

    await this.ensureTtsStream(record, ctx, options);
    if (!ctx.ttsStream) return;

    for (const sentence of sentences) {
      await ctx.ttsStream.pushText(sentence);
    }
  }

  private async finalizeAssistantSpeech(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    options: TtsOptions | null,
  ): Promise<void> {
    const finalText = ctx.assistantText.trim();
    if (!finalText || !hasSpeakableDialogue(finalText)) {
      record.state = 'listening';
      this.host.broadcast(ev.callState(record.callId, 'listening'));
      return;
    }

    this.host.broadcast(ev.callTranscript(record.callId, 'assistant', finalText, true));

    if (ctx.streamMode === 'rest-fallback' || !options) {
      try {
        const result = await synthesizeVoiceChunk(finalText);
        this.emitAudioChunk(record, ctx, result.audio, result.mime);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record.state = 'listening';
        this.host.broadcast(ev.callState(record.callId, 'listening'));
        this.host.broadcast(ev.callError(record.callId, message));
        return;
      }
      this.host.broadcast(ev.callSpeechEnd(record.callId));
      return;
    }

    const tail = ctx.sentenceBuffer.flush();
    await this.pushSentences(record, ctx, tail, options);

    if (ctx.ttsStream) {
      try {
        await ctx.ttsStream.finish();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!ctx.speakingStarted) {
          record.state = 'listening';
          this.host.broadcast(ev.callState(record.callId, 'listening'));
          this.host.broadcast(ev.callError(record.callId, message));
          return;
        }
      }
    }

    if (!ctx.speakingStarted) {
      record.state = 'listening';
      this.host.broadcast(ev.callState(record.callId, 'listening'));
    }

    this.host.broadcast(ev.callSpeechEnd(record.callId));
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
    let terminalError: string | null = null;
    const turn = this.createTurnContext();
    this.turnContexts.set(callId, turn);
    const ttsOptions = buildTtsOptions();

    const persistTranscript = getVoiceSettings().callPersistTranscript;

    try {
      for await (const agEvent of runOrchestrator(trimmed, record.sessionId, controller.signal, {
        persistMessages: persistTranscript,
      })) {
        if (controller.signal.aborted) break;

        if (agEvent.type === 'run_started') {
          runId = agEvent.runId;
          setSessionRunId(record.sessionId, agEvent.runId);
        }

        if (agEvent.type === 'text_delta') {
          turn.assistantText += agEvent.delta;
          this.host.broadcast(
            ev.callTranscript(callId, 'assistant', turn.assistantText, false),
          );
          const sentences = turn.sentenceBuffer.append(agEvent.delta);
          await this.pushSentences(record, turn, sentences, ttsOptions);
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
          await this.finalizeAssistantSpeech(record, turn, ttsOptions);
          this.resetStreamFailures(callId);
          this.host.onRunFinished({ recordAffection: persistTranscript });
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
      this.clearTurnContext(callId);
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

  interrupt(callId: string): CallSessionResult {
    const record = this.sessions.get(callId);
    if (!record) {
      return { ok: false, error: '通话不存在' };
    }
    if (record.state === 'idle') {
      return { ok: false, error: '通话已结束' };
    }

    const activeRun = getSessionRun(record.sessionId);
    if (activeRun) {
      activeRun.controller.abort();
      this.host.onRunError();
      releaseSessionRun(record.sessionId);
    }

    this.clearTurnContext(callId);
    record.state = 'listening';
    this.host.broadcast(ev.callState(callId, 'listening'));
    return { ok: true };
  }

  end(callId: string): CallSessionResult {
    const record = this.sessions.get(callId);
    if (!record) {
      return { ok: false, error: '通话不存在' };
    }

    this.clearTurnContext(callId);

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
    this.streamFailureCounts.delete(callId);
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
