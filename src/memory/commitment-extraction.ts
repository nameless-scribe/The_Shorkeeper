import { createCommitment, listCommitments } from '../db/repositories/commitments';
import { parseDueInput } from '../tasks/due-date';
import { clampMemoryConfidence } from './candidate-policy';

/** 低于该置信度的承诺不进入待确认队列，避免把闲聊里的假设当成承诺。 */
export const COMMITMENT_CANDIDATE_CONFIDENCE_THRESHOLD = 0.6;
export const COMMITMENT_TITLE_MAX_LENGTH = 200;
/** 同标题承诺在此窗口内存在（任一状态）则不再重复提出。 */
export const COMMITMENT_DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface CommitmentDraft {
  title: string;
  due: string | null;
  promisedTo: string | null;
  confidence: number;
  reason: string;
}

export function normalizeCommitmentTitle(title: string): string {
  return title.replace(/\s+/g, '').replace(/[。！!，,、；;]/g, '').toLowerCase();
}

/**
 * 从提取模型的 JSON 数组中挑出 type = commitment 的条目；记忆事实由调用方另行处理。
 */
export function parseCommitmentDrafts(items: unknown[]): CommitmentDraft[] {
  const drafts: CommitmentDraft[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type !== 'commitment') continue;
    const title = String(record.title ?? record.content ?? '').trim();
    if (!title) continue;
    drafts.push({
      title: title.slice(0, COMMITMENT_TITLE_MAX_LENGTH),
      due: typeof record.due === 'string' && record.due.trim() ? record.due.trim() : null,
      promisedTo: typeof record.promised_to === 'string' && record.promised_to.trim()
        ? record.promised_to.trim().slice(0, 100)
        : null,
      confidence: clampMemoryConfidence(record.confidence),
      reason: typeof record.reason === 'string' ? record.reason.trim().slice(0, 240) : '',
    });
  }
  return drafts;
}

export interface ProposeCommitmentsResult {
  proposed: number;
  skippedLowConfidence: number;
  skippedDuplicate: number;
}

/**
 * 把对话中识别出的用户承诺写成 proposed 记录，等待用户在简报或下一轮确认。
 * 不创建待办，不覆盖已有承诺；同标题 30 天内已存在（任何状态）则跳过，包括用户已取消的。
 */
export function proposeCommitmentsFromDrafts(
  drafts: CommitmentDraft[],
  context: { sessionId: string; runId?: string | null; now?: number },
): ProposeCommitmentsResult {
  const result: ProposeCommitmentsResult = { proposed: 0, skippedLowConfidence: 0, skippedDuplicate: 0 };
  if (!drafts.length) return result;

  const now = context.now ?? Date.now();
  const existing = listCommitments({ limit: 500 })
    .filter((item) => item.createdAt >= now - COMMITMENT_DEDUP_WINDOW_MS)
    .map((item) => normalizeCommitmentTitle(item.title));
  const seen = new Set(existing);

  for (const draft of drafts) {
    if (draft.confidence < COMMITMENT_CANDIDATE_CONFIDENCE_THRESHOLD) {
      result.skippedLowConfidence += 1;
      continue;
    }
    const key = normalizeCommitmentTitle(draft.title);
    if (!key || seen.has(key)) {
      result.skippedDuplicate += 1;
      continue;
    }
    const due = draft.due ? parseDueInput(draft.due) : null;
    // 模型换算错误得到的过去时间不能写入：确认后会立刻被复盘标为 missed。
    const dueAt = due && due.dueAt >= Date.now() ? due.dueAt : null;
    createCommitment({
      title: draft.title,
      owner: 'user',
      status: 'proposed',
      dueAt,
      promisedTo: draft.promisedTo,
      sourceSessionId: context.sessionId,
      sourceRunId: context.runId ?? null,
    });
    seen.add(key);
    result.proposed += 1;
  }
  return result;
}
