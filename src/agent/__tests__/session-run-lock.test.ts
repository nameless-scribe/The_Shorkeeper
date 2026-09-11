import { describe, expect, it } from 'vitest';
import {
  acquireSessionRun,
  abortAllSessionRuns,
  awaitSessionRunsIdle,
  isSessionRunActive,
  releaseSessionRun,
} from '../session-run-lock';

describe('session-run-lock', () => {
  it('serializes runs per session', () => {
    const c1 = acquireSessionRun('s1');
    expect(c1).toBeTruthy();
    expect(acquireSessionRun('s1')).toBeNull();
    expect(acquireSessionRun('s2')).toBeTruthy();
    releaseSessionRun('s1');
    expect(acquireSessionRun('s1')).toBeTruthy();
    releaseSessionRun('s1');
    releaseSessionRun('s2');
  });

  it('does not let a stale owner release a newer run', () => {
    const first = acquireSessionRun('s-owner')!;
    expect(releaseSessionRun('s-owner', first)).toBe(true);

    const second = acquireSessionRun('s-owner')!;
    expect(releaseSessionRun('s-owner', first)).toBe(false);
    expect(isSessionRunActive('s-owner')).toBe(true);
    expect(releaseSessionRun('s-owner', second)).toBe(true);
  });

  it('waits until all foreground runs release their locks', async () => {
    const controller = acquireSessionRun('s-idle')!;
    const waiting = awaitSessionRunsIdle(1000);

    releaseSessionRun('s-idle', controller);

    await expect(waiting).resolves.toBe(true);
  });

  it('abort does not clear lock until release', () => {
    const controller = acquireSessionRun('s-abort')!;
    expect(isSessionRunActive('s-abort')).toBe(true);
    const cancelled = abortAllSessionRuns();
    expect(cancelled.some((c) => c.sessionId === 's-abort')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(isSessionRunActive('s-abort')).toBe(true);
    releaseSessionRun('s-abort');
    expect(isSessionRunActive('s-abort')).toBe(false);
  });
});
