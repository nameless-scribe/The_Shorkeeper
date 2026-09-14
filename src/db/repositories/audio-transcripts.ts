/**
 * P4 录音转写账本。**不存逐字稿正文**，只存产物路径（理由同 P1：账本不复制正文）。
 *
 * 幂等粒度是 `(source_hash, engine_type, diarization)`：同一文件在不同引擎或
 * 分离开关下结果不同，不能互相复用，否则用户打开分离后拿到的还是旧的无分离结果。
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { AudioTranscriptRow } from '../schema';

export type AudioTranscriptStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

const STATUSES: ReadonlySet<string> = new Set<AudioTranscriptStatus>([
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

/** 失败原因限长：账本里不该出现大段文本。 */
const MAX_ERROR_CHARS = 300;

export interface AudioTranscriptInfo {
  id: string;
  sourcePath: string;
  sourceHash: string;
  sizeBytes: number;
  durationMs: number | null;
  provider: string;
  engineType: string;
  diarization: boolean;
  status: AudioTranscriptStatus;
  transcriptPath: string | null;
  sentenceCount: number | null;
  speakerCount: number | null;
  error: string | null;
  providerCode: number | null;
  providerRequestId: string | null;
  sensitivity: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

const SELECT = `SELECT id, source_path, source_hash, size_bytes, duration_ms, provider, engine_type,
    diarization, status, transcript_path, sentence_count, speaker_count, error, provider_code,
    provider_request_id, sensitivity, created_at, updated_at, completed_at
  FROM audio_transcripts`;

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS - 1)}…` : trimmed;
}

function rowToInfo(row: AudioTranscriptRow): AudioTranscriptInfo {
  const num = (value: unknown) => (value == null ? null : Number(value));
  const text = (value: unknown) => (value == null ? null : String(value));
  return {
    id: String(row.id),
    sourcePath: String(row.source_path),
    sourceHash: String(row.source_hash),
    sizeBytes: Number(row.size_bytes),
    durationMs: num(row.duration_ms),
    provider: String(row.provider),
    engineType: String(row.engine_type),
    diarization: Number(row.diarization) === 1,
    status: (STATUSES.has(String(row.status)) ? String(row.status) : 'failed') as AudioTranscriptStatus,
    transcriptPath: text(row.transcript_path),
    sentenceCount: num(row.sentence_count),
    speakerCount: num(row.speaker_count),
    error: text(row.error),
    providerCode: num(row.provider_code),
    providerRequestId: text(row.provider_request_id),
    sensitivity: String(row.sensitivity),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: num(row.completed_at),
  };
}

export function getAudioTranscript(id: string, db: AppDatabase = getDatabase()): AudioTranscriptInfo | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as AudioTranscriptRow | undefined;
  return row ? rowToInfo(row) : null;
}

export interface AudioTranscriptKey {
  sourceHash: string;
  engineType: string;
  diarization: boolean;
}

/** 幂等查询：同一文件同一设置是否已经转写过。 */
export function findAudioTranscriptByKey(
  key: AudioTranscriptKey,
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE source_hash = ? AND engine_type = ? AND diarization = ?`)
    .get(key.sourceHash, key.engineType, key.diarization ? 1 : 0) as unknown as AudioTranscriptRow | undefined;
  return row ? rowToInfo(row) : null;
}

/**
 * 已完成且产物仍然存在的转写才可复用。
 * `isTranscriptUsable` 由调用方注入——账本不碰文件系统，
 * 否则单元测试就得准备真实文件。
 */
export function findReusableTranscript(
  key: AudioTranscriptKey,
  isTranscriptUsable: (transcriptPath: string) => boolean,
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo | null {
  const existing = findAudioTranscriptByKey(key, db);
  if (!existing || existing.status !== 'succeeded' || !existing.transcriptPath) return null;
  // 产物被用户删了就不能复用，否则工具会返回一个指向空气的路径
  return isTranscriptUsable(existing.transcriptPath) ? existing : null;
}

export interface StartAudioTranscriptInput {
  sourcePath: string;
  sourceHash: string;
  sizeBytes: number;
  engineType: string;
  diarization: boolean;
  provider?: string;
  sensitivity?: string;
  now?: number;
}

/**
 * 开始一次转写。同键记录已存在时**复用同一行并重置为 running**
 * （唯一约束在 `(source_hash, engine_type, diarization)` 上），
 * 这样失败后重试不会堆出一串废记录。
 */
export function startAudioTranscript(
  input: StartAudioTranscriptInput,
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo {
  return db.transaction(() => {
    const now = input.now ?? Date.now();
    const existing = findAudioTranscriptByKey(
      { sourceHash: input.sourceHash, engineType: input.engineType, diarization: input.diarization },
      db,
    );
    if (existing) {
      db.prepare(
        `UPDATE audio_transcripts
         SET source_path = ?, size_bytes = ?, status = 'running', transcript_path = NULL,
             sentence_count = NULL, speaker_count = NULL, duration_ms = NULL,
             error = NULL, provider_code = NULL, provider_request_id = NULL,
             completed_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(input.sourcePath, input.sizeBytes, now, existing.id);
      return getAudioTranscript(existing.id, db)!;
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO audio_transcripts
         (id, source_path, source_hash, size_bytes, provider, engine_type, diarization,
          status, sensitivity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    ).run(
      id,
      input.sourcePath,
      input.sourceHash,
      input.sizeBytes,
      input.provider ?? 'tencent-flash',
      input.engineType,
      input.diarization ? 1 : 0,
      input.sensitivity ?? 'sensitive',
      now,
      now,
    );
    return getAudioTranscript(id, db)!;
  });
}

export interface CompleteAudioTranscriptInput {
  transcriptPath: string;
  durationMs: number;
  sentenceCount: number;
  speakerCount: number;
  now?: number;
}

export function completeAudioTranscript(
  id: string,
  input: CompleteAudioTranscriptInput,
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo | null {
  const now = input.now ?? Date.now();
  db.prepare(
    `UPDATE audio_transcripts
     SET status = 'succeeded', transcript_path = ?, duration_ms = ?, sentence_count = ?,
         speaker_count = ?, error = NULL, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.transcriptPath, input.durationMs, input.sentenceCount, input.speakerCount, now, now, id);
  return getAudioTranscript(id, db);
}

export interface FailAudioTranscriptInput {
  error: string;
  providerCode?: number | null;
  providerRequestId?: string | null;
  /** 用户主动取消不是故障，单独记 cancelled，否则运行记录里会堆满并非错误的“失败” */
  cancelled?: boolean;
  now?: number;
}

export function failAudioTranscript(
  id: string,
  input: FailAudioTranscriptInput,
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo | null {
  const now = input.now ?? Date.now();
  db.prepare(
    `UPDATE audio_transcripts
     SET status = ?, error = ?, provider_code = ?, provider_request_id = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.cancelled ? 'cancelled' : 'failed',
    truncate(input.error),
    input.providerCode ?? null,
    input.providerRequestId ?? null,
    now,
    now,
    id,
  );
  return getAudioTranscript(id, db);
}

export interface ListAudioTranscriptsOptions {
  statuses?: AudioTranscriptStatus[];
  limit?: number;
}

export function listAudioTranscripts(
  options: ListAudioTranscriptsOptions = {},
  db: AppDatabase = getDatabase(),
): AudioTranscriptInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100) || 100));
  const rows = db
    .prepare(`${SELECT}${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as AudioTranscriptRow[];
  return rows.map(rowToInfo);
}

/**
 * 启动时收口残留的 `running`。
 *
 * 同步接口下进程退出即请求中断，服务端没有任务留着可以接回，
 * 因此这些记录永远不会自己推进——不收口就会在界面上永远显示“转写中”。
 */
export function failStaleRunningTranscripts(
  reason = '应用退出，转写中断',
  now = Date.now(),
  db: AppDatabase = getDatabase(),
): number {
  const rows = db
    .prepare(`SELECT id FROM audio_transcripts WHERE status = 'running'`)
    .all() as Array<{ id: string }>;
  if (!rows.length) return 0;
  db.prepare(
    `UPDATE audio_transcripts
     SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
     WHERE status = 'running'`,
  ).run(truncate(reason), now, now);
  return rows.length;
}
