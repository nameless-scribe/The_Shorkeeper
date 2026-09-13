import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type ManagedDatabase, INIT_SQL } from '../index';
import { runMigrations } from '../migrate';
import { openNativeDatabase } from '../native-adapter';
import { createMemory, listMemoryHistory, listMemories } from '../repositories/long-term-memory';
import { createMemorySource, listMemorySources } from '../repositories/memory-sources';

const tempDirs: string[] = [];

function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function openEngine(
  engine: 'sql.js' | 'better-sqlite3',
  dbPath: string,
): Promise<ManagedDatabase> {
  return engine === 'sql.js'
    ? openDatabase(dbPath)
    : openNativeDatabase(dbPath, { allowExisting: true });
}

describe.each(['sql.js', 'better-sqlite3'] as const)('P1.1 memory foundation on %s', (engine) => {
  it('stores typed metadata and keeps one active row while retaining history', async () => {
    const dir = makeTempDir(engine.replace('.', '-'));
    const db = await openEngine(engine, path.join(dir, 'memory.db'));
    try {
      const oldMemory = createMemory({
        memoryKey: 'user.preference.drink',
        content: '用户喜欢拿铁',
        importance: 0.8,
        memoryType: 'preference',
        confidence: 0.91,
        sensitivity: 'private',
        modelUsePolicy: 'allow',
        createdAt: 100,
      }, db);
      const source = createMemorySource({
        memoryId: oldMemory.id,
        sourceType: 'conversation',
        sourceSessionId: 'session-1',
        sourceMessageId: 'message-1',
        sourceRunId: 'run-1',
        sourceRef: 'conversation:session-1:message-1',
        createdAt: 101,
      }, db);
      expect(listMemorySources(oldMemory.id, db)).toEqual([source]);

      db.prepare(
        `UPDATE long_term_memory
         SET status = 'superseded', updated_at = ?, superseded_by = ?
         WHERE id = ?`,
      ).run(200, 'replacement-id', oldMemory.id);
      const current = createMemory({
        memoryKey: 'user.preference.drink',
        content: '用户改喝茶',
        importance: 0.9,
        memoryType: 'preference',
        confidence: 0.95,
        validFrom: 200,
        createdAt: 200,
      }, db);

      expect(listMemories(10, db)).toEqual([current]);
      expect(listMemoryHistory('user.preference.drink', db)).toHaveLength(2);
      expect(() => createMemory({
        memoryKey: 'user.preference.drink',
        content: '第三个 active 值',
        importance: 0.5,
      }, db)).toThrow();

      db.prepare('DELETE FROM long_term_memory WHERE id = ?').run(oldMemory.id);
      expect(listMemorySources(oldMemory.id, db)).toEqual([]);
    } finally {
      await db.closeAsync();
    }
  });
});

describe('P1.1 migration compatibility', () => {
  it('backfills a 0022 native database without treating importance as confidence', () => {
    const dir = makeTempDir('p1-upgrade');
    const legacyMigrations = path.join(dir, 'legacy-migrations');
    fs.mkdirSync(legacyMigrations);
    const sourceMigrations = path.resolve('src/db/migrations');
    for (const file of fs.readdirSync(sourceMigrations)) {
      if (!file.endsWith('.sql') || file > '0022_goals_commitments.sql') continue;
      fs.copyFileSync(path.join(sourceMigrations, file), path.join(legacyMigrations, file));
    }

    const dbPath = path.join(dir, 'legacy.db');
    const legacy = openNativeDatabase(dbPath, { allowExisting: true, initialize: false });
    legacy.exec(INIT_SQL);
    runMigrations(legacy, { migrationsDir: legacyMigrations });
    legacy.prepare(
      `INSERT INTO long_term_memory
       (id, memory_key, content, importance, source_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('legacy-memory', 'user.nickname', '用户叫小汐', 0.93, 'legacy-session', 1234);
    legacy.close();

    const migrated = openNativeDatabase(dbPath, { allowExisting: true });
    try {
      const row = migrated.prepare(
        `SELECT memory_type, confidence, sensitivity, model_use_policy, status,
                valid_from, updated_at
         FROM long_term_memory WHERE id = ?`,
      ).get('legacy-memory');
      expect(row).toEqual({
        memory_type: 'other',
        confidence: 0.5,
        sensitivity: 'normal',
        model_use_policy: 'allow',
        status: 'active',
        valid_from: 1234,
        updated_at: 1234,
      });
      expect(listMemorySources('legacy-memory', migrated)).toEqual([
        expect.objectContaining({
          memoryId: 'legacy-memory',
          sourceType: 'conversation',
          sourceSessionId: 'legacy-session',
          createdAt: 1234,
        }),
      ]);
      expect(migrated.prepare(
        `SELECT status FROM schema_migrations WHERE name = '0023_personal_memory_model.sql'`,
      ).get()).toEqual({ status: 'applied' });
    } finally {
      migrated.close();
    }
  });
});
