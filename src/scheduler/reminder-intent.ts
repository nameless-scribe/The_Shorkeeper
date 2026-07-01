export type ScheduleReminderIntent =
  | { triggered: false }
  | { triggered: true; action: 'create'; scheduleKind: 'recurring' | 'once'; cron?: string; runAt?: number; name: string; message: string }
  | { triggered: true; action: 'list' }
  | { triggered: true; action: 'delete'; nameHint: string };

const REMINDER_VERB = /(?:提醒|叫我|通知|闹钟|到点(?:提醒|通知|叫)?)/;
const RECURRING_HINT = /(?:每天|每日|天天|每个工作日|工作日)/;
const QUESTION_HINT = /(?:怎么|如何|什么是|能不能|可以吗|为什么|有没有|是否)/;
const LIST_HINT = /(?:列出|查看|有哪些|看看).{0,8}(?:定时|提醒|任务)|(?:定时|提醒|任务).{0,8}(?:列表|清单)/;
const DELETE_HINT = /(?:取消|删除|关掉|停止|移除).{0,12}(?:提醒|定时|任务)/;

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseCnNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const rest = s.slice(1);
    if (!rest) return 10;
    return 10 + (CN_DIGITS[rest] ?? 0);
  }
  if (s.endsWith('十')) {
    const head = s.slice(0, -1);
    return (CN_DIGITS[head] ?? 0) * 10;
  }
  const tenIdx = s.indexOf('十');
  if (tenIdx > 0) {
    const tens = CN_DIGITS[s.slice(0, tenIdx)] ?? 0;
    const ones = CN_DIGITS[s.slice(tenIdx + 1)] ?? 0;
    return tens * 10 + ones;
  }
  return CN_DIGITS[s] ?? null;
}

function applyDayPeriod(hour: number, text: string): number {
  if (/(?:下午|晚上|傍晚)/.test(text) && hour >= 1 && hour <= 11) return hour + 12;
  if (/凌晨/.test(text) && hour === 12) return 0;
  if (/(?:上午|早上|清晨)/.test(text) && hour === 12) return 0;
  return hour;
}

/** 从中文或数字时间表达解析小时、分钟 */
export function parseReminderClock(text: string): { hour: number; minute: number } | null {
  const digital = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (digital) {
    const hour = applyDayPeriod(parseInt(digital[1], 10), text);
    const minute = parseInt(digital[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  const cnMatch = text.match(
    /(?:上午|下午|早上|晚上|傍晚|凌晨)?\s*([零一二两三四五六七八九十\d]+)\s*点\s*(半|([零一二两三四五六七八九十\d]+)\s*分)?/,
  );
  if (!cnMatch) return null;

  const hourRaw = parseCnNumber(cnMatch[1]);
  if (hourRaw === null || hourRaw < 0 || hourRaw > 23) return null;

  let minute = 0;
  if (cnMatch[2] === '半') {
    minute = 30;
  } else if (cnMatch[3]) {
    const parsedMinute = parseCnNumber(cnMatch[3]);
    if (parsedMinute === null || parsedMinute < 0 || parsedMinute > 59) return null;
    minute = parsedMinute;
  }

  const hour = applyDayPeriod(hourRaw, text);
  return { hour, minute };
}

export function buildDailyCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

function extractReminderMessage(text: string): string {
  const afterVerb = text.match(/(?:提醒我|叫我|通知我|到点提醒(?:我)?)\s*([^。！!？?\n]+)/);
  if (afterVerb?.[1]) {
    return afterVerb[1]
      .trim()
      .replace(/[哦啊呢吧了]+$/u, '')
      .replace(/[，,。.!！?？]+$/u, '')
      .trim();
  }
  return '到点提醒';
}

function extractTaskName(text: string, message: string): string {
  if (/下班/.test(text)) return '下班提醒';
  if (message.length > 0 && message.length <= 16) return message;
  if (message.length > 16) return `${message.slice(0, 16)}…`;
  return '定时提醒';
}

function buildOnceRunAt(text: string, hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setSeconds(0, 0);

  if (/后天/.test(text)) {
    target.setDate(target.getDate() + 2);
  } else if (/明天/.test(text)) {
    target.setDate(target.getDate() + 1);
  }

  target.setHours(hour, minute, 0, 0);

  if (!/明天|后天/.test(text) && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

function extractDeleteNameHint(text: string): string {
  const m = text.match(/(?:取消|删除|关掉|停止|移除)\s*(?:一下\s*)?(.{0,20}?)(?:提醒|定时|任务)/);
  const hint = m?.[1]?.trim().replace(/[的了吗呢吧]+$/u, '');
  if (hint && hint.length >= 2) return hint;
  if (/下班/.test(text)) return '下班';
  return '提醒';
}

/** 检测用户是否明确要求创建/管理应用内定时提醒（不依赖 LLM tool call） */
export function parseScheduleReminderIntent(message: string): ScheduleReminderIntent {
  const trimmed = message.trim();
  if (!trimmed) return { triggered: false };

  if (LIST_HINT.test(trimmed)) {
    return { triggered: true, action: 'list' };
  }

  if (DELETE_HINT.test(trimmed)) {
    return { triggered: true, action: 'delete', nameHint: extractDeleteNameHint(trimmed) };
  }

  if (!REMINDER_VERB.test(trimmed)) {
    return { triggered: false };
  }

  if (QUESTION_HINT.test(trimmed) && !/(?:帮我|给我|请|设置|创建|添加)/.test(trimmed)) {
    return { triggered: false };
  }

  const clock = parseReminderClock(trimmed);
  if (!clock) {
    return { triggered: false };
  }

  const messageText = extractReminderMessage(trimmed);
  const name = extractTaskName(trimmed, messageText);
  const recurring = RECURRING_HINT.test(trimmed) || !/(?:明天|后天|今天|今晚|明早)/.test(trimmed);

  if (recurring) {
    return {
      triggered: true,
      action: 'create',
      scheduleKind: 'recurring',
      cron: buildDailyCron(clock.hour, clock.minute),
      name,
      message: messageText,
    };
  }

  return {
    triggered: true,
    action: 'create',
    scheduleKind: 'once',
    runAt: buildOnceRunAt(trimmed, clock.hour, clock.minute),
    name,
    message: messageText,
  };
}
