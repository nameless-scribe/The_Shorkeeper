import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDatabaseBackups, validateDatabaseFile } from '../backup';
import { openDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import { rehearseNativeMigration } from '../native-migration';
import { insertDocumentWithChunks, searchDocumentChunkFtsRanks } from '../repositories/rag-documents';
import { createWorldbookEntry, searchWorldbookFtsIds } from '../repositories/worldbook';

describe('native SQLite migration rehearsal', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-native-migration-'));
    dbPath = path.join(tempDir, 'shorekeeper.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates and validates a copy while leaving the sql.js source unchanged', async () => {
    const source = await openDatabase(dbPath);
    const worldbook = createWorldbookEntry(
      { keys: '黑海岸', content: '守岸人在黑海岸记录潮汐。' },
      source,
    );
    insertDocumentWithChunks(
      {
        filename: '潮汐记录.md',
        filepath: 'knowledge/tide.md',
        mimeType: 'text/markdown',
        chunks: [
          {
            content: '黑海岸今日潮汐平稳。',
            ftsText: '[潮汐记录.md]\n\n黑海岸今日潮汐平稳。',
            embedding: new Uint8Array([0, 0, 128, 63]),
          },
        ],
        contentHash: 'native-migration-test',
        embeddingModel: 'test-model',
        embeddingDim: 1,
      },
      source,
    );
    await source.closeAsync();
    const sourceBefore = await validateDatabaseFile(dbPath);

    const report = await rehearseNativeMigration(dbPath, { keepMigratedCopy: true });

    expect(report.sourceSha256).toBe(sourceBefore.sha256);
    expect(report.backupSha256).toBe(sourceBefore.sha256);
    expect(report.rollbackVerified).toBe(true);
    expect(report.appliedMigrations).toEqual([
      '0002_worldbook_fts5.sql',
      '0010_rag_fts.sql',
      '0014_rag_fts_trigram.sql',
    ]);
    expect(report.worldbookFtsRows).toBe(1);
    expect(report.documentChunkFtsRows).toBe(1);
    expect((await validateDatabaseFile(dbPath)).sha256).toBe(sourceBefore.sha256);
    expect(listDatabaseBackups(dbPath).find((backup) => backup.path === report.backupPath)?.kind)
      .toBe('pre-native');

    const migratedPath = report.migratedCopyPath!;
    const migrated = openNativeDatabase(migratedPath, {
      allowExisting: true,
      initialize: false,
    });
    expect(searchWorldbookFtsIds(['黑海岸'], migrated)).toContain(worldbook.id);
    expect(searchDocumentChunkFtsRanks('黑海岸', 5, undefined, migrated)).toHaveLength(1);
    expect(
      migrated.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE status = 'applied'").get()
        ?.count,
    ).toBe(25);
    migrated.close();
  });

  it('stops before backup when a non-empty WAL makes the source unsafe', async () => {
    const source = await openDatabase(dbPath);
    await source.closeAsync();
    fs.writeFileSync(`${dbPath}-wal`, 'pending transaction');

    await expect(rehearseNativeMigration(dbPath)).rejects.toThrow('源数据库健康检查未通过');
    expect(listDatabaseBackups(dbPath).filter((backup) => backup.kind === 'pre-native')).toEqual([]);
  });
});
