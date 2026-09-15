import { describe, expect, it, vi } from 'vitest';
import {
  coordinateRuntimeShutdown,
  type ShutdownDependencies,
} from '../shutdown-coordinator';

function dependencies(
  overrides: Partial<ShutdownDependencies> = {},
): ShutdownDependencies {
  return {
    beginSessionRunShutdown: vi.fn(),
    cancelAllPendingPermissions: vi.fn(),
    cancelAllPendingQuestions: vi.fn(),
    abortAllSessionRuns: vi.fn(),
    shutdownVoiceRuntime: vi.fn(),
    shutdownAutoUpdaterRuntime: vi.fn(),
    clearStartupTimers: vi.fn(),
    awaitSessionRunsIdle: vi.fn(async () => true),
    shutdownPendingSessionWork: vi.fn(async () => true),
    shutdownDocumentsRuntime: vi.fn(async () => true),
    closeDatabase: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runtime shutdown coordinator', () => {
  it('waits for all runtimes before closing the database', async () => {
    const order: string[] = [];
    const deps = dependencies({
      awaitSessionRunsIdle: vi.fn(async () => { order.push('runs'); return true; }),
      shutdownPendingSessionWork: vi.fn(async () => { order.push('background'); return true; }),
      shutdownDocumentsRuntime: vi.fn(async () => { order.push('rag'); return true; }),
      closeDatabase: vi.fn(async () => { order.push('database'); }),
    });

    await expect(coordinateRuntimeShutdown(deps, 500)).resolves.toEqual({
      runsIdle: true,
      backgroundIdle: true,
      ragIdle: true,
      databaseClosed: true,
      errors: [],
    });
    expect(order.at(-1)).toBe('database');
  });

  it('continues cleanup and closes the database when sibling cleanup fails', async () => {
    const deps = dependencies({
      shutdownVoiceRuntime: vi.fn(() => { throw new Error('voice failed'); }),
      awaitSessionRunsIdle: vi.fn(async () => { throw new Error('run wait failed'); }),
      shutdownPendingSessionWork: vi.fn(async () => false),
    });

    const result = await coordinateRuntimeShutdown(deps, 500);

    expect(result).toMatchObject({
      runsIdle: false,
      backgroundIdle: false,
      ragIdle: true,
      databaseClosed: true,
    });
    expect(result.errors).toEqual([
      'voice: voice failed',
      'session-runs: run wait failed',
    ]);
    expect(deps.shutdownAutoUpdaterRuntime).toHaveBeenCalledOnce();
    expect(deps.shutdownDocumentsRuntime).toHaveBeenCalledOnce();
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });
});
