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

type StreamMode = 'ws' | 'rest-fallback' | 'disabled';

interface CallTurnContext {
  sentenceBuffer: DeltaSentenceBuffer;
  ttsStream: TtsStreamSession | null;
  audioSeq: number;
  speakingStarted: boolean;
  streamMode: StreamMode;
  assistantText: string;
  audioBytes: number;
}

const MAX_CALL_TTS_AUDIO_BYTES = 20 * 1024 * 1024;

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
  private readonly runControllers = new Map<string, AbortController>();
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
    if (this.isActive(session.id)) {
      return { ok: false, error: '该会话的通话已在进行' };
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

  private degradeTtsStream(record: CallSessionRecord, ctx: CallTurnContext): void {
    if (ctx.streamMode !== 'ws') return;
    ctx.ttsStream?.abort();
    ctx.ttsStream = null;
    ctx.streamMode = ctx.speakingStarted ? 'disabled' : 'rest-fallback';
    this.noteStreamFailure(record.callId);
  }

  private createTurnContext(): CallTurnContext {
    return {
      sentenceBuffer: new DeltaSentenceBuffer(),
      ttsStream: null,
      audioSeq: 0,
      speakingStarted: false,
      streamMode: 'ws',
      assistantText: '',
      audioBytes: 0,
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
    if (ctx.audioBytes + audio.byteLength > MAX_CALL_TTS_AUDIO_BYTES) {
      this.degradeTtsStream(record, ctx);
      this.host.broadcast(ev.callError(record.callId, '本轮合成音频超过大小限制，已停止继续接收'));
      return;
    }
    ctx.audioBytes += audio.byteLength;
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
          this.degradeTtsStream(record, ctx);
        },
      });
    } catch {
      this.degradeTtsStream(record, ctx);
    }
  }

  private async pushSentences(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    sentences: string[],
    options: TtsOptions | null,
  ): Promise<void> {
    if (sentences.length === 0) return;
    if (ctx.streamMode !== 'ws' || !options) return;

    await this.ensureTtsStream(record, ctx, options);
    if (!ctx.ttsStream) return;

    for (const sentence of sentences) {
      try {
        await ctx.ttsStream.pushText(sentence);
      } catch {
        this.degradeTtsStream(record, ctx);
        return;
      }
    }
  }

  private async finalizeAssistantSpeech(
    record: CallSessionRecord,
    ctx: CallTurnContext,
    options: TtsOptions | null,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    const finalText = ctx.assistantText.trim();
    if (!finalText || !hasSpeakableDialogue(finalText)) {
      record.state = 'listening';
      this.host.broadcast(ev.callState(record.callId, 'listening'));
      return;
    }

    this.host.broadcast(ev.callTranscript(record.callId, 'assistant', finalText, true));

    if (ctx.streamMode === 'disabled') {
      if (!ctx.speakingStarted) {
        record.state = 'listening';
        this.host.broadcast(ev.callState(record.callId, 'listening'));
      }
      this.host.broadcast(ev.callSpeechEnd(record.callId));
      return;
    }

    if (ctx.streamMode === 'rest-fallback' || !options) {
      try {
        const result = await synthesizeVoiceChunk(finalText, signal);
        if (signal.aborted || this.sessions.get(record.callId) !== record) return;
        this.emitAudioChunk(record, ctx, result.audio, result.mime);
      } catch (err) {
        if (signal.aborted) return;
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
    if (signal.aborted) return;

    if (ctx.ttsStream) {
      try {
        await ctx.ttsStream.finish();
        if (signal.aborted) return;
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
    this.runControllers.set(callId, controller);

    this.host.onRunStarted();
    let runId: string | null = null;
    let terminalError: string | null = null;
    let presenceSettled = false;
    const turn = this.createTurnContext();
    this.turnContexts.set(callId, turn);
    const ttsOptions = buildTtsOptions();

    const persistTranscript = getVoiceSettings().callPersistTranscript;

    try {
      for await (const agEvent of runOrchestrator(trimmed, record.sessionId, controller.signal, {
        persistMessages: persistTranscript,
        kind: 'voice',
        triggerRef: callId,
        // 通话里模型直接用语音提问，不弹 ask_user 窗口（P6 §9.2）
        excludeTools: ['ask_user'],
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

        if (agEvent.type === 'run_finished') {
          await this.finalizeAssistantSpeech(record, turn, ttsOptions, controller.signal);
          this.resetStreamFailures(callId);
          this.host.onRunFinished({ recordAffection: persistTranscript });
          presenceSettled = true;
        } else if (agEvent.type === 'run_error') {
          this.host.onRunError();
          presenceSettled = true;
          terminalError = agEvent.message;
        }

        this.host.broadcast(agEvent);
      }

      if (controller.signal.aborted) {
        if (this.sessions.get(callId) === record) {
          record.state = 'listening';
          this.host.broadcast(ev.callState(callId, 'listening'));
        }
        return { ok: true };
      }

      if (terminalError) {
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
        this.host.broadcast(ev.callError(callId, terminalError));
        return { ok: false, error: terminalError };
      }

      if (!presenceSettled) {
        const message = '通话运行未正常结束，请重试';
        this.host.onRunError();
        presenceSettled = true;
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
        this.host.broadcast(ev.callError(callId, message));
        return { ok: false, error: message };
      }

      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!presenceSettled) {
        this.host.onRunError();
        presenceSettled = true;
      }
      if (this.sessions.get(callId) === record) {
        if (runId) {
          this.host.broadcast(ev.runError(runId, message, record.sessionId));
        }
        record.state = 'listening';
        this.host.broadcast(ev.callState(callId, 'listening'));
        this.host.broadcast(ev.callError(callId, message));
      }
      return { ok: false, error: message };
    } finally {
      if (!presenceSettled) this.host.onRunError();
      this.clearTurnContext(callId);
      if (this.runControllers.get(callId) === controller) {
        this.runControllers.delete(callId);
      }
      releaseSessionRun(record.sessionId, controller);
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

    const controller = this.runControllers.get(callId);
    if (controller) {
      controller.abort();
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

    const controller = this.runControllers.get(callId);
    const activeRun = getSessionRun(record.sessionId);
    if (controller) {
      controller.abort();
      if (activeRun?.controller === controller && activeRun.runId) {
        this.host.broadcast(
          ev.runError(activeRun.runId, '通话已结束', record.sessionId),
        );
      }
    }

    record.state = 'idle';
    this.host.broadcast(ev.callState(callId, 'idle'));
    this.streamFailureCounts.delete(callId);
    this.sessions.delete(callId);
    return { ok: true };
  }

  endAll(): void {
    for (const callId of [...this.sessions.keys()]) {
      this.end(callId);
    }
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

export function shutdownCallSessions(): void {
  manager?.endAll();
}

export function createCallSessionManager(host: CallSessionHost): CallSessionManager {
  return new CallSessionManager(host);
}
