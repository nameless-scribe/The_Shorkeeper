const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 2_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface ModelFetchOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('已取消', 'AbortError');
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getRetryDelay(response: Response, fallbackMs: number): number {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return fallbackMs;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1000));
  }

  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAt - Date.now()));
  }
  return fallbackMs;
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response may already be closed by the runtime.
  }
}

/** Retry only before a response stream is consumed, so emitted model output is never duplicated. */
export async function fetchModelResponse(
  input: string | URL,
  init: RequestInit,
  options?: ModelFetchOptions,
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const baseDelay = Math.max(0, options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const signal = init.signal ?? undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw abortError(signal);

    try {
      const response = await fetch(input, init);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
        return response;
      }

      const delay = getRetryDelay(response, Math.min(MAX_RETRY_DELAY_MS, baseDelay * attempt));
      await discardResponse(response);
      await waitForRetry(delay, signal);
    } catch (error) {
      if (signal?.aborted || attempt === attempts) throw error;
      lastError = error;
      await waitForRetry(Math.min(MAX_RETRY_DELAY_MS, baseDelay * attempt), signal);
    }
  }

  throw lastError ?? new Error('模型服务请求失败');
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return '请求参数无效';
    case 401:
      return 'API Key 无效或已过期';
    case 403:
      return '当前 API Key 无权访问该模型';
    case 404:
      return '服务地址或模型不存在';
    case 408:
      return '服务响应超时';
    case 413:
      return '输入内容超过服务限制';
    case 429:
      return '请求过于频繁或额度不足，请稍后重试';
    case 500:
    case 502:
    case 503:
    case 504:
      return '模型服务暂时不可用，请稍后重试';
    default:
      return '模型服务返回错误';
  }
}

/** Do not expose an upstream response body: it may contain echoed prompts or provider secrets. */
export async function createModelHttpError(response: Response): Promise<Error> {
  const requestId = response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    response.headers.get('cf-ray');
  await discardResponse(response);
  const safeRequestId = requestId?.replace(/[\r\n]/g, '').slice(0, 128);
  return new Error(
    `模型 API ${response.status}：${statusMessage(response.status)}` +
      (safeRequestId ? `（请求编号：${safeRequestId}）` : ''),
  );
}
