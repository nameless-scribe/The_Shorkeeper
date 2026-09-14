import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  ProactiveEventDomain,
  ProactiveEventInfo,
  ProactiveEventKind,
  ProactiveEventStatus,
  ProactiveEventUrgency,
} from '../../shared/types';
import type { ProactiveEventRow } from '../schema';
import {
  PROACTIVE_EVENT_DOMAINS,
  PROACTIVE_EVENT_KINDS,
  PROACTIVE_EVENT_STATUSES,
  PROACTIVE_EVENT_URGENCIES,
  MAX_EVENT_SUMMARY_CHARS,
  MAX_EVENT_TITLE_CHARS,
} from '../../proactivity/contract';

const DOMAINS: ReadonlySet<string> = new Set(PROACTIVE_EVENT_DOMAINS);
const KINDS: ReadonlySet<string> = new Set(PROACTIVE_EVENT_KINDS);
const STATUSES: ReadonlySet<string> = new Set(PROACTIVE_EVENT_STATUSES);
const URGENCIES: ReadonlySet<string> = new Set(PROACTIVE_EVENT_URGENCIES);

/**
 * 由来源恢复 / 新版本自动收口的事件可以重新打开；用户主动忽略或标记完成的不会复活。
 * `expired` 不在其列：过期事件的 expires_at 由 occurred_at 推导，不会因为再次投影而前移，
 * 重开只会在下个周期被再次过期，形成 open / resolved 无限翻转并反复清空已读。
 * 来源真的产生了新状态时 source_version 会变，走的是新建分支，不依赖这里复活。
 */
function isReopenable(event: ProactiveEventInfo): boolean {
  if (event.status !== 'resolved') return false;
  const reason = event.resolvedReason ?? '';
  return reason.startsWith('source:') || reason === 'superseded';
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function rowToEvent(row: ProactiveEventRow): ProactiveEventInfo {
  const text = (value: unknown) => (value == null ? null : String(value));
  const num = (value: unknown) => (value == null ? null : Number(value));
  return {
    id: String(row.id),
    domain: (DOMAINS.has(String(row.domain)) ? String(row.domain) : 'task') as ProactiveEventDomain,
    kind: (KINDS.has(String(row.kind)) ? String(row.kind) : 'task_overdue') as ProactiveEventKind,
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    sourceRef: text(row.source_ref),
    dedupeKey: String(row.dedupe_key),
    sourceVersion: Number(row.source_version ?? 0),
    title: String(row.title),
    summary: text(row.summary),
    urgency: (URGENCIES.has(String(row.urgency)) ? String(row.urgency) : 'normal') as ProactiveEventUrgency,
    status: (STATUSES.has(String(row.status)) ? String(row.status) : 'open') as ProactiveEventStatus,
    dueAt: num(row.due_at),
    occurredAt: Number(row.occurred_at),
    expiresAt: num(row.expires_at),
    snoozedUntil: num(row.snoozed_until),
    resolvedAt: num(row.resolved_at),
    resolvedReason: text(row.resolved_reason),
    readAt: num(row.read_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const SELECT = `SELECT id, domain, kind, source_type, source_id, source_ref, dedupe_key, source_version,
    title, summary, urgency, status, due_at, occurred_at, expires_at, snoozed_until, resolved_at,
    resolved_reason, read_at, created_at, updated_at
  FROM proactive_events`;

export interface UpsertProactiveEventInput {
  domain: ProactiveEventDomain;
  kind: ProactiveEventKind;
  sourceType: string;
  sourceId: string;
  sourceRef?: string | null;
  dedupeKey: string;
  sourceVersion: number;
  title: string;
  summary?: string | null;
  urgency: ProactiveEventUrgency;
  dueAt?: number | null;
  occurredAt: number;
  expiresAt?: number | null;
}

export interface UpsertProactiveEventResult {
  event: ProactiveEventInfo;
  /**
   * created：首次写入；reopened：来源恢复后同一状态再次出现，复用原行；
   * updated：同键同版本刷新；unchanged：已存在且无变化或已处于终态；superseded：旧版本已解决、新版本创建。
   * reopened 与 created 分开，是因为复用原行意味着决策与投递账本里已有首次记录，路由必须换一个 attempt。
   */
  outcome: 'created' | 'reopened' | 'updated' | 'unchanged' | 'superseded';
}

export function getProactiveEvent(id: string, db: AppDatabase = getDatabase()): ProactiveEventInfo | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as ProactiveEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function findProactiveEventByKey(
  dedupeKey: string,
  sourceVersion: number,
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE dedupe_key = ? AND source_version = ?`)
    .get(dedupeKey, sourceVersion) as unknown as ProactiveEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/** 同一 dedupe key 下尚未收口（open / snoozed）的事件，不限版本。 */
export function findActiveProactiveEventByDedupeKey(
  dedupeKey: string,
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE dedupe_key = ? AND status IN ('open', 'snoozed') ORDER BY source_version DESC LIMIT 1`)
    .get(dedupeKey) as unknown as ProactiveEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/**
 * 幂等投影：`dedupe_key + source_version` 唯一。
 * - 同键同版本且仍在活动中：只刷新标题 / 摘要 / 紧急度 / 时间，不改变用户已设置的状态。
 * - 同键同版本且由来源恢复收口：重新打开原行（reopened）。
 * - 同键新版本：把旧的活动事件标记为 resolved（原因 superseded），再创建新事件。
 * - 用户已忽略或已过期收口的同键同版本：保持终态，不复活也不刷新。
 */
export function upsertProactiveEvent(
  input: UpsertProactiveEventInput,
  db: AppDatabase = getDatabase(),
): UpsertProactiveEventResult {
  return db.transaction(() => {
    const now = Date.now();
    const title = truncate(input.title, MAX_EVENT_TITLE_CHARS);
    const summary = input.summary ? truncate(input.summary, MAX_EVENT_SUMMARY_CHARS) : null;
    const existing = findProactiveEventByKey(input.dedupeKey, input.sourceVersion, db);
    if (existing && isReopenable(existing)) {
      // 来源恢复后又出现同一状态（如定时任务再次失败、待办重新打开）：重新打开而不是留在已处理里。
      db.prepare(
        `UPDATE proactive_events
         SET status = 'open', resolved_at = NULL, resolved_reason = NULL, read_at = NULL, snoozed_until = NULL,
             title = ?, summary = ?, urgency = ?, due_at = ?, occurred_at = ?, expires_at = ?, source_ref = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        title,
        summary,
        input.urgency,
        input.dueAt ?? null,
        input.occurredAt,
        input.expiresAt ?? null,
        input.sourceRef ?? existing.sourceRef,
        now,
        existing.id,
      );
      return { event: getProactiveEvent(existing.id, db)!, outcome: 'reopened' as const };
    }
    if (existing) {
      // 已被用户忽略或已过期收口的记录保持终态，也不再刷新内容：它不会回到活动列表，
      // 持续刷新只会让 updated_at 永远前移，把保留策略的清理窗口顶开。
      if (existing.status === 'dismissed' || existing.status === 'resolved') {
        return { event: existing, outcome: 'unchanged' as const };
      }
      const unchanged =
        existing.title === title &&
        existing.summary === summary &&
        existing.urgency === input.urgency &&
        existing.dueAt === (input.dueAt ?? null) &&
        existing.expiresAt === (input.expiresAt ?? null);
      if (unchanged) return { event: existing, outcome: 'unchanged' as const };
      db.prepare(
        `UPDATE proactive_events
         SET title = ?, summary = ?, urgency = ?, due_at = ?, expires_at = ?, source_ref = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        title,
        summary,
        input.urgency,
        input.dueAt ?? null,
        input.expiresAt ?? null,
        input.sourceRef ?? existing.sourceRef,
        now,
        existing.id,
      );
      return { event: getProactiveEvent(existing.id, db)!, outcome: 'updated' as const };
    }

    const active = findActiveProactiveEventByDedupeKey(input.dedupeKey, db);
    let outcome: UpsertProactiveEventResult['outcome'] = 'created';
    if (active && active.sourceVersion !== input.sourceVersion) {
      db.prepare(
        `UPDATE proactive_events SET status = 'resolved', resolved_at = ?, resolved_reason = 'superseded', updated_at = ?
         WHERE id = ?`,
      ).run(now, now, active.id);
      outcome = 'superseded';
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO proactive_events
         (id, domain, kind, source_type, source_id, source_ref, dedupe_key, source_version, title, summary,
          urgency, status, due_at, occurred_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.domain,
      input.kind,
      input.sourceType,
      input.sourceId,
      input.sourceRef ?? null,
      input.dedupeKey,
      input.sourceVersion,
      title,
      summary,
      input.urgency,
      input.dueAt ?? null,
      input.occurredAt,
      input.expiresAt ?? null,
      now,
      now,
    );
    return { event: getProactiveEvent(id, db)!, outcome };
  });
}

export interface ListProactiveEventsOptions {
  statuses?: ProactiveEventStatus[];
  domains?: ProactiveEventDomain[];
  sourceType?: string;
  sourceId?: string;
  /** 只返回 updated_at 不早于该时间戳的事件 */
  updatedSince?: number;
  /** urgency：紧急度优先（默认）；updated：最近变化优先（已处理列表） */
  orderBy?: 'urgency' | 'updated';
  limit?: number;
}

export function listProactiveEvents(
  options: ListProactiveEventsOptions = {},
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.domains?.length) {
    clauses.push(`domain IN (${options.domains.map(() => '?').join(', ')})`);
    params.push(...options.domains);
  }
  if (options.sourceType) {
    clauses.push('source_type = ?');
    params.push(options.sourceType);
  }
  if (options.sourceId) {
    clauses.push('source_id = ?');
    params.push(options.sourceId);
  }
  if (options.updatedSince != null) {
    clauses.push('updated_at >= ?');
    params.push(options.updatedSince);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200) || 200));
  const order = options.orderBy === 'updated'
    ? 'updated_at DESC'
    : `CASE urgency WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, occurred_at DESC`;
  const rows = db
    .prepare(`${SELECT}${where} ORDER BY ${order} LIMIT ?`)
    .all(...params, limit) as unknown as ProactiveEventRow[];
  return rows.map(rowToEvent);
}

/** 活动事件（open / snoozed）的 dedupe key 集合；collector 用它决定哪些旧事件需要因来源恢复而解决。 */
export function listActiveProactiveEventsByDomain(
  domain: ProactiveEventDomain,
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo[] {
  const rows = db
    .prepare(`${SELECT} WHERE domain = ? AND status IN ('open', 'snoozed')`)
    .all(domain) as unknown as ProactiveEventRow[];
  return rows.map(rowToEvent);
}

export function countUnreadProactiveEvents(db: AppDatabase = getDatabase()): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM proactive_events WHERE status = 'open' AND read_at IS NULL`)
    .get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function markProactiveEventRead(id: string, db: AppDatabase = getDatabase()): ProactiveEventInfo | null {
  db.prepare('UPDATE proactive_events SET read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), id);
  return getProactiveEvent(id, db);
}

export function markAllProactiveEventsRead(db: AppDatabase = getDatabase()): number {
  const now = Date.now();
  const rows = db
    .prepare(`SELECT id FROM proactive_events WHERE status = 'open' AND read_at IS NULL`)
    .all() as Array<{ id: string }>;
  if (!rows.length) return 0;
  db.prepare(`UPDATE proactive_events SET read_at = ?, updated_at = ? WHERE status = 'open' AND read_at IS NULL`)
    .run(now, now);
  return rows.length;
}

/**
 * 状态变更统一入口。resolved / dismissed 记录时间和原因；snoozed 记录唤醒时间；
 * 回到 open 时清空 snoozed_until，但保留 read_at 让"已读"不丢失。
 */
export function setProactiveEventStatus(
  id: string,
  status: ProactiveEventStatus,
  options: { reason?: string | null; snoozedUntil?: number | null; now?: number } = {},
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  const existing = getProactiveEvent(id, db);
  if (!existing) return null;
  const now = options.now ?? Date.now();
  const terminal = status === 'resolved' || status === 'dismissed';
  db.prepare(
    `UPDATE proactive_events
     SET status = ?, snoozed_until = ?, resolved_at = ?, resolved_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    status === 'snoozed' ? options.snoozedUntil ?? null : null,
    terminal ? now : null,
    terminal ? options.reason ?? null : null,
    now,
    id,
  );
  return getProactiveEvent(id, db);
}

/** 来源恢复后由 collector 调用：只收口活动事件，不动用户已忽略的记录。 */
export function resolveProactiveEventsBySource(
  keys: Array<{ dedupeKey: string }>,
  reason: string,
  now = Date.now(),
  db: AppDatabase = getDatabase(),
): number {
  let resolved = 0;
  for (const { dedupeKey } of keys) {
    const rows = db
      .prepare(`SELECT id FROM proactive_events WHERE dedupe_key = ? AND status IN ('open', 'snoozed')`)
      .all(dedupeKey) as Array<{ id: string }>;
    for (const row of rows) {
      db.prepare(
        `UPDATE proactive_events SET status = 'resolved', resolved_at = ?, resolved_reason = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, reason, now, row.id);
      resolved += 1;
    }
  }
  return resolved;
}

/** snoozed 且唤醒时间已到的事件回到 open。 */
export function wakeSnoozedProactiveEvents(now = Date.now(), db: AppDatabase = getDatabase()): ProactiveEventInfo[] {
  const rows = db
    .prepare(`${SELECT} WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?`)
    .all(now) as unknown as ProactiveEventRow[];
  const woken: ProactiveEventInfo[] = [];
  for (const row of rows) {
    db.prepare(
      `UPDATE proactive_events SET status = 'open', snoozed_until = NULL, updated_at = ? WHERE id = ?`,
    ).run(now, row.id);
    const updated = getProactiveEvent(String(row.id), db);
    if (updated) woken.push(updated);
  }
  return woken;
}

/** 过期的活动事件转为 resolved（原因 expired），不删除历史。 */
export function expireProactiveEvents(now = Date.now(), db: AppDatabase = getDatabase()): number {
  const rows = db
    .prepare(`SELECT id FROM proactive_events WHERE status IN ('open', 'snoozed') AND expires_at IS NOT NULL AND expires_at <= ?`)
    .all(now) as Array<{ id: string }>;
  if (!rows.length) return 0;
  db.prepare(
    `UPDATE proactive_events SET status = 'resolved', resolved_at = ?, resolved_reason = 'expired', updated_at = ?
     WHERE status IN ('open', 'snoozed') AND expires_at IS NOT NULL AND expires_at <= ?`,
  ).run(now, now, now);
  return rows.length;
}

/** 保留策略：已处理事件超过保留期后连同决策 / 投递 / 反馈一起清理；活动事件永不清理。 */
export function pruneHandledProactiveEvents(
  olderThan: number,
  db: AppDatabase = getDatabase(),
): number {
  return db.transaction(() => {
    const rows = db
      .prepare(`SELECT id FROM proactive_events WHERE status IN ('resolved', 'dismissed') AND updated_at < ?`)
      .all(olderThan) as Array<{ id: string }>;
    for (const row of rows) {
      db.prepare('DELETE FROM proactivity_feedback WHERE event_id = ?').run(row.id);
      db.prepare('DELETE FROM proactivity_deliveries WHERE event_id = ?').run(row.id);
      db.prepare('DELETE FROM proactivity_decisions WHERE event_id = ?').run(row.id);
      db.prepare('DELETE FROM proactive_events WHERE id = ?').run(row.id);
    }
    return rows.length;
  });
}

/** 全局关闭且用户选择不保留历史时清空收件箱；活动事件一并删除，因为关闭后不再投影。 */
export function clearAllProactiveEvents(db: AppDatabase = getDatabase()): number {
  return db.transaction(() => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM proactive_events').get() as { count: number } | undefined;
    db.prepare(`DELETE FROM proactivity_feedback`).run();
    db.prepare(`DELETE FROM proactivity_deliveries WHERE subject_kind = 'event'`).run();
    db.prepare(`DELETE FROM proactivity_decisions WHERE subject_kind = 'event'`).run();
    db.prepare(`DELETE FROM proactive_events`).run();
    return Number(row?.count ?? 0);
  });
}

export function countProactiveEventsCreatedSince(since: number, db: AppDatabase = getDatabase()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM proactive_events WHERE created_at >= ?')
    .get(since) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function countProactiveEventsResolvedBySourceSince(since: number, db: AppDatabase = getDatabase()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM proactive_events
       WHERE status = 'resolved' AND resolved_at >= ? AND resolved_reason LIKE 'source:%'`,
    )
    .get(since) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}
