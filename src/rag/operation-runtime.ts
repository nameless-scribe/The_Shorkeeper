import { AbortSignalError } from '../agent/abort';

interface ActiveRagOperation {
  controller: AbortController;
  promise: Promise<unknown>;
}

const activeOperations = new Set<ActiveRagOperation>();
let shuttingDown = false;

export function trackRagOperation<T>(
  work: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (shuttingDown) return Promise.reject(new AbortSignalError());

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const entry: ActiveRagOperation = {
    controller,
    promise: Promise.resolve(),
  };
  const promise = Promise.resolve()
    .then(() => {
      if (controller.signal.aborted) throw new AbortSignalError();
      return work(controller.signal);
    })
    .finally(() => {
      parentSignal?.removeEventListener('abort', onParentAbort);
      activeOperations.delete(entry);
    });
  entry.promise = promise;
  activeOperations.add(entry);
  void promise.catch(() => undefined);
  return promise;
}

export async function shutdownRagOperations(timeoutMs = 5000): Promise<boolean> {
  shuttingDown = true;
  const operations = [...activeOperations];
  for (const operation of operations) operation.controller.abort();
  if (!operations.length) return true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(operations.map((operation) => operation.promise)).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** @internal test helper */
export function resetRagOperationRuntimeForTest(): void {
  shuttingDown = false;
  activeOperations.clear();
}
