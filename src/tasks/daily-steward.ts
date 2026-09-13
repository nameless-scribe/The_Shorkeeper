import { listUserTasks } from '../db/user-tasks';
import { listEnabledScheduledTasks } from '../db/scheduled-tasks';
import { getProfileValue } from '../db/repositories/user-profile';
import { getGoalProgress, listGoals } from '../db/repositories/goals';
import { listCommitments, markMissedCommitments } from '../db/repositories/commitments';
import { listArtifactsSince, listTaskRuns } from '../db/repositories/task-runs';
import { listProactiveEvents } from '../db/repositories/proactive-events';
import { countFeedbackByActionSince } from '../db/repositories/proactivity-feedback';
import { EVENT_DOMAIN_LABELS, EVENT_KIND_LABELS } from '../proactivity/contract';
import { formatScheduleLabel } from '../scheduler/format';
import type {
  ArtifactInfo,
  CommitmentInfo,
  GoalInfo,
  GoalProgress,
  ProactiveEventInfo,
  ScheduledTaskInfo,
  TaskRunInfo,
  UserTaskInfo,
} from '../shared/types';
import { addLocalDays, formatLocalDate, localDayEnd } from './due-date';

/** 用户画像里可能存放城市的键；找到第一个非空值。 */
const CITY_PROFILE_KEYS = ['user.city', 'city', '城市', 'location'];
const DUE_SOON_DAYS = 2;
const MAX_PROPOSED = 3;
/** 早间简报只带高价值的主动事件：待办 / 承诺已经单独列出，这里聚焦运行、定时任务、文档、记忆与目标。 */
const MAX_BRIEF_EVENTS = 8;
const BRIEF_EVENT_DOMAINS = ['run', 'schedule', 'document', 'memory', 'goal'] as const;

export const MORNING_BRIEF_PROMPT =
  '【每日管家】请生成今天的早间简报。先调用 build_daily_brief 取得今日数据；若返回今天已生成过，只简短说明一句即可。' +
  '若数据里给出了天气城市，再调用 get_weather 查询。然后按“天气 → 逾期与今日待办 → 今日提醒 → 到期承诺 → 待确认承诺 → 目标进度”组织，' +
  '最后问我今天是否要调整安排。不要在我确认前修改任何待办、承诺或提醒。';

export const EVENING_REVIEW_PROMPT =
  '【每日管家】请做今天的晚间复盘。先调用 build_evening_review 取得今日数据；若返回今天已生成过，只简短说明一句即可。' +
  '逐项确认未完成的待办是顺延、取消还是继续；对每条“已完成”只能引用数据里的工具结果或产物，没有证据的不要说成已完成。' +
  '被标为 missed 的承诺请问我如何处理。只在我确认后才修改待办、承诺或提醒。';

function localDayStart(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatLocalDate(date)} ${formatClock(timestamp)}`;
}

export function resolveWeatherCity(): string | null {
  for (const key of CITY_PROFILE_KEYS) {
    try {
      const value = getProfileValue(key)?.trim();
      if (value) return value;
    } catch {
      return null;
    }
  }
  return null;
}

export interface MorningBriefData {
  date: string;
  weatherCity: string | null;
  overdueTasks: UserTaskInfo[];
  todayTasks: UserTaskInfo[];
  onceRemindersToday: ScheduledTaskInfo[];
  recurringReminders: ScheduledTaskInfo[];
  dueCommitments: CommitmentInfo[];
  proposedCommitments: CommitmentInfo[];
  goals: Array<GoalInfo & { progress: GoalProgress }>;
  /** P3：收件箱里尚未处理的高价值本地事件（不含待办 / 承诺，避免与上面重复） */
  pendingEvents: ProactiveEventInfo[];
}

function safeListPendingEvents(): ProactiveEventInfo[] {
  try {
    return listProactiveEvents({ statuses: ['open'], domains: [...BRIEF_EVENT_DOMAINS], limit: 50 })
      .filter((event) => event.urgency !== 'low')
      .slice(0, MAX_BRIEF_EVENTS);
  } catch (error) {
    console.warn('[steward] 读取主动事件失败:', error instanceof Error ? error.message : error);
    return [];
  }
}

export function buildMorningBriefData(now = new Date()): MorningBriefData {
  const date = formatLocalDate(now);
  const dayStart = localDayStart(date);
  const dayEnd = localDayEnd(date)!;
  const openStatuses = ['pending', 'in_progress'] as const;

  const dueTasks = listUserTasks({ statuses: [...openStatuses], dueOnOrBefore: date });
  const overdueTasks = dueTasks.filter((task) => task.dueAt! < date);
  const todayTasks = dueTasks.filter((task) => task.dueAt === date);

  const reminders = listEnabledScheduledTasks();
  const onceRemindersToday = reminders.filter(
    (task) => task.scheduleKind === 'once' && task.runAt != null && task.runAt >= dayStart && task.runAt <= dayEnd,
  );
  const recurringReminders = reminders.filter((task) => task.scheduleKind === 'recurring');

  const soonDate = addLocalDays(date, DUE_SOON_DAYS) ?? date;
  const dueCommitments = listCommitments({ status: 'open', dueBefore: localDayEnd(soonDate) ?? dayEnd });
  const proposedCommitments = listCommitments({ status: 'proposed', limit: MAX_PROPOSED });

  const goals = listGoals({ status: 'active' }).map((goal) => ({
    ...goal,
    progress: getGoalProgress(goal.id),
  }));

  return {
    date,
    weatherCity: resolveWeatherCity(),
    overdueTasks,
    todayTasks,
    onceRemindersToday,
    recurringReminders,
    dueCommitments,
    proposedCommitments,
    goals,
    pendingEvents: safeListPendingEvents(),
  };
}

function eventLine(event: ProactiveEventInfo): string {
  return `- [${EVENT_DOMAIN_LABELS[event.domain]}·${EVENT_KIND_LABELS[event.kind]}] ${event.title}${event.urgency === 'high' ? '（紧急）' : ''}`;
}

function taskLine(task: UserTaskInfo): string {
  return `- ${task.title}${task.dueAt ? `（截止 ${task.dueAt}）` : ''}${task.module ? `［${task.module}］` : ''} (id: ${task.id})`;
}

function commitmentLine(item: CommitmentInfo): string {
  const owner = item.owner === 'assistant' ? '（助理）' : '';
  const due = item.dueAt != null ? `，截止 ${formatDateTime(item.dueAt)}` : '';
  const to = item.promisedTo ? `，答应了 ${item.promisedTo}` : '';
  return `- ${owner}${item.title}${due}${to} (id: ${item.id})`;
}

export function formatMorningBrief(data: MorningBriefData): string {
  const sections: string[] = [`【早间简报数据 ${data.date}】`];

  sections.push(
    data.weatherCity
      ? `天气：城市「${data.weatherCity}」，请调用 get_weather 工具查询后写入简报。`
      : '天气：用户画像未设置城市（键 user.city），本次跳过；可在简报末尾问一次用户所在城市。',
  );

  sections.push(
    data.overdueTasks.length
      ? `逾期待办（${data.overdueTasks.length}）：\n${data.overdueTasks.map(taskLine).join('\n')}`
      : '逾期待办：无',
  );
  sections.push(
    data.todayTasks.length
      ? `今日到期待办（${data.todayTasks.length}）：\n${data.todayTasks.map(taskLine).join('\n')}`
      : '今日到期待办：无',
  );

  const reminderLines = [
    ...data.onceRemindersToday.map((task) => `- ${task.name}（今天 ${formatClock(task.runAt!)}）`),
    ...data.recurringReminders.map((task) => `- ${task.name}（${formatScheduleLabel(task)}）`),
  ];
  sections.push(reminderLines.length ? `今日提醒：\n${reminderLines.join('\n')}` : '今日提醒：无');

  sections.push(
    data.dueCommitments.length
      ? `${DUE_SOON_DAYS} 天内到期的承诺（${data.dueCommitments.length}）：\n${data.dueCommitments.map(commitmentLine).join('\n')}`
      : `${DUE_SOON_DAYS} 天内到期的承诺：无`,
  );
  sections.push(
    data.proposedCommitments.length
      ? `待确认的承诺（请逐条问用户是否加入待办）：\n${data.proposedCommitments.map(commitmentLine).join('\n')}`
      : '待确认的承诺：无',
  );

  sections.push(
    data.goals.length
      ? `目标进度：\n${data.goals
        .map((goal) => `- ${goal.title}：待办 ${goal.progress.doneTasks}/${goal.progress.totalTasks}，未完成承诺 ${goal.progress.openCommitments}${goal.targetDate ? `，目标日期 ${goal.targetDate}` : ''}`)
        .join('\n')}`
      : '目标进度：当前没有进行中的目标',
  );

  sections.push(
    data.pendingEvents.length
      ? `待处理的主动提示（${data.pendingEvents.length}，来自主动收件箱，处理后自动消失）：\n${data.pendingEvents.map(eventLine).join('\n')}`
      : '待处理的主动提示：无',
  );

  return sections.join('\n\n');
}

export function summarizeMorningBrief(data: MorningBriefData): string {
  return `逾期 ${data.overdueTasks.length}，今日 ${data.todayTasks.length}，提醒 ${data.onceRemindersToday.length + data.recurringReminders.length}，到期承诺 ${data.dueCommitments.length}，待确认 ${data.proposedCommitments.length}，目标 ${data.goals.length}，主动提示 ${data.pendingEvents.length}`;
}

export interface EveningReviewData {
  date: string;
  doneToday: UserTaskInfo[];
  unfinishedDue: UserTaskInfo[];
  missedCommitments: CommitmentInfo[];
  completedCommitments: CommitmentInfo[];
  runsToday: TaskRunInfo[];
  artifactsToday: ArtifactInfo[];
  /** P3：今天对主动提示的处理情况 */
  eventsHandledToday: { resolved: number; dismissed: number; snoozed: number; accepted: number };
  eventsStillOpen: number;
}

function safeEventStats(dayStart: number): Pick<EveningReviewData, 'eventsHandledToday' | 'eventsStillOpen'> {
  try {
    const feedback = countFeedbackByActionSince(dayStart);
    const open = listProactiveEvents({ statuses: ['open'], limit: 500 }).length;
    return {
      eventsHandledToday: {
        resolved: feedback.resolved,
        dismissed: feedback.dismissed,
        snoozed: feedback.snoozed,
        accepted: feedback.accepted,
      },
      eventsStillOpen: open,
    };
  } catch (error) {
    console.warn('[steward] 读取主动事件统计失败:', error instanceof Error ? error.message : error);
    return { eventsHandledToday: { resolved: 0, dismissed: 0, snoozed: 0, accepted: 0 }, eventsStillOpen: 0 };
  }
}

/** 晚间复盘数据；会把到期仍 open 的承诺标为 missed（这是复盘唯一的写操作）。 */
export function buildEveningReviewData(now = new Date()): EveningReviewData {
  const date = formatLocalDate(now);
  const dayStart = localDayStart(date);

  const doneToday = listUserTasks({ status: 'done', updatedSince: dayStart });
  const unfinishedDue = listUserTasks({ statuses: ['pending', 'in_progress'], dueOnOrBefore: date });

  markMissedCommitments(now.getTime());
  const missedCommitments = listCommitments({ status: 'missed' }).filter(
    (item) => (item.closedAt ?? 0) >= dayStart,
  );
  const completedCommitments = listCommitments({ status: 'done' }).filter(
    (item) => (item.closedAt ?? 0) >= dayStart,
  );

  const runsToday = listTaskRuns({ since: dayStart, limit: 200 });
  const artifactsToday = listArtifactsSince(dayStart, 200);

  return {
    date,
    doneToday,
    unfinishedDue,
    missedCommitments,
    completedCommitments,
    runsToday,
    artifactsToday,
    ...safeEventStats(dayStart),
  };
}

export function formatEveningReview(data: EveningReviewData): string {
  const sections: string[] = [`【晚间复盘数据 ${data.date}】`];

  sections.push(
    data.doneToday.length
      ? `今日完成的待办（${data.doneToday.length}）：\n${data.doneToday.map(taskLine).join('\n')}`
      : '今日完成的待办：无',
  );
  sections.push(
    data.unfinishedDue.length
      ? `到期未完成的待办（${data.unfinishedDue.length}，请逐项问顺延/取消/继续）：\n${data.unfinishedDue.map(taskLine).join('\n')}`
      : '到期未完成的待办：无',
  );
  sections.push(
    data.completedCommitments.length
      ? `今日兑现的承诺：\n${data.completedCommitments.map((item) => `${commitmentLine(item)}${item.evidenceRunId ? `，证据 run ${item.evidenceRunId}` : ''}`).join('\n')}`
      : '今日兑现的承诺：无',
  );
  sections.push(
    data.missedCommitments.length
      ? `今日错过的承诺（请问用户如何处理）：\n${data.missedCommitments.map(commitmentLine).join('\n')}`
      : '今日错过的承诺：无',
  );

  const finishedRuns = data.runsToday.filter((run) => run.phase === 'finished').length;
  const failedRuns = data.runsToday.filter((run) => run.phase === 'error' || run.phase === 'interrupted').length;
  sections.push(
    `今日运行：${data.runsToday.length} 次，其中完成 ${finishedRuns}，失败或中断 ${failedRuns}。`,
  );
  sections.push(
    data.artifactsToday.length
      ? `今日产物（可作为“已完成”的证据）：\n${data.artifactsToday.map((artifact) => `- ${artifact.relativePath}（${artifact.toolName}，${formatClock(artifact.createdAt)}）`).join('\n')}`
      : '今日产物：无。没有产物或工具结果支撑的事项不要说成已完成。',
  );

  const handled = data.eventsHandledToday;
  sections.push(
    `主动提示：今日处理 ${handled.resolved + handled.accepted} 条，忽略 ${handled.dismissed} 条，延后 ${handled.snoozed} 条；仍待处理 ${data.eventsStillOpen} 条。这些只是提示，真实进度以待办、承诺和运行记录为准。`,
  );

  return sections.join('\n\n');
}

export function summarizeEveningReview(data: EveningReviewData): string {
  return `完成 ${data.doneToday.length}，未完成 ${data.unfinishedDue.length}，兑现承诺 ${data.completedCommitments.length}，错过 ${data.missedCommitments.length}，产物 ${data.artifactsToday.length}`;
}
