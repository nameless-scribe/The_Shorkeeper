export class AbortSignalError extends Error {
  constructor() {
    super('已取消');
    this.name = 'AbortSignalError';
  }
}

export interface LinkedTimeoutSignal {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
}

/** 将父级取消和本地超时合并，确保底层 fetch / 工具能收到同一个 abort。 */
export function createLinkedTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): LinkedTimeoutSignal {
  const controller = new AbortController();
  let timedOut = false;
  let disposed = false;

  const onParentAbort = () => controller.abort();
  if (parent?.aborted) {
    controller.abort();
  } else if (parent) {
    parent.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    if (disposed) return;
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** 在底层操作不主动响应 abort 时，也让当前 run 及时结束等待。 */
export function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortSignalError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AbortSignalError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
