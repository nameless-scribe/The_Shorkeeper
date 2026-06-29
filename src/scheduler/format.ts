import type { ScheduleKind, ScheduledTaskInfo } from '../shared/types';

export function formatScheduleLabel(task: ScheduledTaskInfo): string {
  if (task.scheduleKind === 'once' && task.runAt) {
    const d = new Date(task.runAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `一次性 · ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `周期 · ${task.cron || '—'}`;
}

/** Dock 横栏用的紧凑时间文案 */
export function formatDockScheduleShort(task: ScheduledTaskInfo): string {
  if (task.scheduleKind === 'once' && task.runAt) {
    const d = new Date(task.runAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return task.cron || '周期';
}

export function sortDockScheduleTasks(tasks: ScheduledTaskInfo[]): ScheduledTaskInfo[] {
  return [...tasks]
    .filter((task) => task.enabled)
    .sort((a, b) => {
      if (a.scheduleKind === 'once' && a.runAt != null && b.scheduleKind === 'once' && b.runAt != null) {
        return a.runAt - b.runAt;
      }
      if (a.scheduleKind === 'once' && a.runAt != null) return -1;
      if (b.scheduleKind === 'once' && b.runAt != null) return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

export function parseRunAtIso(raw: string): number | null {
  const ts = Date.parse(raw.trim());
  if (Number.isNaN(ts)) return null;
  return ts;
}

export function validateScheduleInput(input: {
  scheduleKind: ScheduleKind;
  cron?: string;
  runAt?: number | null;
}): string | null {
  if (input.scheduleKind === 'once') {
    if (!input.runAt) return '一次性任务需要 run_at（执行时间）';
    return null;
  }
  if (!input.cron?.trim()) return '周期任务需要 cron 表达式';
  return null;
}
