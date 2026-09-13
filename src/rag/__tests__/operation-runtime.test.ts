import { afterEach, describe, expect, it } from 'vitest';
import { AbortSignalError } from '../../agent/abort';
import {
  resetRagOperationRuntimeForTest,
  shutdownRagOperations,
  trackRagOperation,
} from '../operation-runtime';

describe('RAG operation runtime', () => {
  afterEach(() => {
    resetRagOperationRuntimeForTest();
  });

  it('aborts and waits for active operations during shutdown', async () => {
    let observedAbort = false;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operation = trackRagOperation(async (signal) => {
      markStarted();
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(new AbortSignalError());
        }, { once: true });
      });
    });
    await started;

    await expect(shutdownRagOperations(100)).resolves.toBe(true);
    await expect(operation).rejects.toThrow('已取消');
    expect(observedAbort).toBe(true);
    await expect(trackRagOperation(async () => undefined)).rejects.toThrow('已取消');
  });

  it('cancels only the operation owned by a destroyed caller signal', async () => {
    const caller = new AbortController();
    const operation = trackRagOperation(async (signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new AbortSignalError()), { once: true });
    }), caller.signal);

    caller.abort();

    await expect(operation).rejects.toThrow('已取消');
    await expect(trackRagOperation(async () => 'next')).resolves.toBe('next');
  });
});
