import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortAllPendingSessionWork,
  awaitPendingSessionWork,
  scheduleMemoryExtract,
  scheduleSessionCompress,
  shutdownPendingSessionWork,
} from '../session-background';
import {
  clearRunDiagnosticsForTests,
  createRunTelemetry,
  getRunDiagnostic,
} from '../run-observability';

describe('session background work', () => {
  afterEach(() => {
    abortAllPendingSessionWork();
    clearRunDiagnosticsForTests();
    vi.useRealTimers();
  });

  it('aborts a background task after its timeout', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    scheduleMemoryExtract('background-timeout', (signal) => {
      receivedSignal = signal;
      return new Promise<number>((resolve) => {
        signal.addEventListener('abort', () => resolve(0), { once: true });
      });
    });

    expect(receivedSignal?.aborted).toBe(false);
    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();

    expect(receivedSignal?.aborted).toBe(true);
    await awaitPendingSessionWork('background-timeout', 0);
  });

  it('cancels all pending session work during shutdown', async () => {
    let receivedSignal: AbortSignal | undefined;
    scheduleMemoryExtract('background-shutdown', (signal) => {
      receivedSignal = signal;
      return new Promise<number>((resolve) => {
        signal.addEventListener('abort', () => resolve(0), { once: true });
      });
    });

    abortAllPendingSessionWork();

    expect(receivedSignal?.aborted).toBe(true);
    await awaitPendingSessionWork('background-shutdown', 0);
  });

  it('waits for cancelled background work to settle during shutdown', async () => {
    let settled = false;
    scheduleMemoryExtract('background-shutdown-wait', (signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        queueMicrotask(() => {
          settled = true;
          resolve(0);
        });
      }, { once: true });
    }));

    await expect(shutdownPendingSessionWork(1000)).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it('waits for the underlying work even when its abort wrapper settles first', async () => {
    let releaseWork: ((value: number) => void) | undefined;
    scheduleMemoryExtract('background-non-cooperative', () => new Promise((resolve) => {
      releaseWork = resolve;
    }));

    let shutdownFinished = false;
    const shutdown = shutdownPendingSessionWork(1000).then((idle) => {
      shutdownFinished = true;
      return idle;
    });
    await Promise.resolve();

    expect(shutdownFinished).toBe(false);
    releaseWork?.(0);
    await expect(shutdown).resolves.toBe(true);
  });

  it('stops waiting for session work when the run is cancelled', async () => {
    let resolveWork: ((value: number) => void) | undefined;
    scheduleMemoryExtract('background-wait-cancel', () => new Promise((resolve) => {
      resolveWork = resolve;
    }));

    const controller = new AbortController();
    const waiting = awaitPendingSessionWork('background-wait-cancel', 60_000, controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ message: '已取消' });
    resolveWork?.(0);
    await awaitPendingSessionWork('background-wait-cancel', 0);
  });

  it('serializes compression and memory extraction for one session', async () => {
    const order: string[] = [];
    let releaseCompression: ((value: boolean) => void) | undefined;
    scheduleSessionCompress('background-serial', () => {
      order.push('compress:start');
      return new Promise((resolve) => {
        releaseCompression = resolve;
      });
    });
    scheduleMemoryExtract('background-serial', async () => {
      order.push('memory:start');
      return 1;
    });

    expect(order).toEqual(['compress:start']);
    releaseCompression?.(true);
    await awaitPendingSessionWork('background-serial', 1000);

    expect(order).toEqual(['compress:start', 'memory:start']);
  });

  it('appends background outcomes to the originating run diagnostic', async () => {
    const telemetry = createRunTelemetry({
      runId: 'run-background',
      sessionId: 'background-diagnostic',
      logger: vi.fn(),
    });
    telemetry.finish('finished', 'finished');

    scheduleMemoryExtract('background-diagnostic', async () => 1, 'run-background');
    await awaitPendingSessionWork('background-diagnostic', 1000);

    expect(getRunDiagnostic('run-background')?.activities).toContainEqual({
      stage: 'background',
      status: 'succeeded',
      name: 'memory_extract',
      durationMs: expect.any(Number),
      attempts: 1,
    });
  });
});
