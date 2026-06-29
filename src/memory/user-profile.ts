import { getDatabase } from '../db';

export interface ProfileEntry {
  key: string;
  value: string;
  updatedAt: number;
}

const PROFILE_LABELS: Record<string, string> = {
  nickname: '称呼',
  'preference.tone': '偏好语气',
  bio: '简介',
  notes: '备注',
};

export function listProfileEntries(): ProfileEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT key, value, updated_at FROM user_profile ORDER BY key ASC')
    .all() as Array<{ key: string; value: string; updated_at: number }>;

  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  }));
}

export function getProfileValue(key: string): string | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM user_profile WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setProfileValue(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key.trim(), value, Date.now());
}

export function deleteProfileKey(key: string): boolean {
  const db = getDatabase();
  const before = db.prepare('SELECT key FROM user_profile WHERE key = ?').get(key);
  if (!before) return false;
  db.prepare('DELETE FROM user_profile WHERE key = ?').run(key);
  return true;
}

/** 格式化为 system prompt 片段 */
export function getProfileSummary(): string | null {
  const entries = listProfileEntries();
  if (!entries.length) return null;

  const lines = entries.map((entry) => {
    const label = PROFILE_LABELS[entry.key] ?? entry.key;
    return `- ${label}：${entry.value}`;
  });

  return `【用户画像】\n${lines.join('\n')}`;
}
