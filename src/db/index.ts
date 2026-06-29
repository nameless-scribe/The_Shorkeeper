import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATABASE_DIR, DATABASE_PATH, WORKSPACE_DIR } from '../config/paths';
import { runMigrations } from './migrate';

const require = createRequire(import.meta.url);
// sql.js 为 CJS 包，在 Electron ESM 主进程中用 require 加载更稳定
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

export { DATABASE_DIR, DATABASE_PATH, WORKSPACE_DIR };

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
  return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file);
}

export class SqliteDb {
  constructor(
    private readonly sql: import('sql.js').SqlJsStatic,
    private readonly db: import('sql.js').SqlJsDatabase,
    private readonly dbPath: string,
  ) {}

  exec(sql: string): void {
    this.db.run(sql);
    this.persist();
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
        this.persist();
      },
    };
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  persist(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}

let dbInstance: SqliteDb | null = null;
let initPromise: Promise<SqliteDb> | null = null;

export function ensureDataDirs(): void {
  for (const dir of [DATABASE_DIR, WORKSPACE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export async function openDatabase(dbPath: string = DATABASE_PATH): Promise<SqliteDb> {
  ensureDataDirs();
  const SQL = await initSqlJs({ locateFile: getWasmPath });
  const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  const db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON');
  const wrapped = new SqliteDb(SQL, db, dbPath);
  wrapped.exec(INIT_SQL);
  runMigrations(wrapped);
  return wrapped;
}

export async function initDatabase(dbPath: string = DATABASE_PATH): Promise<SqliteDb> {
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

export type AppDatabase = SqliteDb;
