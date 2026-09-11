import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectDatabaseHealth } from '../health';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

describe('inspectDatabaseHealth', () => {
  let tmpDir: string;
  let dbPath: string;
  let migrationsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-health-'));
    dbPath = path.join(tmpDir, 'test.db');
    migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, '0001_notes.sql'), 'CREATE TABLE notes (id TEXT);');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createDatabase(status = 'applied'): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = new SQL.Database();
    db.run('CREATE TABLE notes (id TEXT); INSERT INTO notes VALUES (\'one\');');
    db.run(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        detail TEXT
      );
    `);
    db.run(
      'INSERT INTO schema_migrations (name, applied_at, status, detail) VALUES (?, ?, ?, ?)',
      ['0001_notes.sql', Date.now(), status, status === 'applied' ? null : 'test status'],
    );
    fs.writeFileSync(dbPath, db.export());
    db.close();
    fs.copyFileSync(dbPath, `${dbPath}.bak-${Date.now()}`);
  }

  it('reports a complete database as healthy without modifying it', async () => {
    await createDatabase();
    const before = fs.readFileSync(dbPath);

    const report = await inspectDatabaseHealth(dbPath, {
      migrationsDir,
      requiredTables: ['notes'],
    });

    expect(report.status).toBe('healthy');
    expect(report.integrity).toEqual({ ok: true, messages: ['ok'] });
    expect(report.tables).toEqual([{ name: 'notes', exists: true, rowCount: 1 }]);
    expect(report.migrations.applied).toBe(1);
    expect(fs.readFileSync(dbPath)).toEqual(before);
  });

  it('reports partial migration state as critical', async () => {
    await createDatabase('partial');

    const report = await inspectDatabaseHealth(dbPath, {
      migrationsDir,
      requiredTables: ['notes'],
    });

    expect(report.status).toBe('critical');
    expect(report.migrations.partial).toBe(1);
    expect(report.errors).toContain('迁移账本包含 partial 或未知状态，需要人工检查。');
  });

  it('reports a corrupt database without throwing', async () => {
    fs.writeFileSync(dbPath, 'not a sqlite database');

    const report = await inspectDatabaseHealth(dbPath, {
      migrationsDir,
      requiredTables: ['notes'],
    });

    expect(report.status).toBe('critical');
    expect(report.errors.some((error) => error.startsWith('无法读取数据库：'))).toBe(true);
  });
});
