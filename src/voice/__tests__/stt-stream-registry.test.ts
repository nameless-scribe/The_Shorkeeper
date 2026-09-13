import { describe, expect, it, vi } from 'vitest';
import type { SttStreamSession } from '../bailian-stt';
import { SttStreamRegistry } from '../stt-stream-registry';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeSession(): SttStreamSession {
  return {
    pushPcm: vi.fn(),
    finish: vi.fn(async () => ({ text: '' })),
    abort: vi.fn(),
  };
}

describe('SttStreamRegistry', () => {
  it('aborts a stream that finishes starting after its call was ended', async () => {
    const registry = new SttStreamRegistry();
    const pending = deferred<SttStreamSession>();
    const session = fakeSession();
    const started = registry.start('call-1', () => pending.promise, () => true);

    registry.abort('call-1');
    pending.resolve(session);

    await expect(started).resolves.toBe(false);
    expect(session.abort).toHaveBeenCalledOnce();
    expect(registry.size()).toBe(0);
  });

  it('keeps only the newest of two concurrent starts', async () => {
    const registry = new SttStreamRegistry();
    const firstPending = deferred<SttStreamSession>();
    const secondPending = deferred<SttStreamSession>();
    const firstSession = fakeSession();
    const secondSession = fakeSession();

    const first = registry.start('call-1', () => firstPending.promise, () => true);
    const second = registry.start('call-1', () => secondPending.promise, () => true);
    firstPending.resolve(firstSession);
    secondPending.resolve(secondSession);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(firstSession.abort).toHaveBeenCalledOnce();
    expect(registry.get('call-1')).toBe(secondSession);
  });
});
