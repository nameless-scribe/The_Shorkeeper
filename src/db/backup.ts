import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createDatabaseBackup, writeDatabaseFileAtomically } from './index';
import { openNativeDatabase } from './native-adapter';
import { resolveSqlWasmPath } from './runtime-paths';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

export type DatabaseBackupKind =
  | 'manual'
  | 'pre-migration'
  | 'pre-native'
  | 'pre-native-rollback'
  | 'pre-restore'
  | 'legacy'
  | 'corrupt';

export interface DatabaseBackupInfo {
  path: string;
  filename: string;
  kind: DatabaseBackupKind;
  sizeBytes: number;
  modifiedAt: string;
}

export interface DatabaseFileValidation {
  path: string;
  sizeBytes: number;
  sha256: string;
  sqliteVersion: string;
  integrityMessages: string[];
}

function backupKind(dbBasename: string, filename: string): DatabaseBackupKind | null {
  if (filename.startsWith(`${dbBasename}.manual.bak-`)) return 'manual';
  if (filename.startsWith(`${dbBasename}.pre-migration.bak-`)) return 'pre-migration';
  if (filename.startsWith(`${dbBasename}.pre-native.bak-`)) return 'pre-native';
  if (filename.startsWith(`${dbBasename}.pre-native-rollback.bak-`)) return 'pre-native-rollback';
  if (filename.startsWith(`${dbBasename}.pre-restore.bak-`)) return 'pre-restore';
  if (filename.startsWith(`${dbBasename}.bak-`)) return 'legacy';
  if (filename.startsWith(`${dbBasename}.corrupt-`) && filename.endsWith('.bak')) {
    return 'corrupt';
  }
  return null;
}

function queryValues(db: import('sql.js').SqlJsDatabase, sql: string): string[] {
  const statement = db.prepare(sql);
  try {
    const values: string[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      values.push(String(Object.values(row)[0]));
    }
    return values;
  } finally {
    statement.free();
  }
}

export async function validateDatabaseFile(filePath: string): Promise<DatabaseFileValidation> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`数据库文件不存在: ${filePath}`);
  }

  const data = fs.readFileSync(filePath);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const SQL = await initSqlJs({ locateFile: resolveSqlWasmPath });
  let db: import('sql.js').SqlJsDatabase | undefined;
  try {
    db = new SQL.Database(data);
    const integrityMessages = queryValues(db, 'PRAGMA integrity_check');
    if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
      throw new Error(`SQLite 完整性检查失败: ${integrityMessages.join('; ') || '无结果'}`);
    }
    const sqliteVersion = queryValues(db, 'SELECT sqlite_version()')[0] ?? 'unknown';
    return {
      path: filePath,
      sizeBytes: data.byteLength,
      sha256,
      sqliteVersion,
      integrityMessages,
    };
  } catch (error) {
    db?.close();
    try {
      const native = openNativeDatabase(filePath, {
        allowExisting: true,
        initialize: false,
        readonly: true,
      });
      try {
        const integrityMessages = native
          .prepare('PRAGMA integrity_check')
          .all()
          .map((row) => String(Object.values(row)[0]));
        if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
          throw new Error(`SQLite 完整性检查失败: ${integrityMessages.join('; ') || '无结果'}`);
        }
        const sqliteVersion = String(native.prepare('SELECT sqlite_version() AS version').get()?.version ?? 'unknown');
        return {
          path: filePath,
          sizeBytes: data.byteLength,
          sha256,
          sqliteVersion,
          integrityMessages,
        };
      } finally {
        native.close();
      }
    } catch (nativeError) {
      const sqlMessage = error instanceof Error ? error.message : String(error);
      const nativeMessage = nativeError instanceof Error ? nativeError.message : String(nativeError);
      throw new Error(`无法读取 SQLite 数据库: sql.js=${sqlMessage}; native=${nativeMessage}`, {
        cause: nativeError,
      });
    }
  } finally {
    db?.close();
  }
}

export function listDatabaseBackups(dbPath: string): DatabaseBackupInfo[] {
  const directory = path.dirname(dbPath);
  const dbBasename = path.basename(dbPath);
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, kind: backupKind(dbBasename, entry.name) }))
    .filter(
      (item): item is { entry: fs.Dirent; kind: DatabaseBackupKind } => item.kind !== null,
    )
    .map(({ entry, kind }) => {
      const backupPath = path.join(directory, entry.name);
      const stat = fs.statSync(backupPath);
      return {
        path: backupPath,
        filename: entry.name,
        kind,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function createManualDatabaseBackup(
  dbPath: string,
): Promise<{ backup: DatabaseBackupInfo; validation: DatabaseFileValidation }> {
  await validateDatabaseFile(dbPath);
  const backupPath = createDatabaseBackup(dbPath, 'manual');
  if (!backupPath) throw new Error(`数据库文件不存在: ${dbPath}`);
  const validation = await validateDatabaseFile(backupPath);
  const backup = listDatabaseBackups(dbPath).find((item) => item.path === backupPath);
  if (!backup) throw new Error(`备份创建后无法读取: ${backupPath}`);
  return { backup, validation };
}

export interface PruneBackupsResult {
  keep: number;
  retained: DatabaseBackupInfo[];
  candidates: DatabaseBackupInfo[];
  deleted: DatabaseBackupInfo[];
}

export function pruneDatabaseBackups(
  dbPath: string,
  options: { keep: number; execute?: boolean },
): PruneBackupsResult {
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error('备份保留数量必须是大于等于 1 的整数。');
  }

  const usable = listDatabaseBackups(dbPath).filter((backup) => backup.kind !== 'corrupt');
  const retained = usable.slice(0, options.keep);
  const candidates = usable.slice(options.keep);
  const deleted: DatabaseBackupInfo[] = [];
  if (options.execute) {
    for (const backup of candidates) {
      fs.unlinkSync(backup.path);
      deleted.push(backup);
    }
  }
  return { keep: options.keep, retained, candidates, deleted };
}

function assertRestoreSource(dbPath: string, backupPath: string): void {
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedBackupPath = path.resolve(backupPath);
  if (resolvedDbPath === resolvedBackupPath) {
    throw new Error('备份文件不能与目标数据库相同。');
  }

  const knownBackup = listDatabaseBackups(dbPath).some(
    (backup) => path.resolve(backup.path) === resolvedBackupPath && backup.kind !== 'corrupt',
  );
  if (!knownBackup) {
    throw new Error('只能恢复当前数据库目录中由系统识别的可用备份。');
  }
}

export interface RestoreDatabaseResult {
  restoredFrom: string;
  safetyBackup: string | null;
  restoredValidation: DatabaseFileValidation;
  movedShmPath: string | null;
}

export async function restoreDatabaseBackup(
  dbPath: string,
  backupPath: string,
): Promise<RestoreDatabaseResult> {
  assertRestoreSource(dbPath, backupPath);
  const backupValidation = await validateDatabaseFile(backupPath);
  const walPath = `${dbPath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error('检测到非空 WAL，可能包含未写回主库的数据；恢复已中止。');
  }

  const safetyBackup = createDatabaseBackup(dbPath, 'pre-restore');
  const currentData = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const shmPath = `${dbPath}-shm`;
  let movedShmPath: string | null = null;
  if (fs.existsSync(shmPath)) {
    movedShmPath = `${shmPath}.pre-restore-${Date.now()}.bak`;
    fs.renameSync(shmPath, movedShmPath);
  }

  try {
    writeDatabaseFileAtomically(dbPath, fs.readFileSync(backupPath));
    const restoredValidation = await validateDatabaseFile(dbPath);
    if (restoredValidation.sha256 !== backupValidation.sha256) {
      throw new Error('恢复后的数据库校验和与备份不一致。');
    }
    return { restoredFrom: backupPath, safetyBackup, restoredValidation, movedShmPath };
  } catch (error) {
    if (currentData) {
      writeDatabaseFileAtomically(dbPath, currentData);
    } else if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (movedShmPath && fs.existsSync(movedShmPath) && !fs.existsSync(shmPath)) {
      fs.renameSync(movedShmPath, shmPath);
    }
    throw error;
  }
}
