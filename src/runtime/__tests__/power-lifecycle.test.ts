import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPowerLifecycle } from '../power-lifecycle';

afterEach(() => vi.useRealTimers());

describe('power lifecycle', () => {
  it('stops on suspend and coalesces resume plus unlock into one reconciliation', async () => {
    vi.useFakeTimers();
    const source = new EventEmitter();
    const suspend = vi.fn();
    const resume = vi.fn();
    const dispose = bindPowerLifecycle(source, { suspend, resume }, 500);

    source.emit('suspend');
    source.emit('resume');
    source.emit('unlock-screen');
    expect(suspend).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(resume).toHaveBeenCalledOnce();
    dispose();
    expect(source.eventNames()).toEqual([]);
  });

  it('cancels a pending resume when disposed', async () => {
    vi.useFakeTimers();
    const source = new EventEmitter();
    const resume = vi.fn();
    const dispose = bindPowerLifecycle(source, { suspend: vi.fn(), resume }, 500);

    source.emit('resume');
    dispose();
    await vi.runAllTimersAsync();

    expect(resume).not.toHaveBeenCalled();
  });
});
