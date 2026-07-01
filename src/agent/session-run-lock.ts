export interface ActiveSessionRun {
  controller: AbortController;
  runId: string | null;
}

const sessionRuns = new Map<string, ActiveSessionRun>();

export function isSessionRunActive(sessionId: string): boolean {
  return sessionRuns.has(sessionId);
}

export function acquireSessionRun(sessionId: string): AbortController | null {
  if (sessionRuns.has(sessionId)) return null;
  const controller = new AbortController();
  sessionRuns.set(sessionId, { controller, runId: null });
  return controller;
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

export function releaseSessionRun(sessionId: string): void {
  sessionRuns.delete(sessionId);
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
