import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProactivityCoordinator } from '../coordinator';

describe('P3.1 proactivity coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges signals inside the debounce window into one bounded cycle', async () => {
    const run = vi.fn(async () => undefined);
    const coordinator = createProactivityCoordinator({ run, debounceMs: 100, startupDelayMs: 10_000, sweepIntervalMs: 60_000, deferredCheckMs: 60_000 });
    coordinator.signal('task');
    coordinator.signal('task');
    coordinator.signal('commitment');
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(1);
    const [domains, trigger] = run.mock.calls[0] as unknown as [Set<string>, string];
    expect([...domains].sort()).toEqual(['commitment', 'task']);
    expect(trigger).toBe('signal');
    await coordinator.stop();
  });

  it('runs one cycle at a time and replays signals that arrive mid-cycle', async () => {
    let release: (() => void) | null = null;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const coordinator = createProactivityCoordinator({ run, debounceMs: 0, startupDelayMs: 10_000, sweepIntervalMs: 60_000, deferredCheckMs: 60_000 });
    coordinator.signal('task');
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.isRunning()).toBe(true);
    coordinator.signal('memory');
    await vi.advanceTimersByTimeAsync(5);
    expect(run).toHaveBeenCalledTimes(1);
    release!();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect([...(run.mock.calls[1] as unknown as [Set<string>])[0]]).toEqual(['memory']);
    release!();
    await coordinator.stop();
  });

  it('delays the startup reconcile, sweeps on an interval, and lets wake escalate to a full cycle', async () => {
    const run = vi.fn(async () => undefined);
    const coordinator = createProactivityCoordinator({ run, debounceMs: 0, startupDelayMs: 500, sweepIntervalMs: 2_000, deferredCheckMs: 10_000 });
    coordinator.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual([null, 'startup']);
    coordinator.signal('task');
    coordinator.wake();
    await vi.advanceTimersByTimeAsync(5);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.slice(0, 2)).toEqual([null, 'wake']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run.mock.calls.at(-1)?.slice(0, 2)).toEqual([null, 'sweep']);
    await coordinator.stop();
  });

  it('stops cleanly: cancels timers, resolves waiters, and ignores late signals', async () => {
    const run = vi.fn(async () => undefined);
    const coordinator = createProactivityCoordinator({ run, debounceMs: 50, startupDelayMs: 100, sweepIntervalMs: 200, deferredCheckMs: 200 });
    coordinator.start();
    const pending = coordinator.requestFullCycle('manual');
    await coordinator.stop();
    await pending;
    coordinator.signal('task');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.isStopped()).toBe(true);
  });

  it('reports errors without breaking the loop', async () => {
    const errors: unknown[] = [];
    const run = vi.fn(async () => { throw new Error('boom'); });
    const coordinator = createProactivityCoordinator({ run, debounceMs: 0, startupDelayMs: 10_000, sweepIntervalMs: 60_000, deferredCheckMs: 60_000, onError: (error) => errors.push(error) });
    const pending = coordinator.requestFullCycle('manual');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(errors).toHaveLength(1);
    coordinator.signal('task');
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await coordinator.stop();
  });

  it('aborts the active cycle during shutdown and does not report cancellation as an error', async () => {
    const errors: unknown[] = [];
    const run = vi.fn((_domains, _trigger, signal: AbortSignal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const coordinator = createProactivityCoordinator({
      run,
      debounceMs: 0,
      startupDelayMs: 10_000,
      sweepIntervalMs: 60_000,
      deferredCheckMs: 60_000,
      onError: (error) => errors.push(error),
    });

    const pending = coordinator.requestFullCycle('manual');
    await vi.advanceTimersByTimeAsync(1);
    const signal = run.mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    await coordinator.stop(100);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(coordinator.isRunning()).toBe(false);
    expect(errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
