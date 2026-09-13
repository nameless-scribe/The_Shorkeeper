export interface ShutdownDependencies {
  beginSessionRunShutdown: () => void;
  cancelAllPendingPermissions: () => void;
  abortAllSessionRuns: () => unknown;
  shutdownVoiceRuntime: () => void;
  shutdownAutoUpdaterRuntime: () => void;
  clearStartupTimers: () => void;
  awaitSessionRunsIdle: (timeoutMs: number) => Promise<boolean>;
  shutdownPendingSessionWork: (timeoutMs: number) => Promise<boolean>;
  shutdownDocumentsRuntime: (timeoutMs: number) => Promise<boolean>;
  closeDatabase: () => Promise<void>;
}

export interface ShutdownResult {
  runsIdle: boolean;
  backgroundIdle: boolean;
  ragIdle: boolean;
  databaseClosed: boolean;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Best-effort shutdown barrier. A failure in one subsystem must never prevent
 * the remaining resources (especially SQLite) from receiving their cleanup.
 */
export async function coordinateRuntimeShutdown(
  dependencies: ShutdownDependencies,
  timeoutMs: number,
): Promise<ShutdownResult> {
  const errors: string[] = [];
  const runSync = (name: string, operation: () => unknown) => {
    try {
      operation();
    } catch (error) {
      errors.push(`${name}: ${errorMessage(error)}`);
    }
  };

  runSync('session-run-begin', dependencies.beginSessionRunShutdown);
  runSync('permissions', dependencies.cancelAllPendingPermissions);
  runSync('session-run-abort', dependencies.abortAllSessionRuns);
  runSync('voice', dependencies.shutdownVoiceRuntime);
  runSync('auto-updater', dependencies.shutdownAutoUpdaterRuntime);
  runSync('startup-timers', dependencies.clearStartupTimers);

  const wait = async (name: string, operation: () => Promise<boolean>) => {
    try {
      return await operation();
    } catch (error) {
      errors.push(`${name}: ${errorMessage(error)}`);
      return false;
    }
  };
  const [runsIdle, backgroundIdle, ragIdle] = await Promise.all([
    wait('session-runs', () => dependencies.awaitSessionRunsIdle(timeoutMs)),
    wait('background-work', () => dependencies.shutdownPendingSessionWork(timeoutMs)),
    wait('rag', () => dependencies.shutdownDocumentsRuntime(timeoutMs)),
  ]);

  let databaseClosed = false;
  try {
    await dependencies.closeDatabase();
    databaseClosed = true;
  } catch (error) {
    errors.push(`database: ${errorMessage(error)}`);
  }

  return { runsIdle, backgroundIdle, ragIdle, databaseClosed, errors };
}
