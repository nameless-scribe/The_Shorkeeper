import { listMessages } from '../db/repositories/messages';
import {
  getSessionSummary,
  upsertSessionSummary,
  type SessionSummary,
} from '../db/repositories/session-summaries';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { getPerformanceSettings } from '../config/performance';

export { getSessionSummary, type SessionSummary };

function buildSummaryPrompt(existingSummary: string | null): string {
  return `你是会话摘要助手。将以下对话历史压缩为简洁中文摘要，保留关键事实、决定与用户偏好。
${existingSummary ? `\n已有摘要（请合并更新）：\n${existingSummary}\n` : ''}
要求：
1. 200-400 字以内
2. 不要编造未出现的信息
3. 直接输出摘要正文，不要 JSON 或标题`;
}

/** 消息数超阈值时压缩早期对话为 summary */
export async function maybeCompressSession(sessionId: string): Promise<boolean> {
  const config = getModelConfigSafe();
  if (!config) return false;

  const { compressThreshold, maxHistoryMessages } = getPerformanceSettings();
  const all = listMessages(sessionId).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  if (all.length <= compressThreshold) return false;

  const keepCount = maxHistoryMessages;
  const existing = getSessionSummary(sessionId);
  const compressedUpToId = existing?.compressedUpToMessageId;
  let toCompress = all.slice(0, all.length - keepCount);
  if (compressedUpToId) {
    const idx = toCompress.findIndex((m) => m.id === compressedUpToId);
    if (idx >= 0) {
      toCompress = toCompress.slice(idx + 1);
    }
  }
  if (!toCompress.length) return false;

  const dialogue = toCompress
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n');

  const summary = await completeChat(
    [
      { role: 'system', content: buildSummaryPrompt(existing?.summary ?? null) },
      { role: 'user', content: `请摘要以下对话：\n\n${dialogue}` },
    ],
    config,
    { sessionId },
  );

  const trimmed = summary.trim();
  if (!trimmed) return false;

  upsertSessionSummary(sessionId, trimmed, toCompress.at(-1)!.id);
  return true;
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
