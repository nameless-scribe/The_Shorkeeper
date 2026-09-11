export const DEFAULT_EMBEDDING_RETRY_ATTEMPTS = 3;
export const DEFAULT_EMBEDDING_RETRY_DELAY_MS = 250;

export interface EmbeddingRetryEvent {
  attempt: number;
  maxAttempts: number;
  error: string;
}

export interface EmbeddingRetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (event: EmbeddingRetryEvent) => void;
}

export function isRetryableEmbeddingError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/已取消|abort/i.test(message)) return false;
  return /请求超时|\b(?:408|409|425|429|5\d\d)\b|fetch failed|network|econn|etimedout|socket/i.test(
    message,
  );
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('已取消'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryEmbeddingOperation<T>(
  operation: () => Promise<T>,
  options: EmbeddingRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_EMBEDDING_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_EMBEDDING_RETRY_DELAY_MS);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw new Error('已取消');
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableEmbeddingError(error)) throw error;
      options.onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
      });
      await waitForRetry(baseDelayMs * 2 ** (attempt - 1), options.signal);
    }
  }
  throw new Error('Embedding 重试状态异常');
}
