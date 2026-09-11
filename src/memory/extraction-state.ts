import { deleteSetting, getSetting, setSetting } from '../db/app-settings';
import type { AppDatabase } from '../db';

const KEY_PREFIX = 'memory.extracted_msg.';

export function getExtractedUpToMessageId(
  sessionId: string,
  db?: AppDatabase,
): string | null {
  return getSetting(`${KEY_PREFIX}${sessionId}`, db);
}

/** 标记该会话已针对此条用户消息做过记忆提取，避免每轮重复调用 LLM */
export function markExtractedUpToMessageId(
  sessionId: string,
  messageId: string,
  db?: AppDatabase,
): void {
  setSetting(`${KEY_PREFIX}${sessionId}`, messageId, db);
}

export function clearSessionExtractionState(
  sessionId: string,
  db?: AppDatabase,
): void {
  deleteSetting(`${KEY_PREFIX}${sessionId}`, db);
  deleteSetting(`memory.extract_turns.${sessionId}`, db);
}
