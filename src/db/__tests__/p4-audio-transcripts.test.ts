import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import {
  completeAudioTranscript,
  failAudioTranscript,
  failStaleRunningTranscripts,
  findAudioTranscriptByKey,
  findReusableTranscript,
  getAudioTranscript,
  listAudioTranscripts,
  startAudioTranscript,
  type StartAudioTranscriptInput,
} from '../repositories/audio-transcripts';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

const now = Date.now();

function started(overrides: Partial<StartAudioTranscriptInput> = {}): StartAudioTranscriptInput {
  return {
    sourcePath: 'audio/周会.m4a',
    sourceHash: 'a'.repeat(64),
    sizeBytes: 9_971_240,
    engineType: '16k_zh',
    diarization: true,
    now,
    ...overrides,
  };
}

function startClaimed(input: StartAudioTranscriptInput, db: AppDatabase) {
  const claim = startAudioTranscript(input, db);
  if (!claim.claimed || !claim.attemptId) throw new Error('expected transcript attempt to be claimed');
  return { record: claim.record, attemptId: claim.attemptId };
}

const usable = () => true;
const missing = () => false;

for (const adapter of adapters) {
  describe(`P4 audio transcript ledger (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-p4-ledger-'));
      db = (await adapter.open(path.join(tempDir, 'p4.db'))) as ContractDatabase;
      return db;
    }

    it('creates a running record and completes it with the artifact path', async () => {
      const database = await open();
      const { record, attemptId } = startClaimed(started(), database);
      expect(record).toMatchObject({
        status: 'running',
        provider: 'tencent-flash',
        diarization: true,
        // 录音属于敏感内容，默认从严
        sensitivity: 'sensitive',
        transcriptPath: null,
      });

      const done = completeAudioTranscript(
        record.id,
        attemptId,
        {
          transcriptPath: 'audio/周会.transcript.md',
          durationMs: 612137,
          sentenceCount: 95,
          speakerCount: 5,
          providerRequestId: 'req-success-1',
          now: now + 26_000,
        },
        database,
      );
      expect(done).toMatchObject({
        status: 'succeeded',
        transcriptPath: 'audio/周会.transcript.md',
        durationMs: 612137,
        sentenceCount: 95,
        speakerCount: 5,
        providerRequestId: 'req-success-1',
        completedAt: now + 26_000,
      });
    });

    it('never stores transcript text, only the artifact path', async () => {
      const database = await open();
      const { record, attemptId } = startClaimed(started(), database);
      completeAudioTranscript(
        record.id,
        attemptId,
        { transcriptPath: 'audio/周会.transcript.md', durationMs: 1000, sentenceCount: 1, speakerCount: 1 },
        database,
      );
      // 账本不复制正文：整张表里不该出现任何长文本列
      const columns = database
        .prepare(`SELECT name FROM pragma_table_info('audio_transcripts')`)
        .all() as Array<{ name: string }>;
      const names = columns.map((c) => c.name);
      expect(names).toContain('transcript_path');
      expect(names).not.toContain('transcript_text');
      expect(names).not.toContain('text');
    });

    it('reuses the same row on retry instead of piling up dead records', async () => {
      const database = await open();
      const first = startClaimed(started(), database);
      failAudioTranscript(first.record.id, first.attemptId, { error: '网络中断', providerCode: 4008 }, database);

      const retried = startClaimed(started(), database);
      expect(retried.record.id).toBe(first.record.id);
      expect(retried.record).toMatchObject({ status: 'running', error: null, providerCode: null, completedAt: null });
      expect(listAudioTranscripts({}, database)).toHaveLength(1);
    });

    it('atomically rejects a concurrent attempt and prevents an old attempt from overwriting a retry', async () => {
      const database = await open();
      const first = startClaimed(started(), database);
      const concurrent = startAudioTranscript(started(), database);
      expect(concurrent).toMatchObject({ claimed: false, attemptId: null });
      expect(concurrent.record.id).toBe(first.record.id);

      failAudioTranscript(first.record.id, first.attemptId, { error: '网络中断' }, database);
      const retry = startClaimed(started(), database);
      expect(retry.attemptId).not.toBe(first.attemptId);

      expect(completeAudioTranscript(
        first.record.id,
        first.attemptId,
        { transcriptPath: 'old.md', durationMs: 1, sentenceCount: 1, speakerCount: 1 },
        database,
      )).toBeNull();
      expect(getAudioTranscript(first.record.id, database)).toMatchObject({
        status: 'running',
        attemptId: retry.attemptId,
        transcriptPath: null,
      });
    });

    it('keys idempotency on hash + engine + diarization', async () => {
      const database = await open();
      const base = startClaimed(started(), database).record;
      const otherEngine = startClaimed(started({ engineType: '8k_zh' }), database).record;
      const noDiarization = startClaimed(started({ diarization: false }), database).record;

      // 同一文件在不同设置下结果不同，不能互相复用
      expect(new Set([base.id, otherEngine.id, noDiarization.id]).size).toBe(3);
      expect(findAudioTranscriptByKey({ sourceHash: 'a'.repeat(64), engineType: '16k_zh', diarization: true }, database)?.id)
        .toBe(base.id);
      expect(findAudioTranscriptByKey({ sourceHash: 'a'.repeat(64), engineType: '16k_zh', diarization: false }, database)?.id)
        .toBe(noDiarization.id);
    });

    it('only reuses a succeeded record whose artifact still exists', async () => {
      const database = await open();
      const key = { sourceHash: 'a'.repeat(64), engineType: '16k_zh', diarization: true };
      const { record, attemptId } = startClaimed(started(), database);

      // 还在跑：不能复用
      expect(findReusableTranscript(key, usable, database)).toBeNull();

      completeAudioTranscript(
        record.id,
        attemptId,
        { transcriptPath: 'audio/周会.transcript.md', durationMs: 1000, sentenceCount: 1, speakerCount: 1 },
        database,
      );
      expect(findReusableTranscript(key, usable, database)?.id).toBe(record.id);
      // 产物被用户删了：不能复用，否则工具会返回一个指向空气的路径
      expect(findReusableTranscript(key, missing, database)).toBeNull();
    });

    it('records a cancellation separately from a failure', async () => {
      const database = await open();
      const { record, attemptId } = startClaimed(started(), database);
      failAudioTranscript(record.id, attemptId, { error: '转写已取消', cancelled: true }, database);
      // 用户主动取消不该出现在“失败”里
      expect(getAudioTranscript(record.id, database)?.status).toBe('cancelled');
      expect(listAudioTranscripts({ statuses: ['failed'] }, database)).toHaveLength(0);
      expect(listAudioTranscripts({ statuses: ['cancelled'] }, database)).toHaveLength(1);
    });

    it('truncates an overlong failure reason', async () => {
      const database = await open();
      const { record, attemptId } = startClaimed(started(), database);
      failAudioTranscript(record.id, attemptId, { error: 'x'.repeat(1000) }, database);
      const stored = getAudioTranscript(record.id, database)!;
      expect(stored.error!.length).toBeLessThanOrEqual(300);
      expect(stored.error!.endsWith('…')).toBe(true);
    });

    it('closes stale running records on startup so nothing shows "转写中" forever', async () => {
      const database = await open();
      startClaimed(started(), database);
      const finished = startClaimed(started({ sourceHash: 'b'.repeat(64) }), database);
      completeAudioTranscript(
        finished.record.id,
        finished.attemptId,
        { transcriptPath: 'b.md', durationMs: 1, sentenceCount: 1, speakerCount: 1 },
        database,
      );

      // 同步接口下进程退出即请求中断，服务端没有任务可接回，这些记录永远不会自己推进
      expect(failStaleRunningTranscripts('应用退出，转写中断', now, database)).toBe(1);
      expect(listAudioTranscripts({ statuses: ['running'] }, database)).toHaveLength(0);
      expect(getAudioTranscript(finished.record.id, database)?.status).toBe('succeeded');
      expect(failStaleRunningTranscripts('应用退出，转写中断', now, database)).toBe(0);
    });

    it('lists newest first and filters by status', async () => {
      const database = await open();
      const older = startClaimed(started({ now }), database).record;
      const newer = startClaimed(started({ sourceHash: 'c'.repeat(64), now: now + 1000 }), database);
      completeAudioTranscript(
        newer.record.id,
        newer.attemptId,
        { transcriptPath: 'c.md', durationMs: 1, sentenceCount: 1, speakerCount: 1, now: now + 2000 },
        database,
      );
      expect(listAudioTranscripts({}, database).map((item) => item.id)).toEqual([newer.record.id, older.id]);
      expect(listAudioTranscripts({ statuses: ['succeeded'] }, database).map((item) => item.id)).toEqual([newer.record.id]);
    });
  });
}
