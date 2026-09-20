import { describe, expect, it, vi } from 'vitest';
import { installSingleInstanceGuard } from '../single-instance';

describe('single instance guard', () => {
  it('keeps the primary process and reveals its window when another instance starts', () => {
    let secondInstanceHandler: (() => void) | null = null;
    const quit = vi.fn();
    const reveal = vi.fn();
    const installed = installSingleInstanceGuard({
      requestLock: () => true,
      onSecondInstance: (handler) => { secondInstanceHandler = handler; },
      quit,
    }, reveal);

    expect(installed).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    expect(secondInstanceHandler).not.toBeNull();
    (secondInstanceHandler as (() => void) | null)?.();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('quits a secondary process without registering runtime work', () => {
    const onSecondInstance = vi.fn();
    const quit = vi.fn();
    const installed = installSingleInstanceGuard({
      requestLock: () => false,
      onSecondInstance,
      quit,
    }, vi.fn());

    expect(installed).toBe(false);
    expect(quit).toHaveBeenCalledOnce();
    expect(onSecondInstance).not.toHaveBeenCalled();
  });
});
