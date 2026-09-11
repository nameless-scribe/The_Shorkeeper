import { getDatabase, type AppDatabase } from './index';

export function getSetting(key: string, db: AppDatabase = getDatabase()): string | null {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string, db: AppDatabase = getDatabase()): void {
  const now = Date.now();
  db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now);
}

export function deleteSetting(key: string, db: AppDatabase = getDatabase()): void {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function getJsonSetting<T>(key: string, db: AppDatabase = getDatabase()): T | null {
  const raw = getSetting(key, db);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJsonSetting(
  key: string,
  value: unknown,
  db: AppDatabase = getDatabase(),
): void {
  setSetting(key, JSON.stringify(value), db);
}
