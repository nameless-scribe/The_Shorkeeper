import { describe, expect, it } from 'vitest';
import type { CommitmentInfo, MemoryCandidateInfo, ScheduledTaskInfo, TaskRunInfo, UserTaskInfo } from '../../shared/types';
import {
  projectCommitmentEvents,
  projectDocumentEvents,
  projectGoalEvents,
  projectLocalEvents,
  projectMemoryEvents,
  projectRunEvents,
  projectScheduleEvents,
  projectTaskEvents,
  type GoalSourceState,
} from '../collector';
import { localDateKey } from '../contract';

const now = new Date(2026, 8, 13, 10, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function task(overrides: Partial<UserTaskInfo>): UserTaskInfo {
  return {
    id: 'task-1', title: '写周报', status: 'pending', sourceFile: null, sourceRow: null, module: null,
    dueAt: null, notes: null, goalId: null, createdAt: now - DAY, updatedAt: now - DAY, ...overrides,
  };
}

function commitment(overrides: Partial<CommitmentInfo>): CommitmentInfo {
  return {
    id: 'c-1', goalId: null, title: '回复客户', owner: 'user', status: 'open', dueAt: null, promisedTo: '客户',
    sourceSessionId: null, sourceRunId: null, taskId: 'task-1', scheduledTaskId: null, evidenceRunId: null,
    evidenceArtifactId: null, lastFollowedUpAt: null, createdAt: now - DAY, updatedAt: now - DAY, closedAt: null,
    ...overrides,
  };
}

function run(overrides: Partial<TaskRunInfo>): TaskRunInfo {
  return {
    id: 'run-1', sessionId: 's-1', kind: 'chat', triggerRef: null, phase: 'error', terminalReason: 'model_error',
    errorSummary: '模型超时', modelId: null, assistantMessageId: null, stepCount: 3, failedStepCount: 1,
    startedAt: now - HOUR, updatedAt: now - HOUR, terminalAt: now - HOUR, acknowledgedAt: null, ...overrides,
  };
}

function schedule(overrides: Partial<ScheduledTaskInfo>): ScheduledTaskInfo {
  return {
    id: 'sched-1', name: '喝水', scheduleKind: 'recurring', cron: '0 * * * *', runAt: null, actionType: 'reminder',
    actionPayload: '{}', enabled: true, lastRunAt: null, lastError: null, lastErrorAt: null, failureCount: 0, ...overrides,
  };
}

describe('P3.1 local event projection', () => {
  it('projects due-today and overdue tasks with stable keys and ignores closed or undated ones', () => {
    const today = localDateKey(now);
    const events = projectTaskEvents([
      task({ id: 'today', dueAt: today }),
      task({ id: 'late', dueAt: localDateKey(now - 8 * DAY) }),
      task({ id: 'done', dueAt: today, status: 'done' }),
      task({ id: 'future', dueAt: localDateKey(now + DAY) }),
      task({ id: 'undated' }),
    ], now);
    expect(events.map((event) => [event.kind, event.dedupeKey, event.urgency])).toEqual([
      ['task_due_today', `task:today:due:${today}`, 'normal'],
      ['task_overdue', `task:late:overdue:${localDateKey(now - 8 * DAY)}`, 'high'],
    ]);
    expect(events[1].title).toContain('已逾期 8 天');
  });

  it('projects commitment states: proposed, missed, due soon (with notify window) and unattended', () => {
    const events = projectCommitmentEvents([
      commitment({ id: 'proposed', status: 'proposed', createdAt: now - HOUR }),
      commitment({ id: 'missed', status: 'missed', closedAt: now - 2 * HOUR }),
      commitment({ id: 'soon', dueAt: now + 90 * 60 * 1000 }),
      commitment({ id: 'tomorrow', dueAt: now + 20 * HOUR }),
      commitment({ id: 'far', dueAt: now + 5 * DAY }),
      commitment({ id: 'stale', createdAt: now - 10 * DAY, lastFollowedUpAt: null }),
      commitment({ id: 'done', status: 'done' }),
    ], now);
    const byId = Object.fromEntries(events.map((event) => [event.sourceId, event]));
    expect(byId.proposed).toMatchObject({ kind: 'commitment_proposed', urgency: 'low' });
    expect(byId.missed).toMatchObject({ kind: 'commitment_missed', urgency: 'high' });
    expect(byId.soon).toMatchObject({ kind: 'commitment_due_soon', urgency: 'high' });
    expect(byId.tomorrow).toMatchObject({ kind: 'commitment_due_soon', urgency: 'normal' });
    expect(byId.far).toBeUndefined();
    expect(byId.stale).toMatchObject({ kind: 'commitment_unattended', urgency: 'low', dedupeKey: 'commitment:stale:unattended:w1' });
    expect(byId.done).toBeUndefined();
    expect(byId.soon.summary).not.toContain('客户' + 'undefined');
  });

  it('projects unacknowledged failed or interrupted runs within the lookback window only', () => {
    const events = projectRunEvents([
      run({ id: 'err' }),
      run({ id: 'int', phase: 'interrupted', terminalReason: 'process_exit' }),
      run({ id: 'acked', acknowledgedAt: now }),
      run({ id: 'old', terminalAt: now - 30 * DAY }),
      run({ id: 'ok', phase: 'finished' }),
    ], now);
    expect(events.map((event) => event.dedupeKey)).toEqual(['run:err:error', 'run:int:interrupted']);
    expect(events[0].summary).toContain('模型超时');
    expect(events[0].summary).toContain('不会自动重跑');
  });

  it('projects schedule failures with escalation and missed one-shot reminders', () => {
    const events = projectScheduleEvents([
      schedule({ id: 'fail', failureCount: 1, lastError: 'boom', lastErrorAt: now - HOUR }),
      schedule({ id: 'fail3', failureCount: 3, lastError: 'boom', lastErrorAt: now - HOUR }),
      schedule({ id: 'missed', scheduleKind: 'once', cron: '', runAt: now - HOUR, lastRunAt: null }),
      schedule({ id: 'fresh', scheduleKind: 'once', cron: '', runAt: now - 60_000, lastRunAt: null }),
      schedule({ id: 'ran', scheduleKind: 'once', cron: '', runAt: now - HOUR, lastRunAt: now - HOUR }),
      schedule({ id: 'disabled', enabled: false, failureCount: 5, lastErrorAt: now }),
    ], now);
    const byId = Object.fromEntries(events.map((event) => [event.sourceId, event]));
    expect(byId.fail).toMatchObject({ kind: 'schedule_failed', urgency: 'normal' });
    expect(byId.fail3).toMatchObject({ kind: 'schedule_failed', urgency: 'high' });
    expect(byId.missed).toMatchObject({ kind: 'schedule_missed' });
    expect(byId.fresh).toBeUndefined();
    expect(byId.ran).toBeUndefined();
    expect(byId.disabled).toBeUndefined();
  });

  it('projects document freshness without copying content and keys by document version', () => {
    const base = {
      title: '个人说明', filename: '个人说明.md', status: 'indexed', statusError: null, staleReason: null,
      sourceKind: 'local_file', sourceModifiedAt: now - 3 * DAY, importedAt: now - 5 * DAY,
    };
    const events = projectDocumentEvents([
      { ...base, id: 'changed', freshnessStatus: 'changed', version: 2 },
      { ...base, id: 'missing', freshnessStatus: 'missing', version: 1 },
      { ...base, id: 'failed', freshnessStatus: 'unknown', staleReason: '无法读取来源', version: 1 },
      { ...base, id: 'broken', status: 'index_failed', statusError: '维度不匹配', freshnessStatus: 'current', version: 1 },
      { ...base, id: 'snapshot', sourceKind: 'snapshot', freshnessStatus: 'snapshot', version: 1 },
      { ...base, id: 'current', freshnessStatus: 'current', version: 1 },
    ], now);
    expect(events.map((event) => event.dedupeKey)).toEqual([
      'doc:changed:changed:2',
      'doc:missing:missing:1',
      'doc:failed:sync_failed:1',
      'doc:broken:sync_failed:1',
    ]);
    expect(events[0].sourceVersion).toBe(2);
    // 文档事件用稳定时间且不过期：重复扫描不会把事件刷成"有变化"。
    expect(events[0].occurredAt).toBe(now - 3 * DAY);
    expect(events[0].expiresAt).toBeNull();
  });

  it('projects memory conflicts, sensitive candidates and expiring memories without leaking content', () => {
    const candidate: MemoryCandidateInfo = {
      id: 'cand-1', memoryKey: 'user.secret', content: '身份证号 1234', category: 'stable_preference', confidence: 0.9,
      reason: 'r', sourceSessionId: null, sourceMessageId: null, sourceRunId: null, memoryType: 'preference',
      sensitivity: 'sensitive', modelUsePolicy: 'deny', validFrom: null, expiresAt: null, conflictsWithMemoryId: null,
      proposedAction: 'create', status: 'pending', createdAt: now - HOUR, updatedAt: now - HOUR,
    };
    const events = projectMemoryEvents(
      [candidate, { ...candidate, id: 'cand-2', sensitivity: 'normal', conflictsWithMemoryId: 'mem-9' }, { ...candidate, id: 'cand-3', status: 'confirmed' }],
      [
        { id: 'mem-1', memoryKey: 'user.city', status: 'active', expiresAt: now + 2 * DAY },
        { id: 'mem-2', memoryKey: 'user.job', status: 'active', expiresAt: now + 30 * DAY },
        { id: 'mem-3', memoryKey: null, status: 'expired', expiresAt: now - DAY },
      ],
      now,
    );
    expect(events.map((event) => event.kind)).toEqual(['memory_sensitive', 'memory_conflict', 'memory_expiring']);
    for (const event of events) {
      expect(event.summary ?? '').not.toContain('1234');
      expect(event.title).not.toContain('1234');
    }
    expect(events[1].sourceRef).toBe('memory:mem-9');
  });

  it('projects goal target proximity and stalled goals', () => {
    const goal = (overrides: Partial<GoalSourceState>): GoalSourceState => ({
      id: 'g', title: '季度报告', description: null, status: 'active', priority: 1, targetDate: null,
      createdAt: now - 30 * DAY, updatedAt: now - 30 * DAY, closedAt: null,
      progress: { totalTasks: 3, doneTasks: 1, openCommitments: 0 }, lastActivityAt: now - DAY, ...overrides,
    });
    const events = projectGoalEvents([
      goal({ id: 'near', targetDate: localDateKey(now + 2 * DAY) }),
      goal({ id: 'complete', targetDate: localDateKey(now + DAY), progress: { totalTasks: 3, doalTasks: 3, doneTasks: 3, openCommitments: 0 } as never }),
      goal({ id: 'stalled', lastActivityAt: now - 20 * DAY }),
      goal({ id: 'active', lastActivityAt: now - 2 * DAY }),
      goal({ id: 'paused', status: 'paused', lastActivityAt: now - 40 * DAY }),
    ], now);
    expect(events.map((event) => [event.sourceId, event.kind])).toEqual([
      ['near', 'goal_target_near'],
      ['stalled', 'goal_stalled'],
    ]);
  });

  it('merges domains, dedupes by key and reports which domains are complete', () => {
    const result = projectLocalEvents({
      now,
      tasks: { items: [task({ id: 'a', dueAt: localDateKey(now) })], complete: true },
      commitments: { items: [], complete: false },
      runs: { items: [run({ id: 'r' })], complete: true },
    });
    expect(result.events).toHaveLength(2);
    expect(result.coveredDomains).toEqual(['task', 'commitment', 'run']);
    expect(result.completeDomains).toEqual(['task', 'run']);
    expect(result.events.every((event) => event.expiresAt != null)).toBe(true);
  });
});
