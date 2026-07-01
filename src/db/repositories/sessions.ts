import { v4 as uuid } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import { clearSessionExtractionState } from '../../memory/extraction-state';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  compressed: boolean;
}

export interface ListSessionsOptions {
  includeArchived?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface SessionListResult {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

function rowToSession(row: {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  archived?: number;
  compressed?: number;
}): Session {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archived: Number(row.archived ?? 0) === 1,
    compressed: Number(row.compressed ?? 0) === 1,
  };
}

const SESSION_SELECT = `s.id, s.title, s.created_at, s.updated_at,
  COALESCE(s.archived, 0) AS archived, COALESCE(s.compressed, 0) AS compressed`;

function buildSessionFilters(options: ListSessionsOptions): {
  where: string;
  params: unknown[];
} {
  const includeArchived = options.includeArchived ?? false;
  const query = options.query?.trim();

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (!includeArchived) {
    where += ' AND COALESCE(s.archived, 0) = 0';
  }

  if (query) {
    where += ` AND (
      s.title LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.session_id = s.id AND m.content LIKE ? ESCAPE '\\'
      )
    )`;
    const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    params.push(pattern, pattern);
  }

  return { where, params };
}

export function createSession(db: AppDatabase = getDatabase(), title = '新对话'): Session {
  const now = Date.now();
  const session: Session = {
    id: uuid(),
    title,
    createdAt: now,
    updatedAt: now,
    archived: false,
    compressed: false,
  };
  db.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at, archived, compressed)
     VALUES (?, ?, ?, ?, 0, 0)`,
  ).run(session.id, session.title, session.createdAt, session.updatedAt);
  return session;
}

export function getSession(id: string, db: AppDatabase = getDatabase()): Session | null {
  const row = db
    .prepare(
      `SELECT id, title, created_at, updated_at,
              COALESCE(archived, 0) AS archived, COALESCE(compressed, 0) AS compressed
       FROM sessions WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  return rowToSession(row as Parameters<typeof rowToSession>[0]);
}

export function listSessions(
  options: ListSessionsOptions = {},
  db: AppDatabase = getDatabase(),
): SessionListResult {
  const limit = Math.max(1, options.limit ?? 50);
  const offset = Math.max(0, options.offset ?? 0);
  const { where, params } = buildSessionFilters(options);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM sessions s ${where}`)
    .get(...params) as { total: number } | undefined;
  const total = Number(countRow?.total ?? 0);

  const rows = db
    .prepare(
      `SELECT ${SESSION_SELECT}
       FROM sessions s
       ${where}
       ORDER BY s.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  const sessions = rows.map((row) => rowToSession(row as Parameters<typeof rowToSession>[0]));

  return {
    sessions,
    total,
    hasMore: offset + sessions.length < total,
  };
}

export function touchSession(id: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateSessionTitle(id: string, title: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    Date.now(),
    id,
  );
}

export function deleteSession(id: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM session_summaries WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  clearSessionExtractionState(id);
}

export interface DeleteEmptySessionsOptions {
  /** 不删除此会话（通常为当前活跃会话） */
  keepSessionId?: string | null;
  /** 额外跳过的会话（如正在运行 Agent 的会话） */
  excludeSessionIds?: string[];
}

export interface DeleteEmptySessionsResult {
  deletedCount: number;
  deletedIds: string[];
  keptSessionId: string | null;
}

/** 删除没有任何消息的会话（用于清理重启产生的空「新对话」） */
export function deleteEmptySessions(
  options: DeleteEmptySessionsOptions = {},
  db: AppDatabase = getDatabase(),
): DeleteEmptySessionsResult {
  const keepId = options.keepSessionId ?? null;
  const exclude = new Set(options.excludeSessionIds ?? []);

  const rows = db
    .prepare(
      `SELECT s.id
       FROM sessions s
       WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id)
       ${keepId ? 'AND s.id != ?' : ''}`,
    )
    .all(...(keepId ? [keepId] : [])) as { id: string }[];

  const deletedIds: string[] = [];
  for (const row of rows) {
    if (exclude.has(row.id)) continue;
    deleteSession(row.id, db);
    deletedIds.push(row.id);
  }

  return {
    deletedCount: deletedIds.length,
    deletedIds,
    keptSessionId: keepId,
  };
}

export function setSessionArchived(id: string, archived: boolean, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?`).run(
    archived ? 1 : 0,
    Date.now(),
    id,
  );
}

export function getOrCreateDefaultSession(db: AppDatabase = getDatabase()): Session {
  const { sessions } = listSessions({ limit: 1 }, db);
  if (sessions.length > 0) return sessions[0];
  return createSession(db);
}
