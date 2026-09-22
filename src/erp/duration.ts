const CHINESE_NUMBER: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8,
};

function integerHours(value: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (Object.hasOwn(CHINESE_NUMBER, value)) return CHINESE_NUMBER[value];
  return null;
}

/** 只解析明确时长；“上午/半天/三四小时/大约”留给 ask_user。 */
export function parseExplicitDurationMinutes(raw: string): number | null {
  const value = raw.trim().replaceAll(' ', '');
  if (!value || /(大约|左右|差不多|将近|约|上午|下午|半天|全天|\d[-~～至]\d)/.test(value)) return null;
  if (value === '半小时') return 30;
  const half = value.match(/^([一二两三四五六七八]|\d+)个?半小时$/);
  if (half) {
    const hours = integerHours(half[1]);
    return hours == null ? null : hours * 60 + 30;
  }
  const hoursMatch = value.match(/^([一二两三四五六七八]|\d+(?:\.\d+)?)个?(?:小时|钟头)$/);
  if (!hoursMatch) return null;
  const hours = integerHours(hoursMatch[1]);
  if (hours == null || !Number.isFinite(hours)) return null;
  const minutes = hours * 60;
  return Number.isInteger(minutes) ? minutes : null;
}

