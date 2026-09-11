import { listMessages } from '../db/repositories/messages';
import {
  getSessionSummary,
  upsertSessionSummary,
  type SessionSummary,
} from '../db/repositories/session-summaries';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { getPerformanceSettings } from '../config/performance';
import {
  DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  estimateTokens,
  truncateToTokenBudget,
} from '../agent/context-budget';

export { getSessionSummary, type SessionSummary };

export type SessionCompressionReason =
  | 'model_unavailable'
  | 'below_threshold'
  | 'already_compressed'
  | 'empty_summary'
  | 'compressed';

export interface SessionCompressionResult {
  compressed: boolean;
  reason: SessionCompressionReason;
  messageCount: number;
  compressedMessageCount: number;
}

function buildSummaryPrompt(existingSummary: string | null): string {
  return `你是会话摘要助手。将以下对话历史压缩为简洁中文摘要，保留关键事实、决定与用户偏好。
${existingSummary ? `\n已有摘要（请合并更新）：\n${existingSummary}\n` : ''}
要求：
1. 200-400 字以内
2. 不要编造未出现的信息
3. 直接输出摘要正文，不要 JSON 或标题`;
}

/** 消息数超阈值时压缩早期对话为 summary */
export async function compressSessionIfNeeded(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionCompressionResult> {
  const all = listMessages(sessionId).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );
  const config = getModelConfigSafe();
  if (!config) {
    return {
      compressed: false,
      reason: 'model_unavailable',
      messageCount: all.length,
      compressedMessageCount: 0,
    };
  }

  const {
    compressThreshold,
    maxHistoryMessages,
    contextMaxInputTokens = DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  } = getPerformanceSettings();

  if (all.length <= compressThreshold) {
    return {
      compressed: false,
      reason: 'below_threshold',
      messageCount: all.length,
      compressedMessageCount: 0,
    };
  }

  const existing = getSessionSummary(sessionId);
  const compressedUpToId = existing?.compressedUpToMessageId;
  const compressEnd = Math.max(0, all.length - maxHistoryMessages);
  const checkpointIndex = compressedUpToId
    ? all.findIndex((m) => m.id === compressedUpToId)
    : -1;
  const compressStart = checkpointIndex >= 0 ? checkpointIndex + 1 : 0;
  let toCompress = all.slice(compressStart, compressEnd);
  if (!toCompress.length) {
    return {
      compressed: false,
      reason: 'already_compressed',
      messageCount: all.length,
      compressedMessageCount: 0,
    };
  }

  const existingSummary = existing?.summary
    ? truncateToTokenBudget(existing.summary, 1000)
    : null;
  const systemPrompt = buildSummaryPrompt(existingSummary);
  const sourceBudget = Math.max(
    512,
    Math.min(16_000, contextMaxInputTokens - estimateTokens(systemPrompt) - 1024),
  );
  toCompress = takeCompressionBatch(toCompress, sourceBudget);

  const dialogue = toCompress
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n');

  const summary = await completeChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请摘要以下对话：\n\n${dialogue}` },
    ],
    config,
    { sessionId, signal },
  );

  const trimmed = summary.trim();
  if (!trimmed) {
    return {
      compressed: false,
      reason: 'empty_summary',
      messageCount: all.length,
      compressedMessageCount: toCompress.length,
    };
  }

  upsertSessionSummary(sessionId, trimmed, toCompress.at(-1)!.id);
  return {
    compressed: true,
    reason: 'compressed',
    messageCount: all.length,
    compressedMessageCount: toCompress.length,
  };
}

function takeCompressionBatch<T extends { role: string; content: string }>(
  messages: T[],
  maxTokens: number,
): T[] {
  const selected: T[] = [];
  let used = 0;
  for (const message of messages) {
    const prefix = message.role === 'user' ? '用户：' : '助手：';
    const tokens = estimateTokens(prefix) + estimateTokens(message.content) + 1;
    if (used + tokens <= maxTokens) {
      selected.push(message);
      used += tokens;
      continue;
    }
    if (selected.length === 0) {
      const contentBudget = Math.max(1, maxTokens - estimateTokens(prefix) - 1);
      selected.push({
        ...message,
        content: truncateToTokenBudget(message.content, contentBudget),
      });
    }
    break;
  }
  return selected;
}

export async function maybeCompressSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return (await compressSessionIfNeeded(sessionId, signal)).compressed;
}

export function formatSummaryForPrompt(summary: SessionSummary | null): string | null {
  if (!summary?.summary.trim()) return null;
  return `【此前对话摘要】\n${summary.summary.trim()}`;
}

export function getRecentChatMessages(sessionId: string, limit: number) {
  const all = listMessages(sessionId).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );
  const summary = getSessionSummary(sessionId);
  const checkpointId = summary?.compressedUpToMessageId;
  let recent = all;
  if (checkpointId) {
    const idx = all.findIndex((m) => m.id === checkpointId);
    if (idx >= 0) {
      recent = all.slice(idx + 1);
    }
  }
  return recent.slice(-limit).map((m) => ({ role: m.role, content: m.content }));
}
