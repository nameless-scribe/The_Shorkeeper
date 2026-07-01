import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDatabaseDir, getDatabasePath, getWorkspaceDir, getAppearanceDir } from '../config/paths';
import { resolveSqlWasmPath } from './runtime-paths';
import { runMigrations } from './migrate';
import { ensurePersonaUpToDate } from './seed';
import { SHOREKEEPER_PERSONA } from './seeds';

const require = createRequire(import.meta.url);
// sql.js 为 CJS 包，在 Electron ESM 主进程中用 require 加载更稳定
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

export { getDatabaseDir, getDatabasePath, getWorkspaceDir };

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT DEFAULT '新对话' NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function getWasmPath(file = 'sql-wasm.wasm'): string {
  return resolveSqlWasmPath(file);
}

export class SqliteDb {
  private persistQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private persistDeferred = 0;

  constructor(
    private readonly sql: import('sql.js').SqlJsStatic,
    private readonly db: import('sql.js').SqlJsDatabase,
    private readonly dbPath: string,
  ) {}

  beginBatch(): void {
    this.persistDeferred += 1;
  }

  endBatch(): void {
    if (this.persistDeferred > 0) {
      this.persistDeferred -= 1;
    }
    if (this.persistDeferred === 0) {
      this.persist();
    }
  }

  exec(sql: string): void {
    this.db.run(sql);
    this.maybePersist();
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
        const stmt = this.db.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          stmt.step();
        } finally {
          stmt.free();
        }
        this.maybePersist();
      },
    };
  }

  private maybePersist(): void {
    if (this.persistDeferred === 0) {
      this.persist();
    }
  }

  /** 等待异步 persist 队列落盘（批量脚本退出前调用） */
  async flushPersist(): Promise<void> {
    await this.persistQueue;
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

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  persist(): void {
    if (this.closed) return;

    this.persistQueue = this.persistQueue
      .then(() => {
        this.persistSync();
      })
      .catch((err) => {
        console.error('[db] persist 失败:', err);
      });
  }
}

let dbInstance: SqliteDb | null = null;
let initPromise: Promise<SqliteDb> | null = null;

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

export async function openDatabase(dbPath: string = getDatabasePath()): Promise<SqliteDb> {
  ensureDataDirs();
  const SQL = await initSqlJs({ locateFile: getWasmPath });
  const fileBuffer = loadDatabaseBuffer(SQL, dbPath);
  const db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON');
  const wrapped = new SqliteDb(SQL, db, dbPath);
  wrapped.exec(INIT_SQL);
  runMigrations(wrapped);
  if (ensurePersonaUpToDate(wrapped)) {
    console.info('[seed] 人设已升级至', SHOREKEEPER_PERSONA.version);
  }
  return wrapped;
}

export async function initDatabase(dbPath: string = getDatabasePath()): Promise<SqliteDb> {
  if (dbInstance) return dbInstance;
  if (!initPromise) {
    initPromise = openDatabase(dbPath);
  }
  dbInstance = await initPromise;
  return dbInstance;
}

export function getDatabase(): SqliteDb {
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

export type AppDatabase = SqliteDb;
