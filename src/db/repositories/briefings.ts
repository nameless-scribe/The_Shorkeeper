import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { BriefingInfo, BriefingKind, BriefingStatus } from '../../shared/types';
import type { BriefingRow } from '../schema';

function rowToBriefing(row: BriefingRow): BriefingInfo {
  return {
    id: String(row.id),
    briefDate: String(row.brief_date),
    kind: row.kind === 'evening' ? 'evening' : 'morning',
    runId: row.run_id == null ? null : String(row.run_id),
    status: row.status === 'delivered' || row.status === 'failed' ? row.status : 'generated',
    summary: row.summary == null ? null : String(row.summary),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const SELECT = `SELECT id, brief_date, kind, run_id, status, summary, created_at, updated_at FROM briefings`;

export function getBriefing(
  briefDate: string,
  kind: BriefingKind,
  db: AppDatabase = getDatabase(),
): BriefingInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE brief_date = ? AND kind = ?`)
    .get(briefDate, kind) as unknown as BriefingRow | undefined;
  return row ? rowToBriefing(row) : null;
}

/**
 * 每天每种简报只能有一条记录：已存在则返回 created=false，调用方据此跳过生成。
 */
export function claimBriefing(
  input: { briefDate: string; kind: BriefingKind; runId?: string | null },
  db: AppDatabase = getDatabase(),
): { created: boolean; briefing: BriefingInfo } {
  return db.transaction(() => {
    const existing = getBriefing(input.briefDate, input.kind, db);
    if (existing) return { created: false, briefing: existing };
    const now = Date.now();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO briefings (id, brief_date, kind, run_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'generated', ?, ?)`,
    ).run(id, input.briefDate, input.kind, input.runId ?? null, now, now);
    return { created: true, briefing: getBriefing(input.briefDate, input.kind, db)! };
  });
}

export function updateBriefing(
  id: string,
  patch: { status?: BriefingStatus; summary?: string | null; runId?: string | null },
  db: AppDatabase = getDatabase(),
): BriefingInfo | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as BriefingRow | undefined;
  if (!row) return null;
  const existing = rowToBriefing(row);
  db.prepare(
    `UPDATE briefings SET status = ?, summary = ?, run_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.status ?? existing.status,
    patch.summary !== undefined ? patch.summary : existing.summary,
    patch.runId !== undefined ? patch.runId : existing.runId,
    Date.now(),
    id,
  );
  const updated = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as BriefingRow;
  return rowToBriefing(updated);
}

export function listBriefings(limit = 30, db: AppDatabase = getDatabase()): BriefingInfo[] {
  const rows = db
    .prepare(`${SELECT} ORDER BY brief_date DESC, kind ASC LIMIT ?`)
    .all(Math.max(1, Math.min(365, Math.floor(limit) || 30))) as unknown as BriefingRow[];
  return rows.map(rowToBriefing);
}
