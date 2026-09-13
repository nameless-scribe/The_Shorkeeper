import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  AssistantActionPolicy,
  ProactivityDecisionInfo,
  ProactivityRoute,
} from '../../shared/types';
import type { ProactivityDecisionRow } from '../schema';
import { PROACTIVITY_ROUTES } from '../../proactivity/contract';

const ROUTES: ReadonlySet<string> = new Set(PROACTIVITY_ROUTES);
const POLICIES: ReadonlySet<string> = new Set<AssistantActionPolicy>(['silent', 'notify', 'confirm', 'deny']);
const SUBJECT_KINDS: ReadonlySet<string> = new Set(['event', 'scheduled_reminder', 'steward_notice']);

function rowToDecision(row: ProactivityDecisionRow): ProactivityDecisionInfo {
  return {
    id: String(row.id),
    eventId: row.event_id == null ? null : String(row.event_id),
    decisionKey: String(row.decision_key),
    subjectKind: (SUBJECT_KINDS.has(String(row.subject_kind))
      ? String(row.subject_kind)
      : 'event') as ProactivityDecisionInfo['subjectKind'],
    subjectId: String(row.subject_id),
    policy: (POLICIES.has(String(row.policy)) ? String(row.policy) : 'silent') as AssistantActionPolicy,
    route: (ROUTES.has(String(row.route)) ? String(row.route) : 'suppress') as ProactivityRoute,
    reason: String(row.reason),
    ruleVersion: String(row.rule_version),
    evaluatedAt: Number(row.evaluated_at),
  };
}

const SELECT = `SELECT id, event_id, decision_key, subject_kind, subject_id, policy, route, reason, rule_version, evaluated_at
  FROM proactivity_decisions`;

export interface RecordDecisionInput {
  decisionKey: string;
  subjectKind: ProactivityDecisionInfo['subjectKind'];
  subjectId: string;
  eventId?: string | null;
  policy: AssistantActionPolicy;
  route: ProactivityRoute;
  reason: string;
  ruleVersion: string;
  evaluatedAt?: number;
}

/** 幂等写入：同一 decision_key 已存在时返回现有记录且 created=false。 */
export function recordDecision(
  input: RecordDecisionInput,
  db: AppDatabase = getDatabase(),
): { decision: ProactivityDecisionInfo; created: boolean } {
  return db.transaction(() => {
    const existing = db
      .prepare(`${SELECT} WHERE decision_key = ?`)
      .get(input.decisionKey) as unknown as ProactivityDecisionRow | undefined;
    if (existing) return { decision: rowToDecision(existing), created: false };
    const id = uuidv4();
    db.prepare(
      `INSERT INTO proactivity_decisions
         (id, event_id, decision_key, subject_kind, subject_id, policy, route, reason, rule_version, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.eventId ?? null,
      input.decisionKey,
      input.subjectKind,
      input.subjectId,
      input.policy,
      input.route,
      input.reason,
      input.ruleVersion,
      input.evaluatedAt ?? Date.now(),
    );
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as ProactivityDecisionRow;
    return { decision: rowToDecision(row), created: true };
  });
}

export function getLatestDecisionForEvent(
  eventId: string,
  db: AppDatabase = getDatabase(),
): ProactivityDecisionInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE event_id = ? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1`)
    .get(eventId) as unknown as ProactivityDecisionRow | undefined;
  return row ? rowToDecision(row) : null;
}

export function listDecisions(
  options: { subjectKind?: ProactivityDecisionInfo['subjectKind']; subjectId?: string; since?: number; limit?: number } = {},
  db: AppDatabase = getDatabase(),
): ProactivityDecisionInfo[] {
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
    clauses.push('evaluated_at >= ?');
    params.push(options.since);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100) || 100));
  const rows = db
    .prepare(`${SELECT}${where} ORDER BY evaluated_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as unknown as ProactivityDecisionRow[];
  return rows.map(rowToDecision);
}

export function countDecisionsByRouteSince(
  since: number,
  db: AppDatabase = getDatabase(),
): Record<ProactivityRoute, number> {
  const rows = db
    .prepare(`SELECT route, COUNT(*) AS count FROM proactivity_decisions WHERE evaluated_at >= ? GROUP BY route`)
    .all(since) as Array<{ route: string; count: number }>;
  const result: Record<ProactivityRoute, number> = { inbox: 0, notify: 0, defer: 0, suppress: 0 };
  for (const row of rows) {
    if (ROUTES.has(row.route)) result[row.route as ProactivityRoute] = Number(row.count);
  }
  return result;
}

/** 保留策略：清理没有关联事件（显式提醒 / 管家提示）且过旧的决策。 */
export function pruneDetachedDecisions(olderThan: number, db: AppDatabase = getDatabase()): number {
  const rows = db
    .prepare(`SELECT COUNT(*) AS count FROM proactivity_decisions WHERE event_id IS NULL AND evaluated_at < ?`)
    .get(olderThan) as { count: number } | undefined;
  db.prepare(`DELETE FROM proactivity_decisions WHERE event_id IS NULL AND evaluated_at < ?`).run(olderThan);
  return Number(rows?.count ?? 0);
}
