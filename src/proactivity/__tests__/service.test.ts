import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { createUserTask, updateUserTask } from '../../db/user-tasks';
import { completeCommitment, createCommitment } from '../../db/repositories/commitments';
import { createScheduledTask, markTaskFailure, markTaskRun } from '../../db/scheduled-tasks';
import { createMemoryCandidate, setMemoryCandidateStatus } from '../../db/repositories/memory-candidates';
import { getProactiveEvent, listProactiveEvents } from '../../db/repositories/proactive-events';
import {
  claimDelivery,
  getLastSentPopupAt,
  listDeliveries,
  listPlannedDeliveries,
  markDeliverySent,
} from '../../db/repositories/proactivity-deliveries';
import { listDecisions } from '../../db/repositories/proactivity-decisions';
import { addLocalDays, formatLocalDate } from '../../tasks/due-date';
import { runProactivityCycle, type ProactivityServiceDeps } from '../service';
import type { ProactivityPolicySettings } from '../policy';
import {
  clearHandledInboxEvents,
  dismissInboxEvent,
  getInboxSnapshot,
  getProactivityMetrics,
  openInboxEventSource,
  resolveInboxEvent,
  snoozeInboxEvent,
} from '../inbox';

const HOUR = 60 * 60 * 1000;

describe('P3 proactivity service closed loop', () => {
  let tempDir: string;
  let dbPath: string;
  let settings: ProactivityPolicySettings;
  let popup: ReturnType<typeof vi.fn>;
  let clock: number;

  function deps(overrides: Partial<ProactivityServiceDeps> = {}): ProactivityServiceDeps {
    return {
      getSettings: () => settings,
      popup: popup as unknown as ProactivityServiceDeps['popup'],
      now: () => clock,
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-p3-service-'));
    dbPath = path.join(tempDir, 'p3.db');
    await initDatabase(dbPath);
    settings = {
      proactivityEnabled: true,
      quietHoursStart: '',
      quietHoursEnd: '',
      notificationDedupMinutes: 5,
      notifyHourlyLimit: 3,
      notifyDailyLimit: 12,
      mutedEventDomains: [],
    };
    popup = vi.fn(async () => undefined);
    clock = Date.now();
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('projects six local sources once, notifies only the whitelisted high-urgency event, and stays quiet across restarts', async () => {
    const yesterday = addLocalDays(formatLocalDate(new Date(clock)), -1)!;
    const task = createUserTask({ title: '写周报', dueAt: yesterday });
    const commitment = createCommitment({ title: '回复客户', owner: 'user', dueAt: clock + HOUR, promisedTo: '客户' });
    const schedule = createScheduledTask({ name: '喝水', cron: '0 * * * *', actionType: 'reminder', actionPayload: '{}' });
    markTaskFailure(schedule.id, new Error('弹窗失败'));
    createMemoryCandidate({
      memoryKey: 'user.preference.drink', content: '改喝茶', category: 'stable_preference', confidence: 0.9,
      reason: 'r', conflictsWithMemoryId: 'mem-old',
    });

    const first = await runProactivityCycle(deps(), { trigger: 'startup' });
    expect(first.created).toBe(4);
    expect(first.routed).toMatchObject({ notify: 1, inbox: 3 });
    expect(popup).toHaveBeenCalledTimes(1);
    expect(popup.mock.calls[0][0]).toContain('回复客户');
    expect(first.changed).toBe(true);

    const second = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(second.created).toBe(0);
    expect(second.popupsSent).toBe(0);
    expect(popup).toHaveBeenCalledTimes(1);
    expect(listProactiveEvents({ statuses: ['open'] })).toHaveLength(4);

    // 模拟重启：关库再开，账本仍在，同一事件不再弹窗。
    closeDatabase();
    await initDatabase(dbPath);
    const third = await runProactivityCycle(deps(), { trigger: 'startup' });
    expect(third.created).toBe(0);
    expect(popup).toHaveBeenCalledTimes(1);
    const commitmentEvent = listProactiveEvents({ sourceId: commitment.id })[0];
    expect(getLastSentPopupAt('event', commitmentEvent.id)).not.toBeNull();

    // 来源解决：待办完成、承诺完成、任务成功、候选裁决 → 全部自动 resolved。
    updateUserTask(task.id, { status: 'done' });
    completeCommitment(commitment.id);
    markTaskRun(schedule.id);
    const candidateId = listProactiveEvents({ domains: ['memory'] })[0].sourceId;
    setMemoryCandidateStatus(candidateId, 'confirmed');
    const fourth = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(fourth.resolvedBySource).toBe(4);
    const resolved = listProactiveEvents({ statuses: ['resolved'] });
    expect(resolved.map((event) => event.resolvedReason).sort()).toEqual([
      'source:commitment', 'source:memory', 'source:schedule', 'source:task',
    ]);
    expect(listProactiveEvents({ statuses: ['open'] })).toHaveLength(0);

    const metrics = getProactivityMetrics(clock - HOUR, clock + HOUR);
    expect(metrics).toMatchObject({ eventsCreated: 4, notified: 1, inboxed: 3, resolvedBySource: 4 });
  });

  it('defers popups in quiet hours and replays them once the window ends, without a second popup', async () => {
    settings = { ...settings, quietHoursStart: '00:00', quietHoursEnd: '23:59' };
    createCommitment({ title: '发合同', owner: 'user', dueAt: clock + HOUR });
    const report = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(report.routed.defer).toBe(1);
    expect(popup).not.toHaveBeenCalled();
    const planned = listPlannedDeliveries({ channel: 'popup' });
    expect(planned).toHaveLength(1);
    expect(planned[0].scheduledAt).toBeGreaterThan(clock);

    settings = { ...settings, quietHoursStart: '', quietHoursEnd: '' };
    clock = planned[0].scheduledAt! + 1;
    const replay = await runProactivityCycle(deps(), { domains: new Set(), trigger: 'deferred' });
    expect(replay.deferredReplayed).toBe(1);
    expect(popup).toHaveBeenCalledTimes(1);
    expect(listPlannedDeliveries({ channel: 'popup' })).toHaveLength(0);

    const again = await runProactivityCycle(deps(), { domains: new Set(), trigger: 'deferred' });
    expect(again.popupsSent).toBe(0);
    expect(popup).toHaveBeenCalledTimes(1);
  });

  it('keeps events when the popup budget is exhausted and honours muted domains', async () => {
    settings = { ...settings, notifyHourlyLimit: 1 };
    createCommitment({ title: '第一件', owner: 'user', dueAt: clock + HOUR });
    createCommitment({ title: '第二件', owner: 'user', dueAt: clock + HOUR });
    const report = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(popup).toHaveBeenCalledTimes(1);
    expect(report.routed).toMatchObject({ notify: 1, inbox: 1 });
    const decisions = listDecisions({ subjectKind: 'event' });
    expect(decisions.map((item) => item.reason).sort()).toEqual(['budget_exhausted', 'notified']);
    expect(listProactiveEvents({ statuses: ['open'] })).toHaveLength(2);

    settings = { ...settings, notifyHourlyLimit: 0, mutedEventDomains: ['commitment'] };
    createCommitment({ title: '第三件', owner: 'user', dueAt: clock + HOUR });
    const muted = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(muted.routed.inbox).toBe(1);
    expect(popup).toHaveBeenCalledTimes(1);
  });

  it('supports snooze, wake, dismiss, resolve and source open feedback without touching domain truth', async () => {
    const yesterday = addLocalDays(formatLocalDate(new Date(clock)), -1)!;
    const task = createUserTask({ title: '写周报', dueAt: yesterday });
    await runProactivityCycle(deps(), { trigger: 'signal' });
    const event = listProactiveEvents({ statuses: ['open'] })[0];
    expect(getInboxSnapshot().unreadCount).toBe(1);

    expect(() => snoozeInboxEvent(event.id, 45, clock)).toThrow();
    const snoozed = snoozeInboxEvent(event.id, 30, clock);
    expect(snoozed?.status).toBe('snoozed');
    expect(getInboxSnapshot().later).toHaveLength(1);

    clock += 31 * 60 * 1000;
    const woken = await runProactivityCycle(deps(), { domains: new Set(), trigger: 'deferred' });
    expect(woken.woken).toBe(1);
    expect(getProactiveEvent(event.id)?.status).toBe('open');
    expect(listDecisions({ subjectId: event.id }).some((item) => item.decisionKey.includes(':wake:'))).toBe(true);

    const target = openInboxEventSource(event.id);
    expect(target).toMatchObject({ open: 'userTodos', sourceId: task.id });
    expect(getProactiveEvent(event.id)?.readAt).not.toBeNull();

    dismissInboxEvent(event.id, 'not_relevant');
    expect(getProactiveEvent(event.id)?.status).toBe('dismissed');
    const afterDismiss = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(afterDismiss.created).toBe(0);
    expect(getProactiveEvent(event.id)?.status).toBe('dismissed');
    expect(resolveInboxEvent(event.id)?.status).toBe('resolved');

    expect(getInboxSnapshot().handled).toHaveLength(1);
    expect(clearHandledInboxEvents()).toBe(1);
    expect(getInboxSnapshot().handled).toHaveLength(0);
    expect(listDeliveries({ subjectId: event.id })).toHaveLength(0);
  });

  it('reopens an auto-resolved event when the same condition returns, but never a user-dismissed one', async () => {
    const schedule = createScheduledTask({ name: '备份', cron: '0 * * * *', actionType: 'reminder', actionPayload: '{}' });
    markTaskFailure(schedule.id, new Error('第一次失败'));
    await runProactivityCycle(deps(), { trigger: 'signal' });
    const first = listProactiveEvents({ sourceId: schedule.id })[0];
    expect(first.status).toBe('open');

    markTaskRun(schedule.id);
    await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(getProactiveEvent(first.id)?.status).toBe('resolved');

    markTaskFailure(schedule.id, new Error('第二次失败'));
    const again = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(again.created).toBe(1);
    const reopened = getProactiveEvent(first.id);
    expect(reopened).toMatchObject({ status: 'open', resolvedReason: null, readAt: null });
    expect(reopened?.summary).toContain('第二次失败');

    dismissInboxEvent(first.id, 'too_noisy');
    markTaskRun(schedule.id);
    await runProactivityCycle(deps(), { trigger: 'signal' });
    markTaskFailure(schedule.id, new Error('第三次失败'));
    const after = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(after.created).toBe(0);
    expect(getProactiveEvent(first.id)?.status).toBe('dismissed');
  });

  it('keeps an expired event resolved instead of flapping it back to unread every cycle', async () => {
    // 逾期 40 天的待办：投影出的 expires_at 由 occurred_at 推导，永远停在过去。
    const longOverdue = addLocalDays(formatLocalDate(new Date(clock)), -40)!;
    createUserTask({ title: '归档旧项目', dueAt: longOverdue });

    const first = await runProactivityCycle(deps(), { trigger: 'startup' });
    expect(first.created).toBe(1);
    const event = listProactiveEvents({})[0];

    const second = await runProactivityCycle(deps(), { trigger: 'sweep' });
    expect(second.expired).toBe(1);
    expect(getProactiveEvent(event.id)).toMatchObject({ status: 'resolved', resolvedReason: 'expired' });

    // 稳态：后续周期既不重建也不再收口，已读状态与收件箱分段都不再抖动。
    for (const trigger of ['signal', 'sweep', 'signal'] as const) {
      const report = await runProactivityCycle(deps(), { trigger });
      expect(report.created).toBe(0);
      expect(report.expired).toBe(0);
    }
    expect(getProactiveEvent(event.id)).toMatchObject({ status: 'resolved', resolvedReason: 'expired' });
    expect(listProactiveEvents({ statuses: ['open'] })).toHaveLength(0);
    expect(getInboxSnapshot().unreadCount).toBe(0);
  });

  it('does not let explicit reminder popups consume the proactive event budget', async () => {
    settings = { ...settings, notifyHourlyLimit: 1 };
    // 显式到点提醒与每日管家提示共用投递账本，但不属于事件弹窗预算。
    const reminder = claimDelivery({
      deliveryKey: 'delivery:reminder:r1',
      subjectKind: 'scheduled_reminder',
      subjectId: 'r1',
      channel: 'popup',
    });
    markDeliverySent(reminder.delivery.id, clock);

    createCommitment({ title: '回复客户', owner: 'user', dueAt: clock + HOUR });
    const report = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(report.routed).toMatchObject({ notify: 1 });
    expect(popup).toHaveBeenCalledTimes(1);
  });

  it('re-routes a reopened event so a recurring failure can notify again', async () => {
    const schedule = createScheduledTask({ name: '备份', cron: '0 * * * *', actionType: 'reminder', actionPayload: '{}' });
    for (let i = 0; i < 3; i += 1) markTaskFailure(schedule.id, new Error('磁盘满'));
    await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(popup).toHaveBeenCalledTimes(1);
    const event = listProactiveEvents({ sourceId: schedule.id })[0];

    markTaskRun(schedule.id);
    await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(getProactiveEvent(event.id)?.status).toBe('resolved');

    clock += 30 * 60 * 1000; // 越过通知去重窗口
    for (let i = 0; i < 3; i += 1) markTaskFailure(schedule.id, new Error('磁盘又满了'));
    const again = await runProactivityCycle(deps(), { trigger: 'signal' });
    expect(getProactiveEvent(event.id)?.status).toBe('open');
    expect(again.duplicatesBlocked).toBe(0);
    expect(again.routed.notify).toBe(1);
    expect(popup).toHaveBeenCalledTimes(2);
  });

  it('does nothing while proactivity is globally disabled', async () => {
    settings = { ...settings, proactivityEnabled: false };
    createCommitment({ title: '发合同', owner: 'user', dueAt: clock + HOUR });
    const report = await runProactivityCycle(deps(), { trigger: 'startup' });
    expect(report.projected).toBe(0);
    expect(report.created).toBe(0);
    expect(popup).not.toHaveBeenCalled();
    expect(listProactiveEvents({})).toHaveLength(0);
  });
});
