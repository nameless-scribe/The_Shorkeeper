import type { SqliteDb } from './index';
import {
  SHOREKEEPER_PERSONA,
  PERSONA_SETTING_KEYS,
  SHOREKEEPER_WORLDBOOK,
} from './seeds';

export interface SeedResult {
  personaUpdated: boolean;
  worldbookInserted: number;
  worldbookSkipped: number;
}

/** 若内置人设版本落后，自动升级 app_settings 中的人设（不覆盖用户自定义版本） */
export function ensurePersonaUpToDate(db: SqliteDb): boolean {
  const stored = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(PERSONA_SETTING_KEYS.version) as { value: string } | undefined;

  if (stored?.value === SHOREKEEPER_PERSONA.version) {
    return false;
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PERSONA_SETTING_KEYS.version, SHOREKEEPER_PERSONA.version, now);

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PERSONA_SETTING_KEYS.systemPrompt, SHOREKEEPER_PERSONA.systemPrompt, now);

  return true;
}

/** 幂等写入守岸人人设与 Worldbook 种子 */
export function seedShorekeeper(db: SqliteDb): SeedResult {
  const now = Date.now();
  let worldbookInserted = 0;
  let worldbookSkipped = 0;

  const personaUpdated = ensurePersonaUpToDate(db);

  for (const entry of SHOREKEEPER_WORLDBOOK) {
    const existing = db
      .prepare('SELECT id FROM worldbook_entries WHERE id = ?')
      .get(entry.id);

    if (existing) {
      worldbookSkipped += 1;
      continue;
    }

    db.prepare(
      `INSERT INTO worldbook_entries (id, keys, content, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.keys,
      entry.content,
      entry.priority,
      entry.enabled ? 1 : 0,
      now,
    );
    worldbookInserted += 1;
  }

  return {
    personaUpdated,
    worldbookInserted,
    worldbookSkipped,
  };
}
