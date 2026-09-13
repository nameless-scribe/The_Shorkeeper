/** 本地日期与截止时间的换算，供待办、承诺与简报共用。 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatLocalDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 校验 YYYY-MM-DD 且日期真实存在；无效返回 null。 */
export function normalizeDateOnly(value: string): string | null {
  const match = value.trim().match(DATE_ONLY);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }
  return match[0];
}

/** 本地日期当天的最后一毫秒。 */
export function localDayEnd(dateOnly: string): number | null {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export interface ParsedDue {
  /** 精确到毫秒的截止时间 */
  dueAt: number;
  /** 对应的本地日期，供待办 due_at 使用 */
  dueDate: string;
}

/**
 * 接受 YYYY-MM-DD（视为当天结束）或带时间的 ISO 本地时间；无效返回 null。
 */
export function parseDueInput(value: string): ParsedDue | null {
  const trimmed = value.trim();
  const dayEnd = localDayEnd(trimmed);
  if (dayEnd != null) {
    return { dueAt: dayEnd, dueDate: trimmed };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return { dueAt: parsed, dueDate: formatLocalDate(new Date(parsed)) };
}

export function addLocalDays(dateOnly: string, days: number): string | null {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return formatLocalDate(new Date(year, month - 1, day + days));
}
