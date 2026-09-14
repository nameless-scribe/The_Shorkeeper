import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  ProactivityDeliveryChannel,
  ProactivityDeliveryInfo,
  ProactivityDeliveryStatus,
} from '../../shared/types';
import type { ProactivityDeliveryRow } from '../schema';

const CHANNELS: ReadonlySet<string> = new Set<ProactivityDeliveryChannel>(['popup', 'inbox']);
const STATUSES: ReadonlySet<string> = new Set<ProactivityDeliveryStatus>(['planned', 'sent', 'failed', 'cancelled']);
const SUBJECT_KINDS: ReadonlySet<string> = new Set(['event', 'scheduled_reminder', 'steward_notice']);

function rowToDelivery(row: ProactivityDeliveryRow): ProactivityDeliveryInfo {
  return {
    id: String(row.id),
    eventId: row.event_id == null ? null : String(row.event_id),
    deliveryKey: String(row.delivery_key),
    subjectKind: (SUBJECT_KINDS.has(String(row.subject_kind))
      ? String(row.subject_kind)
      : 'event') as ProactivityDeliveryInfo['subjectKind'],
    subjectId: String(row.subject_id),
    channel: (CHANNELS.has(String(row.channel)) ? String(row.channel) : 'inbox') as ProactivityDeliveryChannel,
    status: (STATUSES.has(String(row.status)) ? String(row.status) : 'planned') as ProactivityDeliveryStatus,
    scheduledAt: row.scheduled_at == null ? null : Number(row.scheduled_at),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
    errorCategory: row.error_category == null ? null : String(row.error_category),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const SELECT = `SELECT id, event_id, delivery_key, subject_kind, subject_id, channel, status, scheduled_at, sent_at,
    error_category, created_at, updated_at
  FROM proactivity_deliveries`;

export interface ClaimDeliveryInput {
  deliveryKey: string;
  subjectKind: ProactivityDeliveryInfo['subjectKind'];
  subjectId: string;
  eventId?: string | null;
  channel: ProactivityDeliveryChannel;
  scheduledAt?: number | null;
}

/**
 * 认领一次投递：delivery_key 唯一。已存在时返回 claimed=false，调用方据此不再弹第二次。
 * 认领成功的记录处于 planned，真正发送后再调用 markDeliverySent。
 */
export function claimDelivery(
  input: ClaimDeliveryInput,
  db: AppDatabase = getDatabase(),
): { delivery: ProactivityDeliveryInfo; claimed: boolean } {
  return db.transaction(() => {
    const existing = db
      .prepare(`${SELECT} WHERE delivery_key = ?`)
      .get(input.deliveryKey) as unknown as ProactivityDeliveryRow | undefined;
    if (existing) return { delivery: rowToDelivery(existing), claimed: false };
    const now = Date.now();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO proactivity_deliveries
         (id, event_id, delivery_key, subject_kind, subject_id, channel, status, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
    ).run(
      id,
      input.eventId ?? null,
      input.deliveryKey,
      input.subjectKind,
      input.subjectId,
      input.channel,
      input.scheduledAt ?? null,
      now,
      now,
    );
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as ProactivityDeliveryRow;
    return { delivery: rowToDelivery(row), claimed: true };
  });
}

export function markDeliverySent(
  id: string,
  sentAt = Date.now(),
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo | null {
  db.prepare(`UPDATE proactivity_deliveries SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`)
    .run(sentAt, sentAt, id);
  return getDelivery(id, db);
}

export function markDeliveryFailed(
  id: string,
  errorCategory: string,
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo | null {
  const now = Date.now();
  db.prepare(
    `UPDATE proactivity_deliveries SET status = 'failed', error_category = ?, updated_at = ? WHERE id = ?`,
  ).run(errorCategory.slice(0, 80), now, id);
  return getDelivery(id, db);
}

/** 延后投递仍处于安静时段时只推迟计划时间，不产生新记录。 */
export function rescheduleDelivery(
  id: string,
  scheduledAt: number,
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo | null {
  db.prepare(
    `UPDATE proactivity_deliveries SET scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'planned'`,
  ).run(scheduledAt, Date.now(), id);
  return getDelivery(id, db);
}

export function cancelDelivery(id: string, db: AppDatabase = getDatabase()): ProactivityDeliveryInfo | null {
  const now = Date.now();
  db.prepare(
    `UPDATE proactivity_deliveries SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'planned'`,
  ).run(now, id);
  return getDelivery(id, db);
}

export function getDelivery(id: string, db: AppDatabase = getDatabase()): ProactivityDeliveryInfo | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as ProactivityDeliveryRow | undefined;
  return row ? rowToDelivery(row) : null;
}

export function getDeliveryByKey(
  deliveryKey: string,
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE delivery_key = ?`)
    .get(deliveryKey) as unknown as ProactivityDeliveryRow | undefined;
  return row ? rowToDelivery(row) : null;
}

/** 某个 subject 最近一次成功弹窗的时间：跨重启的"最近通知时间"。 */
export function getLastSentPopupAt(
  subjectKind: ProactivityDeliveryInfo['subjectKind'],
  subjectId: string,
  db: AppDatabase = getDatabase(),
): number | null {
  const row = db
    .prepare(
      `SELECT sent_at FROM proactivity_deliveries
       WHERE subject_kind = ? AND subject_id = ? AND channel = 'popup' AND status = 'sent' AND sent_at IS NOT NULL
       ORDER BY sent_at DESC LIMIT 1`,
    )
    .get(subjectKind, subjectId) as { sent_at: number } | undefined;
  return row?.sent_at == null ? null : Number(row.sent_at);
}

export function getLatestDeliveryForEvent(
  eventId: string,
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE event_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(eventId) as unknown as ProactivityDeliveryRow | undefined;
  return row ? rowToDelivery(row) : null;
}

/**
 * 频率预算：某时间点之后成功发送的**本地事件**弹窗数量。
 * 显式到点提醒与每日管家提示（scheduled_reminder / steward_notice）共用这张账本做跨重启去重，
 * 但不受频率预算约束，也不能占用事件的配额——否则几条整点提醒就会把主动事件全部挤进收件箱。
 */
export function countPopupsSentSince(since: number, db: AppDatabase = getDatabase()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM proactivity_deliveries
       WHERE subject_kind = 'event' AND channel = 'popup' AND status = 'sent' AND sent_at >= ?`,
    )
    .get(since) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

/** 尚未发送的延后投递（安静时段结束后需要补发）。 */
export function listPlannedDeliveries(
  options: { channel?: ProactivityDeliveryChannel; dueBefore?: number; limit?: number } = {},
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo[] {
  const clauses: string[] = [`status = 'planned'`];
  const params: unknown[] = [];
  if (options.channel) {
    clauses.push('channel = ?');
    params.push(options.channel);
  }
  if (options.dueBefore != null) {
    clauses.push('scheduled_at IS NOT NULL AND scheduled_at <= ?');
    params.push(options.dueBefore);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100) || 100));
  const rows = db
    .prepare(`${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY scheduled_at ASC, created_at ASC LIMIT ?`)
    .all(...params, limit) as unknown as ProactivityDeliveryRow[];
  return rows.map(rowToDelivery);
}

export function listDeliveries(
  options: { subjectKind?: ProactivityDeliveryInfo['subjectKind']; subjectId?: string; since?: number; limit?: number } = {},
  db: AppDatabase = getDatabase(),
): ProactivityDeliveryInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.subjectKind) {
    clauses.push('subject_kind = ?');
    params.push(options.subjectKind);
  }
  if (options.subjectId) {
    clauses.push('subject_id = ?');
    params.push(options.subjectId);
  }
  if (options.since != null) {
    clauses.push('created_at >= ?');
    params.push(options.since);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100) || 100));
  const rows = db
    .prepare(`${SELECT}${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as unknown as ProactivityDeliveryRow[];
  return rows.map(rowToDelivery);
}

export function pruneDetachedDeliveries(olderThan: number, db: AppDatabase = getDatabase()): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM proactivity_deliveries WHERE event_id IS NULL AND created_at < ?`)
    .get(olderThan) as { count: number } | undefined;
  db.prepare(`DELETE FROM proactivity_deliveries WHERE event_id IS NULL AND created_at < ?`).run(olderThan);
  return Number(row?.count ?? 0);
}
