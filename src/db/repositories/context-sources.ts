import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  ContextSourceType,
  TaskRunContextSourceInfo,
} from '../../shared/types';
import type { TaskRunContextSourceRow } from '../schema';

export const MAX_CONTEXT_SOURCE_LABEL_CHARS = 160;
export const MAX_CONTEXT_SOURCE_SUMMARY_CHARS = 240;
export const MAX_CONTEXT_SOURCES_PER_RUN = 64;

export interface CreateTaskRunContextSourceInput {
  sourceType: ContextSourceType;
  sourceId: string;
  sourceRef: string;
  label: string;
  summary?: string | null;
  documentVersion?: number | null;
  sourceUpdatedAt?: number | null;
}

const CONTEXT_SOURCE_SELECT = `id, run_id, source_type, source_id, source_ref,
  label, summary, document_version, source_updated_at, created_at`;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalizeSourceType(value: string): ContextSourceType {
  if (value === 'document' || value === 'goal' || value === 'commitment') return value;
  return 'memory';
}

function rowToContextSource(row: TaskRunContextSourceRow): TaskRunContextSourceInfo {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sourceType: normalizeSourceType(String(row.source_type)),
    sourceId: String(row.source_id),
    sourceRef: String(row.source_ref),
    label: String(row.label),
    summary: row.summary == null ? null : String(row.summary),
    documentVersion: row.document_version == null ? null : Number(row.document_version),
    sourceUpdatedAt: row.source_updated_at == null ? null : Number(row.source_updated_at),
    createdAt: Number(row.created_at),
  };
}

export function recordTaskRunContextSources(
  runId: string,
  sources: CreateTaskRunContextSourceInput[],
  db: AppDatabase = getDatabase(),
): TaskRunContextSourceInfo[] {
  if (!sources.length) return [];
  const bounded = sources.slice(0, MAX_CONTEXT_SOURCES_PER_RUN);
  const now = Date.now();
  db.transaction(() => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO task_run_context_sources
         (${CONTEXT_SOURCE_SELECT}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of bounded) {
      const sourceId = source.sourceId.trim();
      const sourceRef = source.sourceRef.trim();
      const label = truncate(source.label.trim(), MAX_CONTEXT_SOURCE_LABEL_CHARS);
      if (!sourceId || !sourceRef || !label) continue;
      insert.run(
        uuidv4(),
        runId,
        source.sourceType,
        sourceId,
        truncate(sourceRef, MAX_CONTEXT_SOURCE_LABEL_CHARS),
        label,
        source.summary == null
          ? null
          : truncate(source.summary.trim(), MAX_CONTEXT_SOURCE_SUMMARY_CHARS),
        source.documentVersion ?? null,
        source.sourceUpdatedAt ?? null,
        now,
      );
    }
  });
  return listTaskRunContextSources(runId, db);
}

export function listTaskRunContextSources(
  runId: string,
  db: AppDatabase = getDatabase(),
): TaskRunContextSourceInfo[] {
  const rows = db.prepare(
    `SELECT ${CONTEXT_SOURCE_SELECT} FROM task_run_context_sources
     WHERE run_id = ? ORDER BY created_at ASC, id ASC`,
  ).all(runId) as unknown as TaskRunContextSourceRow[];
  return rows.map(rowToContextSource);
}
