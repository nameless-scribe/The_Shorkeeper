import { getDatabase } from '../db';

const KEY_PREFIX = 'memory.extracted_msg.';

export function getExtractedUpToMessageId(sessionId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(`${KEY_PREFIX}${sessionId}`) as { value: string } | undefined;
  return row?.value ?? null;
}

/** 标记该会话已针对此条用户消息做过记忆提取，避免每轮重复调用 LLM */
export function markExtractedUpToMessageId(sessionId: string, messageId: string): void {
  const db = getDatabase();
  const key = `${KEY_PREFIX}${sessionId}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, messageId, now);
}
