import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDatabaseDir, getDatabasePath, getWorkspaceDir, getAppearanceDir } from '../config/paths';
import { resolveSqlWasmPath } from './runtime-paths';
import { runMigrations } from './migrate';
import { ensurePersonaUpToDate } from './seed';
import { SHOREKEEPER_PERSONA } from './seeds';
import { INIT_SQL } from './schema';
import type { AppDatabase, ManagedDatabase } from './contracts';
import { openNativeDatabase } from './native-adapter';
import { resolveDatabaseRuntime } from './engine-state';

const require = createRequire(import.meta.url);
// sql.js 为 CJS 包，在 Electron ESM 主进程中用 require 加载更稳定
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

export { getDatabaseDir, getDatabasePath, getWorkspaceDir };
export { INIT_SQL } from './schema';
export type { AppDatabase, DatabaseStatement, ManagedDatabase } from './contracts';

/** sql.js only reads the main database image and must never ignore committed WAL data. */
export function assertNoPendingWal(dbPath: string): void {
  const walPath = `${dbPath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error(
      `检测到非空 WAL 文件，无法安全读取或复制数据库: ${walPath}。请先关闭 SQLite 写入程序并完成 checkpoint。`,
    );
  }
}

let temporaryFileSequence = 0;

function uniqueSiblingPath(targetPath: string, label: string): string {
  temporaryFileSequence += 1;
  return `${targetPath}.${label}-${process.pid}-${Date.now()}-${temporaryFileSequence}`;
}

/** Write a complete SQLite image without exposing a partially written main file. */
export function writeDatabaseFileAtomically(dbPath: string, data: Uint8Array): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const temporaryPath = uniqueSiblingPath(dbPath, 'tmp');
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx');
    fs.writeFileSync(fileDescriptor, data);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryPath, dbPath);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }
}

/** Create an immutable point-in-time copy before changing database schema. */
export function createDatabaseBackup(
  dbPath: string,
  reason = 'pre-migration',
): string | null {
  if (!fs.existsSync(dbPath)) return null;
  assertNoPendingWal(dbPath);

  const backupPath = uniqueSiblingPath(dbPath, `${reason}.bak`);
  writeDatabaseFileAtomically(backupPath, fs.readFileSync(dbPath));
  return backupPath;
}

function getWasmPath(file = 'sql-wasm.wasm'): string {
  return resolveSqlWasmPath(file);
}

export class SqliteDb implements AppDatabase {
  private closed = false;
  private persistDeferred = 0;
  private transactionActive = false;

  constructor(
    private readonly sql: import('sql.js').SqlJsStatic,
    private db: import('sql.js').SqlJsDatabase,
    private readonly dbPath: string,
  ) {}

  beginBatch(): void {
    this.persistDeferred += 1;
  }

  endBatch(): void {
    this.finishBatch(true);
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionActive) {
      throw new Error('Nested database transactions are not supported.');
    }
    this.beginBatch();
    let transactionOpen = false;
    try {
      this.db.run('BEGIN IMMEDIATE');
      transactionOpen = true;
      this.transactionActive = true;
      const result = operation();
      this.db.run('COMMIT');
      transactionOpen = false;
      this.transactionActive = false;
      try {
        this.finishBatch(true);
      } catch (persistError) {
        this.restorePersistedState(persistError);
        throw persistError;
      }
      return result;
    } catch (error) {
      this.transactionActive = false;
      if (transactionOpen) {
        try {
          this.db.run('ROLLBACK');
        } catch (rollbackError) {
          console.error('[db] transaction rollback 失败:', rollbackError);
        }
      }
      if (this.persistDeferred > 0) {
        this.finishBatch(false);
      }
      throw error;
    }
  }

  supportsFts5(tokenizer: 'unicode61' | 'trigram' = 'unicode61'): boolean {
    const probeName = `shorekeeper_fts_probe_${Date.now()}_${temporaryFileSequence++}`;
    try {
      this.db.run(
        `CREATE VIRTUAL TABLE temp.${probeName} USING fts5(content, tokenize='${tokenizer}')`,
      );
      this.db.run(`DROP TABLE temp.${probeName}`);
      return true;
    } catch {
      try {
        this.db.run(`DROP TABLE IF EXISTS temp.${probeName}`);
      } catch {
        // The probe table was never created.
      }
      return false;
    }
  }

  exec(sql: string): void {
    this.runMutation(() => this.db.run(sql));
  }

  prepare(sql: string) {
    return {
      all: (...params: unknown[]) => {
        const stmt = this.db.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject() as Record<string, unknown>);
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      get: (...params: unknown[]) => {
        const stmt = this.db.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          const hasRow = stmt.step();
          return hasRow ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
        } finally {
          stmt.free();
        }
      },
      run: (...params: unknown[]) => {
        this.runMutation(() => {
          const stmt = this.db.prepare(sql);
          try {
            if (params.length) stmt.bind(params);
            stmt.step();
          } finally {
            stmt.free();
          }
        });
      },
    };
  }

  private runMutation(operation: () => void): void {
    const restoreOnFailure = this.persistDeferred === 0;
    try {
      operation();
      this.maybePersist();
    } catch (error) {
      if (restoreOnFailure) this.restorePersistedState(error);
      throw error;
    }
  }

  private restorePersistedState(originalError: unknown): void {
    try {
      const restored = new this.sql.Database(
        fs.existsSync(this.dbPath) ? fs.readFileSync(this.dbPath) : undefined,
      );
      restored.run('PRAGMA foreign_keys = ON');
      const replaced = this.db;
      this.db = restored;
      replaced.close();
    } catch (restoreError) {
      throw new AggregateError(
        [originalError, restoreError],
        '数据库落盘失败，且内存状态无法恢复。',
      );
    }
  }

  private maybePersist(): void {
    if (this.persistDeferred === 0) {
      this.persist();
    }
  }

  private finishBatch(persistWhenComplete: boolean): void {
    if (this.persistDeferred <= 0) {
      throw new Error('Database batch is not active.');
    }
    this.persistDeferred -= 1;
    if (persistWhenComplete && this.persistDeferred === 0) {
      this.persist();
    }
  }

  /** Ensure the latest in-memory image is durably visible to a new process. */
  async flushPersist(): Promise<void> {
    if (!this.closed) {
      this.persistSync();
    }
  }

  close(): void {
    if (this.closed) return;
    this.persistSync();
    this.closed = true;
    this.db.close();
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    await this.flushPersist();
    this.closed = true;
    this.db.close();
  }

  private persistSync(): void {
    if (this.closed) return;
    writeDatabaseFileAtomically(this.dbPath, this.db.export());
    // sql.js 的 export() 会关闭再重新打开内部连接，连接级 PRAGMA 随之丢失，必须重新启用外键。
    this.db.run('PRAGMA foreign_keys = ON');
  }

  persist(): void {
    if (this.closed) return;
    this.persistSync();
  }
}

let dbInstance: ManagedDatabase | null = null;
let initPromise: Promise<ManagedDatabase> | null = null;

export function ensureDataDirs(): void {
  for (const dir of [getDatabaseDir(), getWorkspaceDir(), getAppearanceDir()]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function backupCorruptDatabase(dbPath: string): void {
  const backupPath = `${dbPath}.corrupt-${Date.now()}.bak`;
  fs.renameSync(dbPath, backupPath);
  console.warn(`[db] 数据库文件损坏，已备份至 ${backupPath}，将创建新库。`);
}

function loadDatabaseBuffer(
  SQL: import('sql.js').SqlJsStatic,
  dbPath: string,
): Buffer | undefined {
  if (!fs.existsSync(dbPath)) return undefined;
  assertNoPendingWal(dbPath);

  const buffer = fs.readFileSync(dbPath);
  try {
    const probe = new SQL.Database(buffer);
    probe.run('PRAGMA foreign_keys = ON');
    probe.run('SELECT 1');
    probe.close();
    return buffer;
  } catch {
    backupCorruptDatabase(dbPath);
    return undefined;
  }
}

function hasTable(db: import('sql.js').SqlJsDatabase, tableName: string): boolean {
  const statement = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  );
  try {
    statement.bind([tableName]);
    return statement.step();
  } finally {
    statement.free();
  }
}

export async function openDatabase(dbPath: string = getDatabasePath()): Promise<SqliteDb> {
  ensureDataDirs();
  const SQL = await initSqlJs({ locateFile: getWasmPath });
  const fileBuffer = loadDatabaseBuffer(SQL, dbPath);
  const db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON');
  const wrapped = new SqliteDb(SQL, db, dbPath);

  let migrationBackupPath: string | null | undefined;
  const backupBeforeSchemaChange = () => {
    if (migrationBackupPath === undefined) {
      migrationBackupPath = createDatabaseBackup(dbPath);
      if (migrationBackupPath) {
        console.info(`[db] 迁移前备份已创建: ${migrationBackupPath}`);
      }
    }
  };

  wrapped.beginBatch();
  try {
    const baseSchemaMissing = ['sessions', 'messages', 'app_settings'].some(
      (tableName) => !hasTable(db, tableName),
    );
    if (fileBuffer && baseSchemaMissing) {
      backupBeforeSchemaChange();
    }
    wrapped.exec(INIT_SQL);
    runMigrations(wrapped, { beforeMigrate: backupBeforeSchemaChange });
    if (ensurePersonaUpToDate(wrapped)) {
      console.info('[seed] 人设已升级至', SHOREKEEPER_PERSONA.version);
    }
  } finally {
    wrapped.endBatch();
  }
  return wrapped;
}

export async function initDatabase(dbPath: string = getDatabasePath()): Promise<ManagedDatabase> {
  if (dbInstance) return dbInstance;
  if (!initPromise) {
    const runtime = resolveDatabaseRuntime(dbPath);
    initPromise = runtime.engine === 'better-sqlite3'
      ? Promise.resolve(openNativeDatabase(runtime.databasePath, {
        allowExisting: true,
        beforeMigrate: () => {
          const backup = createDatabaseBackup(runtime.databasePath, 'pre-migration');
          if (backup) console.info(`[db] native 迁移前备份已创建: ${backup}`);
        },
      }))
      : openDatabase(runtime.databasePath);
  }
  try {
    dbInstance = await initPromise;
    return dbInstance;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export function getDatabase(): ManagedDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    initPromise = null;
  }
}

export async function closeDatabaseAsync(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
    initPromise = null;
  }
}
