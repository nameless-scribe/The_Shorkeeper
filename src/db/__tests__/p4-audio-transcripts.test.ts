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
      const record = startAudioTranscript(started(), database);
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
        { transcriptPath: 'audio/周会.transcript.md', durationMs: 612137, sentenceCount: 95, speakerCount: 5, now: now + 26_000 },
        database,
      );
      expect(done).toMatchObject({
        status: 'succeeded',
        transcriptPath: 'audio/周会.transcript.md',
        durationMs: 612137,
        sentenceCount: 95,
        speakerCount: 5,
        completedAt: now + 26_000,
      });
    });

    it('never stores transcript text, only the artifact path', async () => {
      const database = await open();
      const record = startAudioTranscript(started(), database);
      completeAudioTranscript(
        record.id,
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
      const first = startAudioTranscript(started(), database);
      failAudioTranscript(first.id, { error: '网络中断', providerCode: 4008 }, database);

      const retried = startAudioTranscript(started(), database);
      expect(retried.id).toBe(first.id);
      expect(retried).toMatchObject({ status: 'running', error: null, providerCode: null, completedAt: null });
      expect(listAudioTranscripts({}, database)).toHaveLength(1);
    });

    it('keys idempotency on hash + engine + diarization', async () => {
      const database = await open();
      const base = startAudioTranscript(started(), database);
      const otherEngine = startAudioTranscript(started({ engineType: '8k_zh' }), database);
      const noDiarization = startAudioTranscript(started({ diarization: false }), database);

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
      const record = startAudioTranscript(started(), database);

      // 还在跑：不能复用
      expect(findReusableTranscript(key, usable, database)).toBeNull();

      completeAudioTranscript(
        record.id,
        { transcriptPath: 'audio/周会.transcript.md', durationMs: 1000, sentenceCount: 1, speakerCount: 1 },
        database,
      );
      expect(findReusableTranscript(key, usable, database)?.id).toBe(record.id);
      // 产物被用户删了：不能复用，否则工具会返回一个指向空气的路径
      expect(findReusableTranscript(key, missing, database)).toBeNull();
    });

    it('records a cancellation separately from a failure', async () => {
      const database = await open();
      const record = startAudioTranscript(started(), database);
      failAudioTranscript(record.id, { error: '转写已取消', cancelled: true }, database);
      // 用户主动取消不该出现在“失败”里
      expect(getAudioTranscript(record.id, database)?.status).toBe('cancelled');
      expect(listAudioTranscripts({ statuses: ['failed'] }, database)).toHaveLength(0);
      expect(listAudioTranscripts({ statuses: ['cancelled'] }, database)).toHaveLength(1);
    });

    it('truncates an overlong failure reason', async () => {
      const database = await open();
      const record = startAudioTranscript(started(), database);
      failAudioTranscript(record.id, { error: 'x'.repeat(1000) }, database);
      const stored = getAudioTranscript(record.id, database)!;
      expect(stored.error!.length).toBeLessThanOrEqual(300);
      expect(stored.error!.endsWith('…')).toBe(true);
    });

    it('closes stale running records on startup so nothing shows "转写中" forever', async () => {
      const database = await open();
      startAudioTranscript(started(), database);
      const finished = startAudioTranscript(started({ sourceHash: 'b'.repeat(64) }), database);
      completeAudioTranscript(
        finished.id,
        { transcriptPath: 'b.md', durationMs: 1, sentenceCount: 1, speakerCount: 1 },
        database,
      );

      // 同步接口下进程退出即请求中断，服务端没有任务可接回，这些记录永远不会自己推进
      expect(failStaleRunningTranscripts('应用退出，转写中断', now, database)).toBe(1);
      expect(listAudioTranscripts({ statuses: ['running'] }, database)).toHaveLength(0);
      expect(getAudioTranscript(finished.id, database)?.status).toBe('succeeded');
      expect(failStaleRunningTranscripts('应用退出，转写中断', now, database)).toBe(0);
    });

    it('lists newest first and filters by status', async () => {
      const database = await open();
      const older = startAudioTranscript(started({ now }), database);
      const newer = startAudioTranscript(started({ sourceHash: 'c'.repeat(64), now: now + 1000 }), database);
      completeAudioTranscript(
        newer.id,
        { transcriptPath: 'c.md', durationMs: 1, sentenceCount: 1, speakerCount: 1, now: now + 2000 },
        database,
      );
      expect(listAudioTranscripts({}, database).map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(listAudioTranscripts({ statuses: ['succeeded'] }, database).map((item) => item.id)).toEqual([newer.id]);
    });
  });
}
