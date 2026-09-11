import type { RunTerminalReason } from './run-state';

export type RunPhase =
  | 'created'
  | 'running'
  | 'waiting_tool'
  | 'finalizing'
  | 'finished'
  | 'cancelled'
  | 'error';

export interface RunLifecycleSnapshot {
  runId: string;
  sessionId: string;
  phase: RunPhase;
  startedAt: number;
  terminalAt?: number;
  terminalReason?: RunTerminalReason | 'session_not_found' | 'consumer_closed';
}

const TERMINAL_PHASES = new Set<RunPhase>(['finished', 'cancelled', 'error']);

const ALLOWED_TRANSITIONS: Record<RunPhase, ReadonlySet<RunPhase>> = {
  created: new Set(['running', 'cancelled', 'error']),
  running: new Set(['running', 'waiting_tool', 'finalizing', 'cancelled', 'error']),
  waiting_tool: new Set(['running', 'waiting_tool', 'cancelled', 'error']),
  finalizing: new Set(['finished', 'cancelled', 'error']),
  finished: new Set(),
  cancelled: new Set(),
  error: new Set(),
};

export class RunLifecycle {
  private state: RunLifecycleSnapshot;

  constructor(runId: string, sessionId: string) {
    this.state = {
      runId,
      sessionId,
      phase: 'created',
      startedAt: Date.now(),
    };
  }

  snapshot(): RunLifecycleSnapshot {
    return { ...this.state };
  }

  isTerminal(): boolean {
    return TERMINAL_PHASES.has(this.state.phase);
  }

  transition(
    next: RunPhase,
    reason?: RunLifecycleSnapshot['terminalReason'],
  ): RunLifecycleSnapshot {
    if (this.state.phase === next) return this.snapshot();
    if (!ALLOWED_TRANSITIONS[this.state.phase].has(next)) {
      throw new Error(`非法 run 生命周期转移: ${this.state.phase} -> ${next}`);
    }

    const terminalAt = TERMINAL_PHASES.has(next) ? Date.now() : undefined;
    this.state = {
      ...this.state,
      phase: next,
      ...(terminalAt === undefined ? {} : { terminalAt, terminalReason: reason }),
    };
    return this.snapshot();
  }
}

export function createRunLifecycle(runId: string, sessionId: string): RunLifecycle {
  return new RunLifecycle(runId, sessionId);
}
