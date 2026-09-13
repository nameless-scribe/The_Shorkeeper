import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import {
  createScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from '../db/scheduled-tasks';
import { notifyTasksChanged } from '../scheduler/task-events';
import { EVENING_REVIEW_PROMPT, MORNING_BRIEF_PROMPT } from '../tasks/daily-steward';
import type { DailyStewardSettingsInfo, ScheduledTaskInfo } from '../shared/types';

export const DAILY_STEWARD_SETTING_KEY = 'daily_steward.settings';

/** 系统任务在 action_payload 里的标记；设置页据此找到并更新自己的两条任务。 */
export const STEWARD_MARKER_KEY = '_shorekeeper_system';
export const STEWARD_MORNING_MARKER = 'daily_steward_morning';
export const STEWARD_EVENING_MARKER = 'daily_steward_evening';

export const DAILY_STEWARD_DEFAULTS: DailyStewardSettingsInfo = {
  enabled: false,
  morningTime: '08:00',
  eveningTime: '21:30',
  popup: true,
};

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function normalizeClock(value: string): string | null {
  const match = value.trim().match(CLOCK);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function clockToCron(clock: string): string {
  const normalized = normalizeClock(clock);
  if (!normalized) throw new Error(`无效时间: ${clock}`);
  const [hour, minute] = normalized.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

export function getDailyStewardSettings(): DailyStewardSettingsInfo {
  const stored = getJsonSetting<Partial<DailyStewardSettingsInfo>>(DAILY_STEWARD_SETTING_KEY) ?? {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DAILY_STEWARD_DEFAULTS.enabled,
    morningTime: (typeof stored.morningTime === 'string' && normalizeClock(stored.morningTime))
      || DAILY_STEWARD_DEFAULTS.morningTime,
    eveningTime: (typeof stored.eveningTime === 'string' && normalizeClock(stored.eveningTime))
      || DAILY_STEWARD_DEFAULTS.eveningTime,
    popup: typeof stored.popup === 'boolean' ? stored.popup : DAILY_STEWARD_DEFAULTS.popup,
  };
}

export function saveDailyStewardSettings(
  patch: Partial<DailyStewardSettingsInfo>,
): DailyStewardSettingsInfo {
  const current = getDailyStewardSettings();
  const next: DailyStewardSettingsInfo = {
    enabled: patch.enabled ?? current.enabled,
    morningTime: patch.morningTime !== undefined
      ? (normalizeClock(patch.morningTime) ?? (() => { throw new Error('早间时间须为 HH:MM'); })())
      : current.morningTime,
    eveningTime: patch.eveningTime !== undefined
      ? (normalizeClock(patch.eveningTime) ?? (() => { throw new Error('晚间时间须为 HH:MM'); })())
      : current.eveningTime,
    popup: patch.popup ?? current.popup,
  };
  setJsonSetting(DAILY_STEWARD_SETTING_KEY, next);
  return next;
}

interface StewardTaskSpec {
  marker: string;
  name: string;
  clock: string;
  prompt: string;
  popupTitle: string;
}

function findStewardTask(tasks: ScheduledTaskInfo[], marker: string): ScheduledTaskInfo | undefined {
  return tasks.find((task) => {
    try {
      const payload = JSON.parse(task.actionPayload) as Record<string, unknown>;
      return payload[STEWARD_MARKER_KEY] === marker;
    } catch {
      return false;
    }
  });
}

function buildPayload(spec: StewardTaskSpec, settings: DailyStewardSettingsInfo): string {
  return JSON.stringify({
    prompt: spec.prompt,
    respect_quiet_hours: true,
    ...(settings.popup ? { popup_title: spec.popupTitle } : {}),
    [STEWARD_MARKER_KEY]: spec.marker,
  });
}

export interface StewardScheduleResult {
  morning: ScheduledTaskInfo | null;
  evening: ScheduledTaskInfo | null;
}

/**
 * 按设置创建或更新两条系统定时任务（agent_prompt）。关闭时只停用不删除，保留历史。
 * 幂等：同一标记只会有一条任务。
 */
export function applyDailyStewardSchedule(
  settings: DailyStewardSettingsInfo = getDailyStewardSettings(),
): StewardScheduleResult {
  const specs: Array<[keyof StewardScheduleResult, StewardTaskSpec]> = [
    ['morning', {
      marker: STEWARD_MORNING_MARKER,
      name: '每日管家·早间简报',
      clock: settings.morningTime,
      prompt: MORNING_BRIEF_PROMPT,
      popupTitle: '早间简报已准备好',
    }],
    ['evening', {
      marker: STEWARD_EVENING_MARKER,
      name: '每日管家·晚间复盘',
      clock: settings.eveningTime,
      prompt: EVENING_REVIEW_PROMPT,
      popupTitle: '晚间复盘已准备好',
    }],
  ];

  const tasks = listScheduledTasks();
  const result: StewardScheduleResult = { morning: null, evening: null };
  let changed = false;

  for (const [slot, spec] of specs) {
    const existing = findStewardTask(tasks, spec.marker);
    if (!settings.enabled) {
      if (existing?.enabled) {
        result[slot] = updateScheduledTask(existing.id, { enabled: false });
        changed = true;
      } else {
        result[slot] = existing ?? null;
      }
      continue;
    }

    const cron = clockToCron(spec.clock);
    const actionPayload = buildPayload(spec, settings);
    if (existing) {
      const unchanged = existing.enabled
        && existing.cron === cron
        && existing.actionPayload === actionPayload
        && existing.name === spec.name
        && existing.scheduleKind === 'recurring';
      result[slot] = unchanged
        ? existing
        : updateScheduledTask(existing.id, {
          name: spec.name,
          scheduleKind: 'recurring',
          cron,
          runAt: null,
          actionType: 'agent_prompt',
          actionPayload,
          enabled: true,
        });
      if (!unchanged) changed = true;
    } else {
      result[slot] = createScheduledTask({
        name: spec.name,
        scheduleKind: 'recurring',
        cron,
        actionType: 'agent_prompt',
        actionPayload,
        enabled: true,
      });
      changed = true;
    }
  }

  if (changed) notifyTasksChanged();
  return result;
}
