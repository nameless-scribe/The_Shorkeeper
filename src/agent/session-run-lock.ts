export interface ActiveSessionRun {
  controller: AbortController;
  runId: string | null;
}

const sessionRuns = new Map<string, ActiveSessionRun>();
const idleWaiters = new Set<(idle: boolean) => void>();
let acceptingRuns = true;

function notifyIdle(): void {
  if (sessionRuns.size !== 0) return;
  for (const resolve of idleWaiters) resolve(true);
  idleWaiters.clear();
}

export function isSessionRunActive(sessionId: string): boolean {
  return sessionRuns.has(sessionId);
}

export function acquireSessionRun(sessionId: string): AbortController | null {
  if (!acceptingRuns || sessionRuns.has(sessionId)) return null;
  const controller = new AbortController();
  sessionRuns.set(sessionId, { controller, runId: null });
  return controller;
}

export function beginSessionRunShutdown(): void {
  acceptingRuns = false;
}

export function setSessionRunId(sessionId: string, runId: string): void {
  const run = sessionRuns.get(sessionId);
  if (run) run.runId = runId;
}

export function getSessionRun(sessionId: string): ActiveSessionRun | undefined {
  return sessionRuns.get(sessionId);
}

export function listActiveSessionRuns(): Array<{ sessionId: string; run: ActiveSessionRun }> {
  return [...sessionRuns.entries()].map(([sessionId, run]) => ({ sessionId, run }));
}

export function releaseSessionRun(
  sessionId: string,
  owner?: AbortController,
): boolean {
  const active = sessionRuns.get(sessionId);
  if (!active || (owner && active.controller !== owner)) return false;
  sessionRuns.delete(sessionId);
  notifyIdle();
  return true;
}

export function awaitSessionRunsIdle(timeoutMs = 5000): Promise<boolean> {
  if (sessionRuns.size === 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (idle: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      idleWaiters.delete(finish);
      resolve(idle);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    idleWaiters.add(finish);
  });
}

export function abortAllSessionRuns(): Array<{
  sessionId: string;
  runId: string | null;
}> {
  const cancelled: Array<{ sessionId: string; runId: string | null }> = [];
  for (const [sessionId, run] of sessionRuns.entries()) {
    run.controller.abort();
    cancelled.push({ sessionId, runId: run.runId });
  }
  return cancelled;
}
