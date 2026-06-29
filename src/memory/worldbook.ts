import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';

export interface WorldbookEntry {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: boolean;
  createdAt: number;
}

function rowToEntry(row: {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: number;
  created_at: number;
}): WorldbookEntry {
  return {
    id: row.id,
    keys: row.keys,
    content: row.content,
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export function listWorldbookEntries(includeDisabled = true): WorldbookEntry[] {
  const db = getDatabase();
  const sql = includeDisabled
    ? `SELECT id, keys, content, priority, enabled, created_at
       FROM worldbook_entries
       ORDER BY priority DESC, created_at ASC`
    : `SELECT id, keys, content, priority, enabled, created_at
       FROM worldbook_entries
       WHERE enabled = 1
       ORDER BY priority DESC, created_at ASC`;

  const rows = db.prepare(sql).all() as Array<{
    id: string;
    keys: string;
    content: string;
    priority: number;
    enabled: number;
    created_at: number;
  }>;

  return rows.map(rowToEntry);
}

export function getWorldbookEntry(id: string): WorldbookEntry | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, keys, content, priority, enabled, created_at
       FROM worldbook_entries WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        keys: string;
        content: string;
        priority: number;
        enabled: number;
        created_at: number;
      }
    | undefined;

  return row ? rowToEntry(row) : undefined;
}

export function createWorldbookEntry(input: {
  keys: string;
  content: string;
  priority?: number;
  enabled?: boolean;
}): WorldbookEntry {
  const db = getDatabase();
  const id = uuidv4();
  const now = Date.now();

  db.prepare(
    `INSERT INTO worldbook_entries (id, keys, content, priority, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.keys.trim(),
    input.content.trim(),
    input.priority ?? 0,
    input.enabled === false ? 0 : 1,
    now,
  );

  return {
    id,
    keys: input.keys.trim(),
    content: input.content.trim(),
    priority: input.priority ?? 0,
    enabled: input.enabled !== false,
    createdAt: now,
  };
}

export function updateWorldbookEntry(
  id: string,
  patch: Partial<Pick<WorldbookEntry, 'keys' | 'content' | 'priority' | 'enabled'>>,
): WorldbookEntry | undefined {
  const existing = getWorldbookEntry(id);
  if (!existing) return undefined;

  const next = {
    keys: patch.keys?.trim() ?? existing.keys,
    content: patch.content?.trim() ?? existing.content,
    priority: patch.priority ?? existing.priority,
    enabled: patch.enabled ?? existing.enabled,
  };

  const db = getDatabase();
  db.prepare(
    `UPDATE worldbook_entries
     SET keys = ?, content = ?, priority = ?, enabled = ?
     WHERE id = ?`,
  ).run(next.keys, next.content, next.priority, next.enabled ? 1 : 0, id);

  return { ...existing, ...next };
}

export function deleteWorldbookEntry(id: string): boolean {
  const db = getDatabase();
  const existing = getWorldbookEntry(id);
  if (!existing) return false;
  db.prepare('DELETE FROM worldbook_entries WHERE id = ?').run(id);
  return true;
}

function parseKeys(keys: string): string[] {
  return keys
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function hasFts5Table(): boolean {
  try {
    getDatabase().prepare('SELECT rowid FROM worldbook_fts LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

function matchWorldbookFts(userMessage: string, limit: number): WorldbookEntry[] {
  const db = getDatabase();
  const tokens = userMessage
    .split(/[\s,，。！？、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

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
      for (const row of rows) {
        hitIds.add(row.id);
      }
    } catch {
      return matchWorldbookKeywords(userMessage, limit);
    }
  }

  if (!hitIds.size) {
    return matchWorldbookKeywords(userMessage, limit);
  }

  const entries = listWorldbookEntries(false).filter((e) => hitIds.has(e.id));
  return entries.slice(0, limit);
}

function matchWorldbookKeywords(userMessage: string, limit: number): WorldbookEntry[] {
  const message = userMessage.toLowerCase();
  const entries = listWorldbookEntries(false);

  const hits = entries.filter((entry) =>
    parseKeys(entry.keys).some((key) => message.includes(key.toLowerCase())),
  );

  return hits.slice(0, limit);
}

/** 根据用户消息匹配 Worldbook 条目（FTS5 可用时优先，否则关键词匹配） */
export function matchWorldbook(userMessage: string, limit = 5): WorldbookEntry[] {
  if (!userMessage.trim()) return [];
  if (hasFts5Table()) {
    return matchWorldbookFts(userMessage, limit);
  }
  return matchWorldbookKeywords(userMessage, limit);
}

export function searchWorldbook(query: string, limit = 5): WorldbookEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return listWorldbookEntries(false).slice(0, limit);

  const pattern = `%${trimmed}%`;
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, keys, content, priority, enabled, created_at
       FROM worldbook_entries
       WHERE enabled = 1 AND (keys LIKE ? OR content LIKE ?)
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
    )
    .all(pattern, pattern, limit) as Array<{
    id: string;
    keys: string;
    content: string;
    priority: number;
    enabled: number;
    created_at: number;
  }>;

  return rows.map(rowToEntry);
}

export function formatWorldbookForPrompt(entries: WorldbookEntry[]): string | null {
  if (!entries.length) return null;
  const blocks = entries.map((entry) => `（关键词：${entry.keys}）\n${entry.content}`);
  return `【世界观 / 背景】\n${blocks.join('\n\n')}`;
}
