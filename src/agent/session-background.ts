const pendingBySession = new Map<string, Promise<unknown>>();

function trackSessionWork<T>(sessionId: string, work: Promise<T>): Promise<T> {
  const tracked = work.finally(() => {
    if (pendingBySession.get(sessionId) === tracked) {
      pendingBySession.delete(sessionId);
    }
  });
  pendingBySession.set(sessionId, tracked);
  return tracked;
}

/** 等待同一会话的后台任务（压缩、记忆提取）完成，避免与下一条消息竞态。 */
export async function awaitPendingSessionWork(
  sessionId: string,
  timeoutMs = 5000,
): Promise<void> {
  const pending = pendingBySession.get(sessionId);
  if (!pending) return;

  await Promise.race([
    pending.catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

export function scheduleSessionCompress(
  sessionId: string,
  work: () => Promise<boolean>,
): void {
  trackSessionWork(sessionId, work());
}

export function scheduleMemoryExtract(
  sessionId: string,
  work: () => Promise<number>,
): void {
  trackSessionWork(sessionId, work());
}
