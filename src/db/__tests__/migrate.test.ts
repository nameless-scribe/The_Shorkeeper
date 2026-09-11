import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDb } from '../index';
import { runMigrations } from '../migrate';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

describe('runMigrations', () => {
  let db: SqliteDb;
  let tmpDir: string;
  let migrationsDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-migrate-'));
    migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir);
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    db = new SqliteDb(SQL, new SQL.Database(), path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMigration(name: string, sql: string): void {
    fs.writeFileSync(path.join(migrationsDir, name), sql);
  }

  function migrationRow(name: string): { status: string; detail: string | null } | undefined {
    return db
      .prepare('SELECT status, detail FROM schema_migrations WHERE name = ?')
      .get(name) as { status: string; detail: string | null } | undefined;
  }

  it('records a successful migration as applied', () => {
    writeMigration('0001_create_notes.sql', 'CREATE TABLE notes (id TEXT PRIMARY KEY);');

    expect(runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }))
      .toEqual(['0001_create_notes.sql']);
    expect(migrationRow('0001_create_notes.sql')).toEqual({ status: 'applied', detail: null });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'").get(),
    ).toBeDefined();
  });

  it('records unsupported FTS as skipped without creating the table', () => {
    writeMigration(
      '0002_worldbook_fts5.sql',
      'CREATE VIRTUAL TABLE worldbook_fts USING fts5(content);',
    );

    expect(runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }))
      .toEqual(['0002_worldbook_fts5.sql (skipped)']);
    expect(migrationRow('0002_worldbook_fts5.sql')?.status).toBe('skipped');
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'worldbook_fts'").get(),
    ).toBeUndefined();
  });

  it('rolls back a partial migration, records the conflict, and stops startup', () => {
    db.exec('CREATE TABLE items (id TEXT, existing TEXT);');
    writeMigration(
      '0003_columns.sql',
      'ALTER TABLE items ADD COLUMN added TEXT; ALTER TABLE items ADD COLUMN existing TEXT;',
    );

    expect(() =>
      runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }),
    ).toThrow('应用启动已中止');
    expect(migrationRow('0003_columns.sql')?.status).toBe('partial');
    const columns = db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(['id', 'existing']);

    expect(() =>
      runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }),
    ).toThrow('partial 状态');
  });

  it('rolls back schema changes when the migration ledger cannot be recorded', () => {
    runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } });
    db.exec(`
      CREATE TRIGGER block_migration_ledger
      BEFORE INSERT ON schema_migrations
      BEGIN
        SELECT RAISE(ABORT, 'ledger blocked');
      END;
    `);
    writeMigration('0004_atomic_ledger.sql', 'CREATE TABLE atomic_notes (id TEXT PRIMARY KEY);');

    expect(() =>
      runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }),
    ).toThrow('ledger blocked');
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atomic_notes'").get(),
    ).toBeUndefined();
    expect(migrationRow('0004_atomic_ledger.sql')).toBeUndefined();

    db.exec('DROP TRIGGER block_migration_ledger');
  });

  it('repairs a legacy applied FTS record when the table is absent', () => {
    db.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
      '0002_worldbook_fts5.sql',
      Date.now(),
    );
    writeMigration(
      '0002_worldbook_fts5.sql',
      'CREATE VIRTUAL TABLE worldbook_fts USING fts5(content);',
    );

    expect(runMigrations(db, { migrationsDir, capabilities: { fts5: false, trigram: false } }))
      .toEqual(['0002_worldbook_fts5.sql (skipped)']);
    expect(migrationRow('0002_worldbook_fts5.sql')).toEqual({
      status: 'skipped',
      detail: 'legacy ledger entry had no matching FTS table',
    });
  });
});
