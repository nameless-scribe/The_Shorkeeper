import { getDatabase, type AppDatabase } from '../index';

export interface ProfileEntry {
  key: string;
  value: string;
  updatedAt: number;
}

interface ProfileRow {
  key: string;
  value: string;
  updated_at: number;
}

function rowToEntry(row: ProfileRow): ProfileEntry {
  return { key: row.key, value: row.value, updatedAt: Number(row.updated_at) };
}

export function listProfileEntries(db: AppDatabase = getDatabase()): ProfileEntry[] {
  const rows = db
    .prepare('SELECT key, value, updated_at FROM user_profile ORDER BY key ASC')
    .all() as unknown as ProfileRow[];
  return rows.map(rowToEntry);
}

export function getProfileValue(
  key: string,
  db: AppDatabase = getDatabase(),
): string | undefined {
  const row = db
    .prepare('SELECT value FROM user_profile WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setProfileValue(
  key: string,
  value: string,
  db: AppDatabase = getDatabase(),
): void {
  db.prepare(
    `INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key.trim(), value, Date.now());
}

export function deleteProfileKey(
  key: string,
  db: AppDatabase = getDatabase(),
): boolean {
  const existing = db.prepare('SELECT 1 FROM user_profile WHERE key = ?').get(key);
  if (!existing) return false;
  db.prepare('DELETE FROM user_profile WHERE key = ?').run(key);
  return true;
}
