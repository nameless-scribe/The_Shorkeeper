import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import {
  clearAllProactiveEvents,
  countUnreadProactiveEvents,
  expireProactiveEvents,
  findActiveProactiveEventByDedupeKey,
  getProactiveEvent,
  listProactiveEvents,
  markProactiveEventRead,
  pruneHandledProactiveEvents,
  resolveProactiveEventsBySource,
  setProactiveEventStatus,
  upsertProactiveEvent,
  wakeSnoozedProactiveEvents,
  type UpsertProactiveEventInput,
} from '../repositories/proactive-events';
import { countDecisionsByRouteSince, getLatestDecisionForEvent, recordDecision } from '../repositories/proactivity-decisions';
import {
  claimDelivery,
  countPopupsSentSince,
  getLastSentPopupAt,
  listPlannedDeliveries,
  markDeliverySent,
} from '../repositories/proactivity-deliveries';
import { countFeedbackByActionSince, listFeedbackForEvent, recordFeedback } from '../repositories/proactivity-feedback';
import { MAX_EVENT_SUMMARY_CHARS } from '../../proactivity/contract';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

const now = Date.now();

function projected(overrides: Partial<UpsertProactiveEventInput> = {}): UpsertProactiveEventInput {
  return {
    domain: 'task',
    kind: 'task_overdue',
    sourceType: 'user_task',
    sourceId: 'task-1',
    sourceRef: null,
    dedupeKey: 'task:task-1:overdue:2026-09-10',
    sourceVersion: 0,
    title: '已逾期 3 天：写周报',
    summary: '待办「写周报」截止 2026-09-10，仍未完成。',
    urgency: 'normal',
    dueAt: now - 1000,
    occurredAt: now - 1000,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

for (const adapter of adapters) {
  describe(`P3.1 proactive ledger (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-p3-${adapter.name}-`));
      db = await adapter.open(path.join(tempDir, 'p3.db'));
      return db;
    }

    it('applies 0026: four ledger tables plus scheduled task failure columns', async () => {
      const database = await open();
      const tables = database
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'proactiv%' ORDER BY name`)
        .all()
        .map((row) => String(row.name));
      expect(tables).toEqual(['proactive_events', 'proactivity_decisions', 'proactivity_deliveries', 'proactivity_feedback']);
      const columns = database.prepare(`PRAGMA table_info(scheduled_tasks)`).all().map((row) => String(row.name));
      expect(columns).toEqual(expect.arrayContaining(['last_error', 'last_error_at', 'failure_count']));
      const ledger = database
        .prepare(`SELECT status FROM schema_migrations WHERE name = '0026_proactive_events.sql'`)
        .get();
      expect(ledger?.status).toBe('applied');
    });

    it('upserts idempotently by dedupe key and source version, truncating long summaries', async () => {
      const database = await open();
      const first = upsertProactiveEvent(projected({ summary: 'x'.repeat(2_000) }), database);
      expect(first.outcome).toBe('created');
      expect(first.event.summary?.length).toBeLessThanOrEqual(MAX_EVENT_SUMMARY_CHARS);
      const again = upsertProactiveEvent(projected({ summary: 'x'.repeat(2_000) }), database);
      expect(again.outcome).toBe('unchanged');
      expect(again.event.id).toBe(first.event.id);
      const refreshed = upsertProactiveEvent(projected({ summary: 'x'.repeat(2_000), urgency: 'high' }), database);
      expect(refreshed.outcome).toBe('updated');
      expect(refreshed.event.urgency).toBe('high');
      expect(listProactiveEvents({}, database)).toHaveLength(1);
    });

    it('supersedes the active event when the source version changes and keeps dismissed ones dismissed', async () => {
      const database = await open();
      const v1 = upsertProactiveEvent(projected({ dedupeKey: 'doc:d1:changed', sourceVersion: 1, domain: 'document', kind: 'document_changed' }), database);
      const v2 = upsertProactiveEvent(projected({ dedupeKey: 'doc:d1:changed', sourceVersion: 2, domain: 'document', kind: 'document_changed' }), database);
      expect(v2.outcome).toBe('superseded');
      expect(getProactiveEvent(v1.event.id, database)).toMatchObject({ status: 'resolved', resolvedReason: 'superseded' });
      expect(findActiveProactiveEventByDedupeKey('doc:d1:changed', database)?.id).toBe(v2.event.id);

      setProactiveEventStatus(v2.event.id, 'dismissed', { reason: 'not_relevant' }, database);
      const replay = upsertProactiveEvent(projected({ dedupeKey: 'doc:d1:changed', sourceVersion: 2, domain: 'document', kind: 'document_changed' }), database);
      expect(replay.outcome).toBe('unchanged');
      expect(replay.event.status).toBe('dismissed');
      expect(listProactiveEvents({ statuses: ['open'] }, database)).toHaveLength(0);
    });

    it('resolves active events when the source recovers, wakes snoozed ones, and expires stale ones', async () => {
      const database = await open();
      const a = upsertProactiveEvent(projected(), database);
      const b = upsertProactiveEvent(projected({ dedupeKey: 'task:task-2:due:2026-09-13', sourceId: 'task-2' }), database);
      setProactiveEventStatus(b.event.id, 'snoozed', { snoozedUntil: now - 1 }, database);
      expect(resolveProactiveEventsBySource([{ dedupeKey: a.event.dedupeKey }], 'source:task', now, database)).toBe(1);
      expect(getProactiveEvent(a.event.id, database)).toMatchObject({ status: 'resolved', resolvedReason: 'source:task' });
      expect(wakeSnoozedProactiveEvents(now, database).map((event) => event.id)).toEqual([b.event.id]);
      expect(getProactiveEvent(b.event.id, database)?.status).toBe('open');

      const c = upsertProactiveEvent(projected({ dedupeKey: 'task:task-3:due:2026-09-13', sourceId: 'task-3', expiresAt: now - 1 }), database);
      expect(expireProactiveEvents(now, database)).toBe(1);
      expect(getProactiveEvent(c.event.id, database)).toMatchObject({ status: 'resolved', resolvedReason: 'expired' });
      expect(countUnreadProactiveEvents(database)).toBe(1);
      markProactiveEventRead(b.event.id, database);
      expect(countUnreadProactiveEvents(database)).toBe(0);
    });

    it('records decisions and deliveries idempotently and counts popups for the budget', async () => {
      const database = await open();
      const event = upsertProactiveEvent(projected(), database).event;
      const first = recordDecision({
        decisionKey: 'decision:event:e:0:initial', subjectKind: 'event', subjectId: event.id, eventId: event.id,
        policy: 'notify', route: 'notify', reason: 'notified', ruleVersion: 'p3.1', evaluatedAt: now,
      }, database);
      const dup = recordDecision({
        decisionKey: 'decision:event:e:0:initial', subjectKind: 'event', subjectId: event.id, eventId: event.id,
        policy: 'silent', route: 'suppress', reason: 'repeated', ruleVersion: 'p3.1', evaluatedAt: now + 1,
      }, database);
      expect(first.created).toBe(true);
      expect(dup.created).toBe(false);
      expect(dup.decision.route).toBe('notify');
      expect(getLatestDecisionForEvent(event.id, database)?.route).toBe('notify');
      expect(countDecisionsByRouteSince(now - 1, database)).toEqual({ inbox: 0, notify: 1, defer: 0, suppress: 0 });

      const claim = claimDelivery({ deliveryKey: 'delivery:event:e:0:popup:initial', subjectKind: 'event', subjectId: event.id, eventId: event.id, channel: 'popup' }, database);
      expect(claim.claimed).toBe(true);
      expect(claimDelivery({ deliveryKey: 'delivery:event:e:0:popup:initial', subjectKind: 'event', subjectId: event.id, eventId: event.id, channel: 'popup' }, database).claimed).toBe(false);
      expect(getLastSentPopupAt('event', event.id, database)).toBeNull();
      markDeliverySent(claim.delivery.id, now, database);
      expect(getLastSentPopupAt('event', event.id, database)).toBe(now);
      expect(countPopupsSentSince(now - 1, database)).toBe(1);

      const deferred = claimDelivery({ deliveryKey: 'delivery:reminder:t:1', subjectKind: 'scheduled_reminder', subjectId: 't', channel: 'popup', scheduledAt: now + 60_000 }, database);
      expect(deferred.claimed).toBe(true);
      expect(listPlannedDeliveries({ channel: 'popup', dueBefore: now }, database)).toHaveLength(0);
      expect(listPlannedDeliveries({ channel: 'popup', dueBefore: now + 60_000 }, database)).toHaveLength(1);
    });

    it('stores only enumerated feedback and prunes handled events with their ledgers', async () => {
      const database = await open();
      const event = upsertProactiveEvent(projected(), database).event;
      recordFeedback({ eventId: event.id, action: 'opened' }, database);
      recordFeedback({ eventId: event.id, action: 'dismissed', reasonCode: 'too_noisy' }, database);
      expect(() => recordFeedback({ eventId: event.id, action: 'liked' as never }, database)).toThrow();
      expect(() => recordFeedback({ eventId: event.id, action: 'dismissed', reasonCode: '自由文本' as never }, database)).toThrow();
      expect(listFeedbackForEvent(event.id, database).map((item) => item.action)).toEqual(['opened', 'dismissed']);
      expect(countFeedbackByActionSince(now - 1, database)).toMatchObject({ opened: 1, dismissed: 1 });

      setProactiveEventStatus(event.id, 'dismissed', { reason: 'too_noisy', now: now - 100 * 24 * 60 * 60 * 1000 }, database);
      expect(pruneHandledProactiveEvents(now - 90 * 24 * 60 * 60 * 1000, database)).toBe(1);
      expect(getProactiveEvent(event.id, database)).toBeNull();
      expect(listFeedbackForEvent(event.id, database)).toHaveLength(0);

      upsertProactiveEvent(projected(), database);
      expect(clearAllProactiveEvents(database)).toBe(1);
      expect(listProactiveEvents({}, database)).toHaveLength(0);
    });
  });
}
