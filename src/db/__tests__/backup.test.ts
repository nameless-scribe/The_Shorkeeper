import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createManualDatabaseBackup,
  listDatabaseBackups,
  pruneDatabaseBackups,
  restoreDatabaseBackup,
  validateDatabaseFile,
} from '../backup';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

describe('database backup lifecycle', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function writeDatabase(value: string): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = new SQL.Database();
    db.run('CREATE TABLE state (value TEXT);');
    db.run('INSERT INTO state VALUES (?);', [value]);
    fs.writeFileSync(dbPath, db.export());
    db.close();
  }

  async function readValue(): Promise<string> {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const statement = db.prepare('SELECT value FROM state');
    try {
      statement.step();
      return String(statement.getAsObject().value);
    } finally {
      statement.free();
      db.close();
    }
  }

  it('creates and validates a manual backup', async () => {
    await writeDatabase('original');

    const result = await createManualDatabaseBackup(dbPath);

    expect(result.backup.kind).toBe('manual');
    expect(result.validation.integrityMessages).toEqual(['ok']);
    expect(await validateDatabaseFile(result.backup.path)).toMatchObject({
      sha256: result.validation.sha256,
    });
  });

  it('restores a validated backup and keeps a safety backup', async () => {
    await writeDatabase('before');
    const { backup } = await createManualDatabaseBackup(dbPath);
    await writeDatabase('after');

    const result = await restoreDatabaseBackup(dbPath, backup.path);

    expect(await readValue()).toBe('before');
    expect(result.safetyBackup).not.toBeNull();
    expect(fs.existsSync(result.safetyBackup!)).toBe(true);
    expect(result.restoredValidation.sha256).toBe((await validateDatabaseFile(backup.path)).sha256);
  });

  it('refuses restore while a non-empty WAL exists', async () => {
    await writeDatabase('before');
    const { backup } = await createManualDatabaseBackup(dbPath);
    await writeDatabase('after');
    fs.writeFileSync(`${dbPath}-wal`, 'pending transaction');

    await expect(restoreDatabaseBackup(dbPath, backup.path)).rejects.toThrow('检测到非空 WAL');
    expect(await readValue()).toBe('after');
  });

  it('previews and deletes backups beyond the retention count', async () => {
    await writeDatabase('value');
    for (let index = 0; index < 3; index += 1) {
      const { backup } = await createManualDatabaseBackup(dbPath);
      const timestamp = new Date(Date.now() + index * 1000);
      fs.utimesSync(backup.path, timestamp, timestamp);
    }

    const preview = pruneDatabaseBackups(dbPath, { keep: 2 });
    expect(preview.candidates).toHaveLength(1);
    expect(preview.deleted).toHaveLength(0);

    const result = pruneDatabaseBackups(dbPath, { keep: 2, execute: true });
    expect(result.deleted).toHaveLength(1);
    expect(listDatabaseBackups(dbPath)).toHaveLength(2);
  });

  it('rejects a corrupt database before creating a backup', async () => {
    fs.writeFileSync(dbPath, 'not sqlite');

    await expect(createManualDatabaseBackup(dbPath)).rejects.toThrow('无法读取 SQLite 数据库');
    expect(listDatabaseBackups(dbPath)).toEqual([]);
  });

  it('rejects manual backup when a non-empty WAL may contain newer commits', async () => {
    await writeDatabase('main image');
    fs.writeFileSync(`${dbPath}-wal`, 'pending transaction');

    await expect(createManualDatabaseBackup(dbPath)).rejects.toThrow('检测到非空 WAL');
    expect(listDatabaseBackups(dbPath)).toEqual([]);
  });
});
