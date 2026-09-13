import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { MemorySourceType } from '../../shared/types';
import { MEMORY_SOURCE_TYPES } from '../../memory/personal-model';

export interface MemorySourceEntry {
  id: string;
  memoryId: string;
  sourceType: MemorySourceType;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  sourceDocumentId: string | null;
  sourceChunkId: string | null;
  sourceToolName: string | null;
  sourceEntityId: string | null;
  sourceRef: string | null;
  summary: string | null;
  createdAt: number;
}

export interface CreateMemorySourceInput {
  memoryId: string;
  sourceType: MemorySourceType;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
  sourceDocumentId?: string | null;
  sourceChunkId?: string | null;
  sourceToolName?: string | null;
  sourceEntityId?: string | null;
  sourceRef?: string | null;
  summary?: string | null;
  createdAt?: number;
}

interface MemorySourceDbRow {
  id: string;
  memory_id: string;
  source_type: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_run_id: string | null;
  source_document_id: string | null;
  source_chunk_id: string | null;
  source_tool_name: string | null;
  source_entity_id: string | null;
  source_ref: string | null;
  summary: string | null;
  created_at: number;
}

const SOURCE_SELECT = `id, memory_id, source_type, source_session_id, source_message_id,
  source_run_id, source_document_id, source_chunk_id, source_tool_name,
  source_entity_id, source_ref, summary, created_at`;

function normalizeSourceType(value: string): MemorySourceType {
  return MEMORY_SOURCE_TYPES.includes(value as MemorySourceType)
    ? value as MemorySourceType
    : 'legacy';
}

function rowToSource(row: MemorySourceDbRow): MemorySourceEntry {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    sourceType: normalizeSourceType(String(row.source_type)),
    sourceSessionId: row.source_session_id == null ? null : String(row.source_session_id),
    sourceMessageId: row.source_message_id == null ? null : String(row.source_message_id),
    sourceRunId: row.source_run_id == null ? null : String(row.source_run_id),
    sourceDocumentId: row.source_document_id == null ? null : String(row.source_document_id),
    sourceChunkId: row.source_chunk_id == null ? null : String(row.source_chunk_id),
    sourceToolName: row.source_tool_name == null ? null : String(row.source_tool_name),
    sourceEntityId: row.source_entity_id == null ? null : String(row.source_entity_id),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    summary: row.summary == null ? null : String(row.summary),
    createdAt: Number(row.created_at),
  };
}

export function createMemorySource(
  input: CreateMemorySourceInput,
  db: AppDatabase = getDatabase(),
): MemorySourceEntry {
  const source: MemorySourceEntry = {
    id: uuidv4(),
    memoryId: input.memoryId,
    sourceType: input.sourceType,
    sourceSessionId: input.sourceSessionId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceRunId: input.sourceRunId ?? null,
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceChunkId: input.sourceChunkId ?? null,
    sourceToolName: input.sourceToolName ?? null,
    sourceEntityId: input.sourceEntityId ?? null,
    sourceRef: input.sourceRef ?? null,
    summary: input.summary ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(
    `INSERT INTO memory_sources (${SOURCE_SELECT}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    source.id,
    source.memoryId,
    source.sourceType,
    source.sourceSessionId,
    source.sourceMessageId,
    source.sourceRunId,
    source.sourceDocumentId,
    source.sourceChunkId,
    source.sourceToolName,
    source.sourceEntityId,
    source.sourceRef,
    source.summary,
    source.createdAt,
  );
  return source;
}

export function listMemorySources(
  memoryId: string,
  db: AppDatabase = getDatabase(),
): MemorySourceEntry[] {
  const rows = db.prepare(
    `SELECT ${SOURCE_SELECT} FROM memory_sources WHERE memory_id = ? ORDER BY created_at ASC, id ASC`,
  ).all(memoryId) as unknown as MemorySourceDbRow[];
  return rows.map(rowToSource);
}
