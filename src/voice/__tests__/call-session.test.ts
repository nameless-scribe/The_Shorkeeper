import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ev } from '../../agent/events';
import { createCallSessionManager, resetCallSessionManager } from '../call-session';

const runOrchestrator = vi.fn();
const createTtsStreamSession = vi.fn();
const synthesizeVoiceChunk = vi.fn();

vi.mock('../../agent/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => runOrchestrator(...args),
}));

vi.mock('../../agent/resolve-session', () => ({
  resolveAgentSession: (sessionId?: string) =>
    sessionId ? { id: sessionId } : { id: 'active-session' },
}));

vi.mock('../../models/config', () => ({
  getModelConfigSafe: () => null,
}));

vi.mock('../../db/token-usage', () => ({
  recordTokenUsage: vi.fn(),
}));

vi.mock('../../config/voice', () => ({
  getVoiceSettings: () => ({
    ttsEnabled: true,
    ttsVoiceId: 'voice-1',
    ttsModel: 'cosyvoice-v3.5-plus',
    ttsRate: 1,
    ttsVolume: 100,
    sttLanguage: 'zh',
    callPersistTranscript: true,
  }),
}));

vi.mock('../tts-engine', () => ({
  createTtsStreamSession: (...args: unknown[]) => createTtsStreamSession(...args),
}));

vi.mock('../synthesize-chunk', () => ({
  synthesizeVoiceChunk: (...args: unknown[]) => synthesizeVoiceChunk(...args),
}));

async function* mockRun(events: Array<{ type: string; [key: string]: unknown }>) {
  for (const event of events) {
    yield event;
  }
}

function mockTtsStream(options?: {
  onAudioChunk?: (audio: ArrayBuffer, seq: number) => void;
  pushText?: ReturnType<typeof vi.fn>;
}) {
  const pushText = options?.pushText ?? vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn();
  return {
    pushText,
    finish,
    abort,
    handlers: null as {
      onAudioChunk: (audio: ArrayBuffer, seq: number) => void;
      onError: (message: string) => void;
    } | null,
    triggerChunk(audio: ArrayBuffer, seq = 0) {
      this.handlers?.onAudioChunk(audio, seq);
    },
  };
}

describe('call-session', () => {
  const broadcast = vi.fn();
  const host = {
    broadcast,
    onRunStarted: vi.fn(),
    onRunFinished: vi.fn(),
    onRunError: vi.fn(),
  };

  beforeEach(() => {
    resetCallSessionManager();
    vi.clearAllMocks();
    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const stream = mockTtsStream();
      stream.handlers = handlers;
      return stream;
    });
  });

  it('start enters listening and returns callId', () => {
    const manager = createCallSessionManager(host);
    const result = manager.start('session-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.callId).toBeTruthy();
    expect(manager.get(result.callId)?.state).toBe('listening');
    expect(broadcast).toHaveBeenCalledWith(ev.callState(result.callId, 'listening'));
  });

  it('submitUserText streams deltas into TTS and broadcasts audio chunks', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-1', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-1', delta: '你好。' },
        { type: 'run_finished', runId: 'run-1' },
      ]),
    );

    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const stream = mockTtsStream({
        pushText: vi.fn().mockImplementation(async () => {
          handlers.onAudioChunk(new Uint8Array([1, 2, 3]).buffer, 0);
        }),
      });
      stream.handlers = handlers;
      return stream;
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await manager.submitUserText(started.callId, '听得到吗');

    const stream = await createTtsStreamSession.mock.results[0]?.value;
    expect(stream.pushText).toHaveBeenCalledWith('你好。');
    expect(stream.finish).toHaveBeenCalled();
    expect(manager.get(started.callId)?.state).toBe('speaking');
    expect(broadcast).toHaveBeenCalledWith(
      ev.callTranscript(started.callId, 'assistant', '你好。', true),
    );
    expect(broadcast).toHaveBeenCalledWith(ev.callSpeechEnd(started.callId));
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_audio_chunk',
        callId: started.callId,
        seq: 0,
      }),
    );
  });

  it('submitUserText falls back to REST when TTS stream fails before audio', async () => {
    createTtsStreamSession.mockRejectedValue(new Error('ws down'));
    synthesizeVoiceChunk.mockResolvedValue({
      audio: new Uint8Array([9]).buffer,
      mime: 'audio/mpeg',
    });

    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-1', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-1', delta: '你好。' },
        { type: 'run_finished', runId: 'run-1' },
      ]),
    );

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    await manager.submitUserText(started.callId, '测试');

    expect(synthesizeVoiceChunk).toHaveBeenCalledWith('你好。');
    expect(broadcast).toHaveBeenCalledWith(ev.callSpeechEnd(started.callId));
  });

  it('speakingDone returns to listening', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-1', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-1', delta: '你好。' },
        { type: 'run_finished', runId: 'run-1' },
      ]),
    );

    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const s = mockTtsStream({
        pushText: vi.fn().mockImplementation(async () => {
          handlers.onAudioChunk(new Uint8Array([1]).buffer, 0);
        }),
      });
      s.handlers = handlers;
      return s;
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    await manager.submitUserText(started.callId, '第一句');

    const done = manager.speakingDone(started.callId);
    expect(done.ok).toBe(true);
    expect(manager.get(started.callId)?.state).toBe('listening');
  });

  it('end aborts active run and clears session', async () => {
    let abortSignal: AbortSignal | undefined;
    runOrchestrator.mockImplementation(async function* (_text, _sessionId, signal) {
      abortSignal = signal;
      yield { type: 'run_started', runId: 'run-2', sessionId: 'session-1' };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: 'text_delta', runId: 'run-2', delta: '…' };
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    const pending = manager.submitUserText(started.callId, '等等');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(abortSignal?.aborted).toBe(false);

    const ended = manager.end(started.callId);
    expect(ended.ok).toBe(true);
    expect(abortSignal?.aborted).toBe(true);
    expect(manager.get(started.callId)).toBeUndefined();

    await pending;
  });

  it('rejects user text when not listening', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-3', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-3', delta: '回复。' },
        { type: 'run_finished', runId: 'run-3' },
      ]),
    );

    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const s = mockTtsStream({
        pushText: vi.fn().mockImplementation(async () => {
          handlers.onAudioChunk(new Uint8Array([1]).buffer, 0);
        }),
      });
      s.handlers = handlers;
      return s;
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    await manager.submitUserText(started.callId, '第一句');
    expect(manager.get(started.callId)?.state).toBe('speaking');

    const second = await manager.submitUserText(started.callId, '第二句');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain('无法接收');
  });

  it('interrupt during thinking aborts orchestrator and returns to listening', async () => {
    let abortSignal: AbortSignal | undefined;
    runOrchestrator.mockImplementation(async function* (_text, _sessionId, signal) {
      abortSignal = signal;
      yield { type: 'run_started', runId: 'run-int', sessionId: 'session-1' };
      await new Promise((resolve) => setTimeout(resolve, 100));
      yield { type: 'text_delta', runId: 'run-int', delta: '还在想' };
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    const pending = manager.submitUserText(started.callId, '等等');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.get(started.callId)?.state).toBe('thinking');

    const interrupted = manager.interrupt(started.callId);
    expect(interrupted.ok).toBe(true);
    expect(abortSignal?.aborted).toBe(true);
    expect(manager.get(started.callId)?.state).toBe('listening');

    await pending;
  });

  it('interrupt during speaking keeps session and returns to listening', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-4', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-4', delta: '长回复。' },
        { type: 'run_finished', runId: 'run-4' },
      ]),
    );

    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const s = mockTtsStream({
        pushText: vi.fn().mockImplementation(async () => {
          handlers.onAudioChunk(new Uint8Array([1]).buffer, 0);
        }),
      });
      s.handlers = handlers;
      return s;
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    await manager.submitUserText(started.callId, '你好');
    expect(manager.get(started.callId)?.state).toBe('speaking');

    const interrupted = manager.interrupt(started.callId);
    expect(interrupted.ok).toBe(true);
    expect(manager.get(started.callId)?.state).toBe('listening');
    expect(manager.get(started.callId)).toBeDefined();
  });

  it('allows user text after interrupt', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-5', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-5', delta: '第一句。' },
        { type: 'run_finished', runId: 'run-5' },
      ]),
    );

    createTtsStreamSession.mockImplementation(async (_opts, handlers) => {
      const s = mockTtsStream({
        pushText: vi.fn().mockImplementation(async () => {
          handlers.onAudioChunk(new Uint8Array([1]).buffer, 0);
        }),
      });
      s.handlers = handlers;
      return s;
    });

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    if (!started.ok) throw new Error('start failed');

    await manager.submitUserText(started.callId, '第一句');
    manager.interrupt(started.callId);

    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-6', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-6', delta: '第二句。' },
        { type: 'run_finished', runId: 'run-6' },
      ]),
    );

    const second = await manager.submitUserText(started.callId, '第二句');
    expect(second.ok).toBe(true);
    expect(manager.get(started.callId)?.state).toBe('speaking');
  });
});
