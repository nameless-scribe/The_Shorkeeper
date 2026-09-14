/**
 * 只读快照：从各领域 Repository 读取投影所需的最小数据，带数量上限。
 * 不写任何领域表，不复制正文内容。
 */
import type { AppDatabase } from '../db/contracts';
import { getDatabase } from '../db';
import { listUserTasks } from '../db/user-tasks';
import { listCommitments } from '../db/repositories/commitments';
import { listTaskRuns } from '../db/repositories/task-runs';
import { listScheduledTasks } from '../db/scheduled-tasks';
import { listDocuments } from '../db/repositories/rag-documents';
import { listMemoryCandidates } from '../db/repositories/memory-candidates';
import { listExpiringMemories } from '../db/repositories/long-term-memory';
import { getGoalLastActivityAt, getGoalProgress, listGoals } from '../db/repositories/goals';
import type { ProactiveEventDomain } from '../shared/types';
import {
  MAX_SOURCE_ITEMS_PER_DOMAIN,
  MEMORY_EXPIRING_MS,
  RUN_LOOKBACK_MS,
  localDateKey,
} from './contract';
import type { DomainSnapshot, LocalStateSnapshot } from './collector';

function bounded<T>(items: T[], limit = MAX_SOURCE_ITEMS_PER_DOMAIN): DomainSnapshot<T> {
  return { items: items.slice(0, limit), complete: items.length <= limit };
}

export function loadLocalStateSnapshot(
  domains: ReadonlySet<ProactiveEventDomain> | null,
  now = Date.now(),
  db: AppDatabase = getDatabase(),
): LocalStateSnapshot {
  const wants = (domain: ProactiveEventDomain) => domains == null || domains.has(domain);
  const snapshot: LocalStateSnapshot = { now };

  if (wants('task')) {
    snapshot.tasks = bounded(
      listUserTasks({ statuses: ['pending', 'in_progress'], dueOnOrBefore: localDateKey(now) }, db),
    );
  }
  if (wants('commitment')) {
    const items = listCommitments({ statuses: ['proposed', 'open', 'missed'], limit: MAX_SOURCE_ITEMS_PER_DOMAIN + 1 }, db);
    snapshot.commitments = bounded(items);
  }
  if (wants('run')) {
    const items = listTaskRuns(
      { phases: ['error', 'interrupted'], since: now - RUN_LOOKBACK_MS, limit: MAX_SOURCE_ITEMS_PER_DOMAIN + 1 },
      db,
    );
    snapshot.runs = bounded(items);
  }
  if (wants('schedule')) {
    snapshot.schedules = bounded(listScheduledTasks(db));
  }
  if (wants('document')) {
    const documents = listDocuments(db).map((document) => ({
      id: document.id,
      title: document.title,
      filename: document.filename,
      status: document.status,
      statusError: document.statusError,
      freshnessStatus: document.freshnessStatus,
      staleReason: document.staleReason,
      version: document.version,
      sourceKind: document.sourceKind,
      sourceModifiedAt: document.sourceModifiedAt,
      importedAt: document.importedAt,
    }));
    // 文档列表本身不设上限（已是产品内的整表查询）；快照视为完整。
    snapshot.documents = { items: documents, complete: true };
  }
  if (wants('memory')) {
    const candidates = listMemoryCandidates('pending', MAX_SOURCE_ITEMS_PER_DOMAIN + 1, db);
    snapshot.memoryCandidates = bounded(candidates);
    const memories = listExpiringMemories(now + MEMORY_EXPIRING_MS, MAX_SOURCE_ITEMS_PER_DOMAIN + 1, db).map((memory) => ({
      id: memory.id,
      memoryKey: memory.memoryKey,
      status: memory.status,
      expiresAt: memory.expiresAt,
    }));
    snapshot.memories = bounded(memories);
  }
  if (wants('goal')) {
    const goals = listGoals({ status: 'active', limit: MAX_SOURCE_ITEMS_PER_DOMAIN }, db).map((goal) => ({
      ...goal,
      progress: getGoalProgress(goal.id, db),
      lastActivityAt: getGoalLastActivityAt(goal.id, db) ?? goal.updatedAt,
    }));
    snapshot.goals = { items: goals, complete: goals.length < MAX_SOURCE_ITEMS_PER_DOMAIN };
  }
  return snapshot;
}
