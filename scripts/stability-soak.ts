import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { openNativeDatabase } from '../src/db/native-adapter';
import { createSession, deleteSession } from '../src/db/repositories/sessions';
import { insertMessage } from '../src/db/repositories/messages';
import {
  deleteDocumentData,
  insertDocumentWithChunks,
  searchDocumentChunkFtsRanks,
} from '../src/db/repositories/rag-documents';
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
} from '../src/db/repositories/worldbook';

const cycles = Number.parseInt(process.env.SHOREKEEPER_SOAK_CYCLES ?? '1000', 10);
if (!Number.isFinite(cycles) || cycles < 100 || cycles > 100_000) {
  throw new Error('SHOREKEEPER_SOAK_CYCLES 必须介于 100 与 100000');
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-soak-'));
const dbPath = path.join(tempRoot, 'soak.db');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function activeHandleCount(): number {
  const getHandles = (process as typeof process & {
    _getActiveHandles?: () => unknown[];
  })._getActiveHandles;
  return getHandles ? getHandles().length : 0;
}

function collectMemory(): number {
  global.gc?.();
  return process.memoryUsage().rss;
}

function mib(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function assertCleanSidecars(target: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${target}${suffix}`;
    assert(!fs.existsSync(sidecar) || fs.statSync(sidecar).size === 0, `关闭后仍有非空 sidecar: ${sidecar}`);
  }
}

function runCrashRecovery(target: string): void {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve('scripts/stability-soak-crash-child.ts'), target],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert(child.status === 23, `强制中断子进程状态异常: ${child.status}\n${child.stderr}`);

  const recovered = openNativeDatabase(target, { allowExisting: true });
  try {
    const integrity = recovered.prepare('PRAGMA integrity_check').get();
    assert(integrity?.integrity_check === 'ok', '强制中断后 integrity_check 失败');
    const marker = recovered.prepare(
      `SELECT COUNT(*) AS count FROM sessions WHERE title = 'crash-recovery-marker'`,
    ).get();
    assert(Number(marker?.count) === 1, '强制中断前已提交数据未恢复');
  } finally {
    recovered.close();
  }
  assertCleanSidecars(target);
}

const startedAt = performance.now();
const initialRss = collectMemory();
const initialHandles = activeHandleCount();
let peakRss = initialRss;

try {
  const db = openNativeDatabase(dbPath);
  try {
    for (let index = 0; index < cycles; index += 1) {
      const session = createSession(db, `soak-${index}`);
      insertMessage(session.id, 'user', `用户消息 ${index}`, 8, db);
      insertMessage(session.id, 'assistant', `助手回复 ${index}`, 8, db);
      deleteSession(session.id, db);

      const entry = createWorldbookEntry({
        keys: `海岸-${index}`,
        content: `长稳压测内容 ${index}`,
        priority: index % 10,
      }, db);
      deleteWorldbookEntry(entry.id, db);

      if ((index + 1) % 100 === 0) {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }
    }

    const embedding = new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer);
    const documentCount = Math.max(20, Math.min(200, Math.floor(cycles / 10)));
    for (let documentIndex = 0; documentIndex < documentCount; documentIndex += 1) {
      const document = insertDocumentWithChunks({
        filename: `soak-${documentIndex}.md`,
        filepath: `knowledge/soak-${documentIndex}.md`,
        mimeType: 'text/markdown',
        contentHash: `soak-${documentIndex}`,
        embeddingModel: 'soak-model',
        embeddingDim: 4,
        chunks: Array.from({ length: 10 }, (_, chunkIndex) => ({
          content: `长稳检索标记 ${documentIndex}-${chunkIndex}`,
          ftsText: `[长稳文档]\n\n长稳检索标记 ${documentIndex}-${chunkIndex}`,
          embedding,
        })),
      }, db);
      if (documentIndex % 2 === 0) deleteDocumentData(document.id, db);
    }

    const hits = searchDocumentChunkFtsRanks('长稳检索标记', 20, undefined, db);
    assert(hits !== null, 'FTS 长稳检索不可用');
    assert(hits.length > 0 && hits.length <= 20, 'FTS 长稳检索结果异常');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    assert(integrity?.integrity_check === 'ok', '长稳写入后 integrity_check 失败');
  } finally {
    db.close();
  }

  assertCleanSidecars(dbPath);
  runCrashRecovery(dbPath);

  const finalRss = collectMemory();
  const finalHandles = activeHandleCount();
  const retainedRss = finalRss - initialRss;
  const handleDelta = finalHandles - initialHandles;
  assert(retainedRss < 64 * 1024 * 1024, `结束后 RSS 增长过高: ${mib(retainedRss)} MiB`);
  assert(handleDelta <= 0, `结束后活动句柄未回落: +${handleDelta}`);

  console.log(JSON.stringify({
    cycles,
    sessionMessageCycles: cycles,
    worldbookCycles: cycles,
    documentCount: Math.max(20, Math.min(200, Math.floor(cycles / 10))),
    chunksPerDocument: 10,
    crashRecovery: true,
    integrity: 'ok',
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    initialRssMiB: mib(initialRss),
    peakRssMiB: mib(peakRss),
    finalRssMiB: mib(finalRss),
    retainedRssMiB: mib(retainedRss),
    activeHandleDelta: handleDelta,
    dbSizeMiB: mib(fs.statSync(dbPath).size),
    sidecarsClean: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
