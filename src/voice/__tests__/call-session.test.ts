import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ev } from '../../agent/events';
import { createCallSessionManager, resetCallSessionManager } from '../call-session';

const runOrchestrator = vi.fn();

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

async function* mockRun(events: Array<{ type: string; [key: string]: unknown }>) {
  for (const event of events) {
    yield event;
  }
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

  it('submitUserText transitions listening → thinking → speaking → listening via speakingDone', async () => {
    runOrchestrator.mockReturnValue(
      mockRun([
        { type: 'run_started', runId: 'run-1', sessionId: 'session-1' },
        { type: 'text_delta', runId: 'run-1', delta: '你好' },
        { type: 'run_finished', runId: 'run-1' },
      ]),
    );

    const manager = createCallSessionManager(host);
    const started = manager.start('session-1');
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const submit = await manager.submitUserText(started.callId, '听得到吗');
    expect(submit.ok).toBe(true);
    expect(manager.get(started.callId)?.state).toBe('speaking');
    expect(broadcast).toHaveBeenCalledWith(
      ev.callTranscript(started.callId, 'assistant', '你好', true),
    );

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
        { type: 'text_delta', runId: 'run-3', delta: '回复' },
        { type: 'run_finished', runId: 'run-3' },
      ]),
    );

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
});
