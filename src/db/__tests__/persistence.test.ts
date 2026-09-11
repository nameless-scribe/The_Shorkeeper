import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseBackup, SqliteDb, writeDatabaseFileAtomically } from '../index';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

describe('database file persistence', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-persistence-'));
    dbPath = path.join(tmpDir, 'shorekeeper.db');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createDb(): Promise<{
    db: SqliteDb;
    raw: import('sql.js').SqlJsDatabase;
    SQL: import('sql.js').SqlJsStatic;
  }> {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const raw = new SQL.Database();
    return { db: new SqliteDb(SQL, raw, dbPath), raw, SQL };
  }

  function countEntries(database: import('sql.js').SqlJsDatabase): number {
    const statement = database.prepare('SELECT COUNT(*) AS count FROM entries');
    try {
      statement.step();
      return Number(statement.getAsObject().count);
    } finally {
      statement.free();
    }
  }

  it('atomically replaces the database image and removes its temporary file', () => {
    fs.writeFileSync(dbPath, 'old database');

    writeDatabaseFileAtomically(dbPath, Buffer.from('new database'));

    expect(fs.readFileSync(dbPath, 'utf8')).toBe('new database');
    expect(fs.readdirSync(tmpDir)).toEqual(['shorekeeper.db']);
  });

  it('keeps the original database when replacement fails', () => {
    fs.writeFileSync(dbPath, 'old database');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed');
    });

    expect(() => writeDatabaseFileAtomically(dbPath, Buffer.from('new database'))).toThrow(
      'rename failed',
    );
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('old database');
    expect(fs.readdirSync(tmpDir)).toEqual(['shorekeeper.db']);
  });

  it('copies the current database before migration', () => {
    fs.writeFileSync(dbPath, 'database snapshot');

    const backupPath = createDatabaseBackup(dbPath);

    expect(backupPath).not.toBeNull();
    expect(fs.readFileSync(backupPath!, 'utf8')).toBe('database snapshot');
    expect(backupPath).toContain('.pre-migration.bak-');
  });

  it('restores batch persistence after a nested BEGIN is rejected', async () => {
    const { db, SQL } = await createDb();
    db.exec('CREATE TABLE entries (id INTEGER);');

    expect(() =>
      db.transaction(() => db.transaction(() => undefined)),
    ).toThrow('Nested database transactions are not supported');
    db.prepare('INSERT INTO entries VALUES (?)').run(1);

    const disk = new SQL.Database(fs.readFileSync(dbPath));
    expect(countEntries(disk)).toBe(1);
    disk.close();
    db.close();
  });

  it('restores batch persistence when BEGIN itself fails', async () => {
    const { db, raw, SQL } = await createDb();
    db.exec('CREATE TABLE entries (id INTEGER);');
    const originalRun = raw.run.bind(raw);
    const run = vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'BEGIN IMMEDIATE') throw new Error('forced BEGIN failure');
      return originalRun(sql, params);
    });

    expect(() => db.transaction(() => undefined)).toThrow('forced BEGIN failure');
    run.mockRestore();
    db.prepare('INSERT INTO entries VALUES (?)').run(1);

    const disk = new SQL.Database(fs.readFileSync(dbPath));
    expect(countEntries(disk)).toBe(1);
    disk.close();
    db.close();
  });

  it('propagates persistence failures to the write caller', async () => {
    const { db, SQL } = await createDb();
    db.exec('CREATE TABLE entries (id INTEGER);');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk replacement failed');
    });

    expect(() => db.prepare('INSERT INTO entries VALUES (?)').run(1)).toThrow(
      'disk replacement failed',
    );
    rename.mockRestore();

    expect(db.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count).toBe(0);
    const disk = new SQL.Database(fs.readFileSync(dbPath));
    expect(countEntries(disk)).toBe(0);
    disk.close();
    db.close();
  });

  it('restores memory and disk state when a committed transaction cannot persist', async () => {
    const { db, SQL } = await createDb();
    db.exec('CREATE TABLE entries (id INTEGER);');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('transaction persistence failed');
    });

    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO entries VALUES (?)').run(1);
        db.prepare('INSERT INTO entries VALUES (?)').run(2);
      }),
    ).toThrow('transaction persistence failed');
    rename.mockRestore();

    expect(db.prepare('SELECT COUNT(*) AS count FROM entries').get()?.count).toBe(0);
    const disk = new SQL.Database(fs.readFileSync(dbPath));
    expect(countEntries(disk)).toBe(0);
    disk.close();
    db.close();
  });
});
