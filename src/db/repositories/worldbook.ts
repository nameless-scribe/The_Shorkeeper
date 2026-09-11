import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';

export interface WorldbookEntry {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: boolean;
  createdAt: number;
}

export interface CreateWorldbookEntryInput {
  keys: string;
  content: string;
  priority?: number;
  enabled?: boolean;
  createdAt?: number;
}

export type WorldbookEntryPatch = Partial<
  Pick<WorldbookEntry, 'keys' | 'content' | 'priority' | 'enabled'>
>;

interface WorldbookRow {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: number;
  created_at: number;
}

const WORLDBOOK_SELECT = 'id, keys, content, priority, enabled, created_at';

function rowToEntry(row: WorldbookRow): WorldbookEntry {
  return {
    id: String(row.id),
    keys: String(row.keys),
    content: String(row.content),
    priority: Number(row.priority),
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.created_at),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function listWorldbookEntries(
  includeDisabled = true,
  db: AppDatabase = getDatabase(),
): WorldbookEntry[] {
  const enabledClause = includeDisabled ? '' : 'WHERE enabled = 1';
  const rows = db
    .prepare(
      `SELECT ${WORLDBOOK_SELECT}
       FROM worldbook_entries
       ${enabledClause}
       ORDER BY priority DESC, created_at ASC`,
    )
    .all() as unknown as WorldbookRow[];
  return rows.map(rowToEntry);
}

export function getWorldbookEntry(
  id: string,
  db: AppDatabase = getDatabase(),
): WorldbookEntry | undefined {
  const row = db
    .prepare(`SELECT ${WORLDBOOK_SELECT} FROM worldbook_entries WHERE id = ?`)
    .get(id) as unknown as WorldbookRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function createWorldbookEntry(
  input: CreateWorldbookEntryInput,
  db: AppDatabase = getDatabase(),
): WorldbookEntry {
  const entry: WorldbookEntry = {
    id: uuidv4(),
    keys: input.keys.trim(),
    content: input.content.trim(),
    priority: input.priority ?? 0,
    enabled: input.enabled !== false,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(
    `INSERT INTO worldbook_entries (id, keys, content, priority, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.keys,
    entry.content,
    entry.priority,
    entry.enabled ? 1 : 0,
    entry.createdAt,
  );
  return entry;
}

export function updateWorldbookEntry(
  id: string,
  patch: WorldbookEntryPatch,
  db: AppDatabase = getDatabase(),
): WorldbookEntry | undefined {
  const existing = getWorldbookEntry(id, db);
  if (!existing) return undefined;

  const next: WorldbookEntry = {
    ...existing,
    keys: patch.keys?.trim() ?? existing.keys,
    content: patch.content?.trim() ?? existing.content,
    priority: patch.priority ?? existing.priority,
    enabled: patch.enabled ?? existing.enabled,
  };
  db.prepare(
    `UPDATE worldbook_entries
     SET keys = ?, content = ?, priority = ?, enabled = ?
     WHERE id = ?`,
  ).run(next.keys, next.content, next.priority, next.enabled ? 1 : 0, id);
  return next;
}

export function deleteWorldbookEntry(
  id: string,
  db: AppDatabase = getDatabase(),
): boolean {
  if (!getWorldbookEntry(id, db)) return false;
  db.prepare('DELETE FROM worldbook_entries WHERE id = ?').run(id);
  return true;
}

export function hasWorldbookFts(db: AppDatabase = getDatabase()): boolean {
  try {
    db.prepare('SELECT rowid FROM worldbook_fts LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

/** 返回 null 表示 FTS 不可用或查询失败，空数组表示 FTS 可用但没有命中。 */
export function searchWorldbookFtsIds(
  tokens: string[],
  db: AppDatabase = getDatabase(),
): string[] | null {
  const hitIds = new Set<string>();
  for (const token of tokens) {
    try {
      const rows = db
        .prepare(
          `SELECT e.id
           FROM worldbook_fts f
           JOIN worldbook_entries e ON e.rowid = f.rowid
           WHERE worldbook_fts MATCH ? AND e.enabled = 1`,
        )
        .all(token) as Array<{ id: string }>;
      for (const row of rows) hitIds.add(String(row.id));
    } catch {
      return null;
    }
  }
  return [...hitIds];
}

export function searchWorldbookEntries(
  query: string,
  limit = 5,
  db: AppDatabase = getDatabase(),
): WorldbookEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return listWorldbookEntries(false, db).slice(0, limit);

  const pattern = `%${escapeLikePattern(trimmed)}%`;
  const rows = db
    .prepare(
      `SELECT ${WORLDBOOK_SELECT}
       FROM worldbook_entries
       WHERE enabled = 1
         AND (keys LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
    )
    .all(pattern, pattern, limit) as unknown as WorldbookRow[];
  return rows.map(rowToEntry);
}
