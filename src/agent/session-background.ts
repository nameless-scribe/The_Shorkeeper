import { AbortSignalError, awaitWithAbort } from './abort';
import { appendRunDiagnosticActivity } from './run-observability';
import { classifyRunError } from './run-errors';

const DEFAULT_BACKGROUND_TASK_TIMEOUT_MS = 60_000;
export const BACKGROUND_TASK_MAX_ATTEMPTS = 1;

interface PendingSessionTask {
  sessionId: string;
  taskName: 'session_compress' | 'memory_extract';
  runId?: string;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  promise: Promise<unknown>;
  underlyingPromise?: Promise<unknown>;
}

const pendingBySession = new Map<string, Promise<unknown>>();
const pendingTasks = new Set<PendingSessionTask>();

function recordBackgroundActivity(
  task: PendingSessionTask,
  status: 'succeeded' | 'failed' | 'cancelled',
  durationMs: number,
  errorMessage?: string,
  result?: unknown,
): void {
  const reason = result && typeof result === 'object' && 'reason' in result &&
    typeof result.reason === 'string' && /^[a-z0-9_:-]{1,64}$/i.test(result.reason)
    ? result.reason
    : undefined;
  const activity = {
    stage: 'background' as const,
    status,
    name: task.taskName,
    durationMs,
    attempts: BACKGROUND_TASK_MAX_ATTEMPTS,
    ...(reason ? { reason } : {}),
    ...(status === 'failed' && errorMessage
      ? { errorCategory: classifyRunError(errorMessage) }
      : {}),
  };

  if (task.runId) appendRunDiagnosticActivity(task.runId, activity);
  console.info('[agent.background]', JSON.stringify({
    runId: task.runId ?? 'unknown',
    sessionId: task.sessionId,
    ...activity,
  }));
}

function trackSessionWork<T>(
  sessionId: string,
  taskName: PendingSessionTask['taskName'],
  work: (signal: AbortSignal) => Promise<T>,
  runId?: string,
  timeoutMs = DEFAULT_BACKGROUND_TASK_TIMEOUT_MS,
): Promise<T> {
  const previous = pendingBySession.get(sessionId);
  const controller = new AbortController();
  let startedAt: number | undefined;
  let timedOut = false;
  const task: PendingSessionTask = {
    sessionId,
    taskName,
    runId,
    controller,
    promise: Promise.resolve(),
  };

  const start = (): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(new AbortSignalError());
    startedAt = Date.now();
    task.timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let workResult: Promise<T>;
    try {
      workResult = work(controller.signal);
    } catch (error) {
      workResult = Promise.reject(error);
    }
    task.underlyingPromise = workResult
      .then(() => undefined, () => undefined)
      .finally(() => {
        pendingTasks.delete(task);
      });
    return awaitWithAbort(workResult, controller.signal);
  };

  const workResult = previous
    ? previous.catch(() => undefined).then(start)
    : start();

  let tracked: Promise<T>;
  tracked = workResult
    .then((value) => {
      recordBackgroundActivity(
        task,
        'succeeded',
        startedAt ? Date.now() - startedAt : 0,
        undefined,
        value,
      );
      return value;
    })
    .catch((error) => {
      const status = timedOut ? 'failed' : controller.signal.aborted ? 'cancelled' : 'failed';
      const message = timedOut
        ? '后台任务超时'
        : controller.signal.aborted
          ? '已取消'
          : error instanceof Error
            ? error.message
            : String(error);
      recordBackgroundActivity(task, status, startedAt ? Date.now() - startedAt : 0, message);
      throw error;
    })
    .finally(() => {
      if (task.timer) clearTimeout(task.timer);
      if (!task.underlyingPromise) pendingTasks.delete(task);
      if (pendingBySession.get(sessionId) === tracked) {
        pendingBySession.delete(sessionId);
      }
    });

  task.promise = tracked;
  pendingTasks.add(task);
  pendingBySession.set(sessionId, tracked);
  void tracked.catch(() => undefined);
  return tracked;
}

/** 等待同一会话的后台任务（压缩、记忆提取）完成，避免与下一条消息竞态。 */
export async function awaitPendingSessionWork(
  sessionId: string,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<void> {
  const pending = pendingBySession.get(sessionId);
  if (!pending) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = Promise.race([
    pending.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);

  try {
    if (signal) {
      await awaitWithAbort(wait, signal);
    } else {
      await wait;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function scheduleSessionCompress(
  sessionId: string,
  work: (signal: AbortSignal) => Promise<unknown>,
  runId?: string,
): void {
  void trackSessionWork(sessionId, 'session_compress', work, runId);
}

export function scheduleMemoryExtract(
  sessionId: string,
  work: (signal: AbortSignal) => Promise<number>,
  runId?: string,
): void {
  void trackSessionWork(sessionId, 'memory_extract', work, runId);
}

export function abortAllPendingSessionWork(): void {
  for (const task of pendingTasks) {
    if (task.timer) clearTimeout(task.timer);
    task.controller.abort();
  }
}

export async function shutdownPendingSessionWork(timeoutMs = 5000): Promise<boolean> {
  abortAllPendingSessionWork();
  const tasks = [...pendingTasks].map((task) =>
    (task.underlyingPromise ?? task.promise).catch(() => undefined),
  );
  if (tasks.length === 0) return true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(tasks).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
