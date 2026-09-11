import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRetryableEmbeddingError,
  retryEmbeddingOperation,
} from '../embedding-retry';

describe('embedding retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient failures with bounded exponential backoff', async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Embeddings API 429: busy'))
      .mockRejectedValueOnce(new Error('Embedding 请求超时'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    const pending = retryEmbeddingOperation(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      onRetry,
    });
    await vi.advanceTimersByTimeAsync(30);

    await expect(pending).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry configuration or permission failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Embeddings API 403: forbidden'));

    await expect(
      retryEmbeddingOperation(operation, { maxAttempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow('403');
    expect(operation).toHaveBeenCalledOnce();
    expect(isRetryableEmbeddingError(new Error('Embeddings API 500: unavailable'))).toBe(true);
  });

  it('stops retry backoff immediately when cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new Error('Embeddings API 503: unavailable'));
    const pending = retryEmbeddingOperation(operation, {
      signal: controller.signal,
      maxAttempts: 3,
      baseDelayMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(pending).rejects.toThrow('已取消');
    expect(operation).toHaveBeenCalledOnce();
  });
});
