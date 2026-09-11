import type { RunTerminalReason } from './run-state';
import type { RunPhase } from './run-lifecycle';
import { classifyRunError, type RunErrorCategory } from './run-errors';

export { classifyRunError, type RunErrorCategory } from './run-errors';

export type RunActivityStage = 'model' | 'tool' | 'permission' | 'persistence' | 'background';
export type RunActivityStatus = 'succeeded' | 'failed' | 'cancelled';

export interface RunActivityEvent {
  stage: RunActivityStage;
  status: RunActivityStatus;
  name?: string;
  durationMs?: number;
  errorCategory?: RunErrorCategory;
  reason?: string;
  attempts?: number;
}

export interface RunContextBudgetDiagnostic {
  maxInputTokens: number;
  estimatedInputTokens: number;
  systemTokens: number;
  historyTokens: number;
  toolTokens: number;
  trimmedHistoryMessages: number;
  droppedSectionIds: string[];
  truncatedSectionIds: string[];
  overBudgetTokens: number;
}

interface ActiveToolCall {
  name: string;
  startedAt: number;
}

export interface RunTelemetrySnapshot {
  runId: string;
  sessionId: string;
  modelId: string;
  activeSkillIds: string[];
  phase: RunPhase;
  startedAt: number;
  terminalAt?: number;
  durationMs?: number;
  terminalReason?: RunTerminalReason | 'session_not_found' | 'consumer_closed';
  toolCallCount: number;
  toolFailureCount: number;
  toolDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  errorCategory?: RunErrorCategory;
  activities: RunActivityEvent[];
  contextBudget?: RunContextBudgetDiagnostic;
}

const MAX_RECENT_RUNS = 100;
const recentRuns: RunTelemetrySnapshot[] = [];

function cloneSnapshot(record: RunTelemetrySnapshot): RunTelemetrySnapshot {
  return {
    ...record,
    activeSkillIds: [...record.activeSkillIds],
    activities: record.activities.map((activity) => ({ ...activity })),
    ...(record.contextBudget
      ? {
          contextBudget: {
            ...record.contextBudget,
            droppedSectionIds: [...record.contextBudget.droppedSectionIds],
            truncatedSectionIds: [...record.contextBudget.truncatedSectionIds],
          },
        }
      : {}),
  };
}

function storeRunDiagnostic(record: RunTelemetrySnapshot): void {
  recentRuns.unshift(cloneSnapshot(record));
  if (recentRuns.length > MAX_RECENT_RUNS) recentRuns.length = MAX_RECENT_RUNS;
}

export function listRunDiagnostics(limit = 20): RunTelemetrySnapshot[] {
  const safeLimit = Math.max(1, Math.min(MAX_RECENT_RUNS, Math.floor(limit) || 20));
  return recentRuns.slice(0, safeLimit).map(cloneSnapshot);
}

export function getRunDiagnostic(runId: string): RunTelemetrySnapshot | null {
  const record = recentRuns.find((candidate) => candidate.runId === runId);
  return record ? cloneSnapshot(record) : null;
}

export function appendRunDiagnosticActivity(
  runId: string,
  activity: RunActivityEvent,
): boolean {
  const record = recentRuns.find((candidate) => candidate.runId === runId);
  if (!record || record.activities.length >= 100) return false;
  record.activities.push({ ...activity });
  return true;
}

export function clearRunDiagnosticsForTests(): void {
  recentRuns.length = 0;
}

export interface RunTelemetryInput {
  runId: string;
  sessionId: string;
  modelId?: string;
  activeSkillIds?: string[];
  now?: () => number;
  logger?: (record: RunTelemetrySnapshot) => void;
}

export class RunTelemetry {
  private readonly now: () => number;
  private readonly logger: (record: RunTelemetrySnapshot) => void;
  private readonly activeTools = new Map<string, ActiveToolCall>();
  private readonly activeActivities = new Map<string, {
    stage: RunActivityStage;
    name?: string;
    startedAt: number;
  }>();
  private readonly activities: RunActivityEvent[] = [];
  private activitySequence = 0;
  private readonly data: RunTelemetrySnapshot;
  private ended = false;

  constructor(input: RunTelemetryInput) {
    this.now = input.now ?? Date.now;
    this.logger = input.logger ?? ((record) => {
      console.info('[agent.run]', JSON.stringify(record));
    });
    const startedAt = this.now();
    this.data = {
      runId: input.runId,
      sessionId: input.sessionId,
      modelId: input.modelId ?? 'unknown',
      activeSkillIds: [...(input.activeSkillIds ?? [])],
      phase: 'created',
      startedAt,
      toolCallCount: 0,
      toolFailureCount: 0,
      toolDurationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      activities: [],
    };
  }

  setModel(modelId: string | undefined): void {
    if (!this.ended && modelId) this.data.modelId = modelId;
  }

  setActiveSkills(skillIds: string[]): void {
    if (!this.ended) this.data.activeSkillIds = [...skillIds];
  }

  recordPhase(phase: RunPhase): void {
    if (!this.ended) this.data.phase = phase;
  }

  recordToolStart(callId: string, name: string): void {
    if (this.ended) return;
    this.data.toolCallCount += 1;
    const startedAt = this.now();
    this.activeTools.set(callId, { name, startedAt });
    this.recordActivityStart(callId, 'tool', name, startedAt);
  }

  recordToolEnd(callId: string, success: boolean, errorMessage?: string): void {
    if (this.ended) return;
    const active = this.activeTools.get(callId);
    if (active) {
      this.data.toolDurationMs += Math.max(0, this.now() - active.startedAt);
      this.activeTools.delete(callId);
    }
    if (!success) this.data.toolFailureCount += 1;
    this.recordActivityEnd(
      callId,
      success ? 'succeeded' : errorMessage === '已取消' ? 'cancelled' : 'failed',
      errorMessage,
    );
  }

  recordModelRoundStart(round: number): void {
    this.recordActivityStart(`model-${round}`, 'model', `round-${round}`);
  }

  recordModelRoundEnd(
    round: number,
    status: RunActivityStatus,
    errorMessage?: string,
  ): void {
    this.recordActivityEnd(`model-${round}`, status, errorMessage);
  }

  recordPermissionStart(toolName: string): string {
    const id = `permission-${++this.activitySequence}`;
    this.recordActivityStart(id, 'permission', toolName);
    return id;
  }

  recordPermissionEnd(
    activityId: string,
    status: RunActivityStatus,
    errorMessage?: string,
  ): void {
    this.recordActivityEnd(activityId, status, errorMessage);
  }

  recordPersistenceStart(name: string): string {
    const id = `persistence-${++this.activitySequence}`;
    this.recordActivityStart(id, 'persistence', name);
    return id;
  }

  recordPersistenceEnd(
    activityId: string,
    status: RunActivityStatus,
    errorMessage?: string,
  ): void {
    this.recordActivityEnd(activityId, status, errorMessage);
  }

  recordUsage(promptTokens: number, completionTokens: number, cachedTokens = 0): void {
    if (this.ended) return;
    this.data.promptTokens += promptTokens;
    this.data.completionTokens += completionTokens;
    this.data.cachedTokens += cachedTokens;
  }

  recordContextBudget(diagnostic: RunContextBudgetDiagnostic): void {
    if (this.ended) return;
    this.data.contextBudget = {
      ...diagnostic,
      droppedSectionIds: [...diagnostic.droppedSectionIds],
      truncatedSectionIds: [...diagnostic.truncatedSectionIds],
    };
  }

  finish(
    phase: Extract<RunPhase, 'finished' | 'cancelled' | 'error'>,
    reason: RunTelemetrySnapshot['terminalReason'],
    errorMessage?: string,
  ): RunTelemetrySnapshot {
    if (this.ended) return this.snapshot();
    const terminalAt = this.now();
    this.data.phase = phase;
    this.data.terminalAt = terminalAt;
    this.data.durationMs = Math.max(0, terminalAt - this.data.startedAt);
    this.data.terminalReason = reason;
    if (errorMessage) this.data.errorCategory = classifyRunError(errorMessage);
    for (const [activityId, active] of this.activeActivities) {
      this.recordActivityEnd(activityId, 'cancelled');
      if (active.stage === 'tool') this.activeTools.delete(activityId);
    }
    this.activeTools.clear();
    this.ended = true;
    const record = this.snapshot();
    storeRunDiagnostic(record);
    this.logger(record);
    return record;
  }

  snapshot(): RunTelemetrySnapshot {
    return {
      ...this.data,
      activeSkillIds: [...this.data.activeSkillIds],
      activities: this.activities.map((activity) => ({ ...activity })),
      ...(this.data.contextBudget
        ? {
            contextBudget: {
              ...this.data.contextBudget,
              droppedSectionIds: [...this.data.contextBudget.droppedSectionIds],
              truncatedSectionIds: [...this.data.contextBudget.truncatedSectionIds],
            },
          }
        : {}),
    };
  }

  private recordActivityStart(
    activityId: string,
    stage: RunActivityStage,
    name?: string,
    startedAt = this.now(),
  ): void {
    if (this.ended) return;
    this.activeActivities.set(activityId, { stage, name, startedAt });
  }

  private recordActivityEnd(
    activityId: string,
    status: RunActivityStatus,
    errorMessage?: string,
  ): void {
    if (this.ended) return;
    const active = this.activeActivities.get(activityId);
    if (!active) return;
    this.activeActivities.delete(activityId);
    if (this.activities.length >= 100) return;
    this.activities.push({
      stage: active.stage,
      status,
      ...(active.name ? { name: active.name } : {}),
      durationMs: Math.max(0, this.now() - active.startedAt),
      ...(status === 'failed' && errorMessage
        ? { errorCategory: classifyRunError(errorMessage) }
        : {}),
    });
  }
}

export function createRunTelemetry(input: RunTelemetryInput): RunTelemetry {
  return new RunTelemetry(input);
}
