import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AppDatabase, DatabaseStatement } from './contracts';
import { runMigrations, type MigrationDatabase } from './migrate';
import { ensurePersonaUpToDate } from './seed';
import { INIT_SQL } from './schema';

interface NativeStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  iterate(...params: unknown[]): IterableIterator<unknown>;
  run(...params: unknown[]): unknown;
}

interface NativeDatabaseHandle {
  close(): void;
  exec(sql: string): void;
  serialize(): Buffer;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): NativeStatement;
  transaction<T>(operation: () => T): () => T;
}

type NativeDatabaseConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => NativeDatabaseHandle;

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as NativeDatabaseConstructor;

function normalizeParameter(value: unknown): unknown {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

export class BetterSqliteDatabase implements AppDatabase, MigrationDatabase {
  private closed = false;
  private transactionActive = false;

  constructor(
    private readonly native: NativeDatabaseHandle,
    private readonly readOnly = false,
  ) {}

  beginBatch(): void {}

  endBatch(): void {}

  transaction<T>(operation: () => T): T {
    if (this.transactionActive) {
      throw new Error('Nested database transactions are not supported.');
    }
    this.transactionActive = true;
    try {
      return this.native.transaction(operation)();
    } finally {
      this.transactionActive = false;
    }
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  prepare(sql: string): DatabaseStatement {
    const statement = this.native.prepare(sql);
    const normalize = (params: unknown[]) => params.map(normalizeParameter);
    return {
      all: (...params) => statement.all(...normalize(params)) as Record<string, unknown>[],
      get: (...params) =>
        statement.get(...normalize(params)) as Record<string, unknown> | undefined,
      run: (...params) => {
        statement.run(...normalize(params));
      },
    };
  }

  iterate(sql: string, ...params: unknown[]): IterableIterator<Record<string, unknown>> {
    return this.native.prepare(sql).iterate(...params.map(normalizeParameter)) as IterableIterator<
      Record<string, unknown>
    >;
  }

  supportsFts5(tokenizer: 'unicode61' | 'trigram' = 'unicode61'): boolean {
    const probeName = `shorekeeper_fts_probe_${Date.now()}_${process.pid}`;
    try {
      this.native.exec(
        `CREATE VIRTUAL TABLE temp.${probeName} USING fts5(content, tokenize='${tokenizer}')`,
      );
      this.native.exec(`DROP TABLE temp.${probeName}`);
      return true;
    } catch {
      try {
        this.native.exec(`DROP TABLE IF EXISTS temp.${probeName}`);
      } catch {
        // The probe table was never created.
      }
      return false;
    }
  }

  checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
    this.native.pragma(`wal_checkpoint(${mode})`);
  }

  close(): void {
    if (this.closed) return;
    try {
      if (!this.readOnly) this.checkpoint('TRUNCATE');
    } finally {
      this.closed = true;
      this.native.close();
    }
  }

  async closeAsync(): Promise<void> {
    this.close();
  }

  exportDatabaseImage(): Uint8Array {
    if (this.closed) throw new Error('Cannot export a closed database.');
    return this.native.serialize();
  }
}

export interface OpenNativeDatabaseOptions {
  allowExisting?: boolean;
  initialize?: boolean;
  readonly?: boolean;
  beforeMigrate?: () => void;
}

/** Open a native database; production selection is controlled by the engine marker. */
export function openNativeDatabase(
  dbPath: string,
  options: OpenNativeDatabaseOptions = {},
): BetterSqliteDatabase {
  const existed = fs.existsSync(dbPath);
  if (existed && !options.allowExisting) {
    throw new Error('Opening an existing database with the native adapter requires allowExisting.');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const readOnly = options.readonly === true;
  const native = new BetterSqlite3(dbPath, {
    readonly: readOnly,
    fileMustExist: readOnly || existed,
  });
  const db = new BetterSqliteDatabase(native, readOnly);
  try {
    native.pragma('foreign_keys = ON');
    native.pragma('busy_timeout = 5000');
    if (!readOnly) {
      native.pragma('journal_mode = WAL');
      native.pragma('synchronous = FULL');
      native.pragma('wal_autocheckpoint = 1000');
    }

    if (options.initialize !== false) {
      db.exec(INIT_SQL);
      runMigrations(db, { beforeMigrate: options.beforeMigrate });
      ensurePersonaUpToDate(db);
    }
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the initialization error.
    }
    throw error;
  }
}
