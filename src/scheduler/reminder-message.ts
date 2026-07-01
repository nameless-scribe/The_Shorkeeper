import type { ScheduledTaskInfo } from '../shared/types';
import { getStableSystemPrefix } from '../agent/stable-context';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { formatScheduleLabel } from './format';

const MAX_REMINDER_CHARS = 160;

export function getStaticReminderBody(
  payload: Record<string, unknown>,
  taskName: string,
): string {
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim();
  }
  return taskName;
}

/** 默认开启；任务 payload 设 ai_message: false 可关闭 */
export function shouldGenerateAiReminder(payload: Record<string, unknown>): boolean {
  if (payload.ai_message === false) return false;
  return true;
}

export function normalizeReminderBody(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^["'「『]+|["'」』]+$/gu, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (trimmed.length <= MAX_REMINDER_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_REMINDER_CHARS - 1)}…`;
}

function buildReminderPrompt(task: ScheduledTaskInfo, topic: string): string {
  return [
    '【定时提醒】',
    '你正在为用户触发一条应用内定时提醒。请用守岸人的口吻写一段简短、温暖、有陪伴感的中文提醒。',
    '要求：2–4 句，不超过 120 字；像到点时主动关心对方，不要只重复任务标题；不要 Markdown、不要列表、不要加引号。',
    '',
    `任务名称：${task.name}`,
    `提醒主题：${topic}`,
    `调度：${formatScheduleLabel(task)}`,
  ].join('\n');
}

/**
 * 到点时解析提醒正文：优先 AI 生成，失败或未配置模型时回退静态 message。
 */
export async function resolveReminderBody(
  task: ScheduledTaskInfo,
  payload: Record<string, unknown>,
): Promise<string> {
  const fallback = getStaticReminderBody(payload, task.name);

  if (!shouldGenerateAiReminder(payload)) {
    return fallback;
  }

  const config = getModelConfigSafe();
  if (!config) {
    return fallback;
  }

  try {
    const generated = await completeChat(
      [
        { role: 'system', content: `${getStableSystemPrefix()}\n\n${buildReminderPrompt(task, fallback)}` },
        { role: 'user', content: '请直接输出提醒正文。' },
      ],
      config,
    );

    const normalized = normalizeReminderBody(generated);
    return normalized || fallback;
  } catch (err) {
    console.warn(`[reminder] AI 文案生成失败，使用静态内容：`, err);
    return fallback;
  }
}
