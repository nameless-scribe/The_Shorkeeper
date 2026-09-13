import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type ManagedDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import { createSession } from '../repositories/sessions';
import { createTaskRun } from '../repositories/task-runs';
import { listTaskRunContextSources, recordTaskRunContextSources } from '../repositories/context-sources';
import { getDocument, insertDocumentWithChunks, updateDocumentMeta } from '../repositories/rag-documents';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

async function open(engine: 'sql.js' | 'better-sqlite3'): Promise<ManagedDatabase> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-p1-context-${engine}-`));
  dirs.push(dir);
  const dbPath = path.join(dir, 'test.db');
  return engine === 'sql.js' ? openDatabase(dbPath) : openNativeDatabase(dbPath, { allowExisting: true });
}

describe.each(['sql.js', 'better-sqlite3'] as const)('P1.3/P1.4 persistence on %s', (engine) => {
  it('records bounded deduplicated run sources and cascades with the run', async () => {
    const db = await open(engine);
    try {
      const session = createSession(db);
      createTaskRun({ id: 'run-context', sessionId: session.id }, db);
      const input = {
        sourceType: 'memory' as const,
        sourceId: 'memory-1',
        sourceRef: 'mem:memory-1',
        label: '饮品偏好',
        summary: '用户喜欢拿铁',
        sourceUpdatedAt: 123,
      };
      recordTaskRunContextSources('run-context', [input, input], db);
      expect(listTaskRunContextSources('run-context', db)).toMatchObject([{ sourceRef: 'mem:memory-1' }]);
      if (engine === 'better-sqlite3') {
        db.prepare('DELETE FROM task_runs WHERE id = ?').run('run-context');
        expect(listTaskRunContextSources('run-context', db)).toEqual([]);
      }
    } finally {
      await db.closeAsync();
    }
  });

  it('round-trips document source freshness metadata', async () => {
    const db = await open(engine);
    try {
      const document = insertDocumentWithChunks({
        filename: 'source.md', filepath: 'knowledge/source.md', mimeType: 'text/markdown',
        sourcePath: 'C:/notes/source.md', sourceKind: 'local_file', sourceModifiedAt: 100,
        sourceSize: 42, lastCheckedAt: 110, freshnessStatus: 'current', syncPolicy: 'auto',
        chunks: [{ content: '内容', ftsText: '内容', embedding: new Uint8Array([0, 0, 128, 63]) }],
      }, db);
      expect(getDocument(document.id, db)).toMatchObject({
        sourceKind: 'local_file', sourceModifiedAt: 100, sourceSize: 42,
        lastCheckedAt: 110, freshnessStatus: 'current', syncPolicy: 'auto',
      });
      updateDocumentMeta(document.id, { freshnessStatus: 'missing', staleReason: '来源丢失' }, db);
      expect(getDocument(document.id, db)).toMatchObject({ freshnessStatus: 'missing', staleReason: '来源丢失' });
    } finally {
      await db.closeAsync();
    }
  });
});
