import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { assertNoPendingWal, createDatabaseBackup, writeDatabaseFileAtomically } from './index';
import { validateDatabaseFile } from './backup';
import {
  getNativeDatabasePath,
  readDatabaseEngineMarker,
  removeDatabaseEngineMarker,
  resolveDatabaseRuntime,
  writeDatabaseEngineMarker,
  type NativeDatabaseEngineMarker,
} from './engine-state';
import { inspectDatabaseHealth } from './health';
import { runMigrations } from './migrate';
import { BetterSqliteDatabase, openNativeDatabase } from './native-adapter';
import { resolveMigrationsDir } from './runtime-paths';

export interface NativeMigrationTableSnapshot {
  name: string;
  rowCount: number;
  sha256: string;
}

export interface NativeMigrationRehearsalReport {
  sourcePath: string;
  sourceSha256: string;
  backupPath: string;
  backupSha256: string;
  migratedCopyPath: string | null;
  migratedCopySizeBytes: number;
  sqliteVersion: string;
  appliedMigrations: string[];
  tableSnapshots: NativeMigrationTableSnapshot[];
  worldbookFtsRows: number;
  documentChunkFtsRows: number;
  rollbackVerified: boolean;
}

export interface NativeMigrationRehearsalOptions {
  keepMigratedCopy?: boolean;
  workingDirectory?: string;
}

export interface NativeCutoverResult {
  sourcePath: string;
  nativePath: string;
  markerPath: string;
  rollbackBackupPath: string;
  sourceSha256: string;
  nativeSha256: string;
}

export interface NativeRollbackResult {
  sourcePath: string;
  nativePath: string;
  markerPath: string;
  nativeSafetyBackupPath: string;
}

const FTS_TABLE_PREFIXES = ['worldbook_fts', 'document_chunks_fts'];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function updateFramed(hash: Hash, marker: string, data: Uint8Array): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(data.byteLength));
  hash.update(marker);
  hash.update(length);
  hash.update(data);
}

function updateValue(hash: Hash, value: unknown): void {
  if (value === null) {
    hash.update('N');
  } else if (value instanceof Uint8Array) {
    updateFramed(hash, 'B', value);
  } else if (typeof value === 'string') {
    updateFramed(hash, 'S', Buffer.from(value, 'utf8'));
  } else if (typeof value === 'number') {
    updateFramed(hash, 'D', Buffer.from(String(value), 'ascii'));
  } else if (typeof value === 'bigint') {
    updateFramed(hash, 'I', Buffer.from(value.toString(), 'ascii'));
  } else {
    throw new Error(`无法为数据库值生成迁移摘要: ${typeof value}`);
  }
}

function isApplicationTable(name: string): boolean {
  return name !== 'schema_migrations'
    && !name.startsWith('sqlite_')
    && !FTS_TABLE_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}_`));
}

function snapshotApplicationTables(db: BetterSqliteDatabase): NativeMigrationTableSnapshot[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter(isApplicationTable);

  return tables.map((name) => {
    const columns = db
      .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
      .all()
      .map((row) => String(row.name));
    if (columns.length === 0) throw new Error(`无法读取业务表结构: ${name}`);

    const hash = createHash('sha256');
    updateFramed(hash, 'T', Buffer.from(name, 'utf8'));
    for (const column of columns) updateFramed(hash, 'C', Buffer.from(column, 'utf8'));

    const selectColumns = columns.map(quoteIdentifier).join(', ');
    let rowCount = 0;
    for (const row of db.iterate(
      `SELECT ${selectColumns} FROM ${quoteIdentifier(name)} ORDER BY rowid`,
    )) {
      hash.update('R');
      for (const column of columns) updateValue(hash, row[column]);
      rowCount += 1;
    }
    return { name, rowCount, sha256: hash.digest('hex') };
  });
}

function assertSnapshotsEqual(
  before: NativeMigrationTableSnapshot[],
  after: NativeMigrationTableSnapshot[],
): void {
  const beforeByName = new Map(before.map((snapshot) => [snapshot.name, snapshot]));
  const afterByName = new Map(after.map((snapshot) => [snapshot.name, snapshot]));
  const names = new Set([...beforeByName.keys(), ...afterByName.keys()]);
  for (const name of names) {
    const source = beforeByName.get(name);
    const migrated = afterByName.get(name);
    if (!source || !migrated) {
      throw new Error(`迁移前后业务表集合不一致: ${name}`);
    }
    if (source.rowCount !== migrated.rowCount || source.sha256 !== migrated.sha256) {
      throw new Error(`迁移前后业务表数据不一致: ${name}`);
    }
  }
}

function scalarNumber(db: BetterSqliteDatabase, sql: string): number {
  const row = db.prepare(sql).get();
  return Number(row ? Object.values(row)[0] : 0);
}

function tableExists(db: BetterSqliteDatabase, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function validateNativeDatabase(db: BetterSqliteDatabase): {
  sqliteVersion: string;
  worldbookFtsRows: number;
  documentChunkFtsRows: number;
} {
  const integrity = db.prepare('PRAGMA integrity_check').all().map((row) => String(Object.values(row)[0]));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`native 副本完整性检查失败: ${integrity.join('; ') || '无结果'}`);
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('native 副本存在外键约束错误。');
  }

  const expectedMigrations = fs
    .readdirSync(resolveMigrationsDir())
    .filter((name) => name.endsWith('.sql') && name !== '0000_init.sql')
    .sort();
  const migrationRows = db
    .prepare('SELECT name, status FROM schema_migrations')
    .all() as Array<{ name: string; status: string }>;
  const statusByName = new Map(migrationRows.map((row) => [String(row.name), String(row.status)]));
  const incomplete = expectedMigrations.filter((name) => statusByName.get(name) !== 'applied');
  if (incomplete.length > 0) {
    throw new Error(`native 副本仍有未应用 migration: ${incomplete.join(', ')}`);
  }

  if (!tableExists(db, 'worldbook_fts') || !tableExists(db, 'document_chunks_fts')) {
    throw new Error('native 副本缺少预期的 FTS5 索引。');
  }
  db.exec("INSERT INTO worldbook_fts(worldbook_fts, rank) VALUES('integrity-check', 1)");
  db.exec("INSERT INTO document_chunks_fts(document_chunks_fts) VALUES('integrity-check')");

  const worldbookRows = scalarNumber(db, 'SELECT COUNT(*) FROM worldbook_entries');
  const worldbookFtsRows = scalarNumber(db, 'SELECT COUNT(*) FROM worldbook_fts');
  if (worldbookRows !== worldbookFtsRows) {
    throw new Error(`Worldbook FTS 行数不一致: source=${worldbookRows}, fts=${worldbookFtsRows}`);
  }

  const documentChunkRows = scalarNumber(db, 'SELECT COUNT(*) FROM document_chunks');
  const documentChunkFtsRows = scalarNumber(db, 'SELECT COUNT(*) FROM document_chunks_fts');
  const missingDocumentChunks = scalarNumber(
    db,
    `SELECT COUNT(*) FROM document_chunks c
     LEFT JOIN document_chunks_fts f ON f.chunk_id = c.id
     WHERE f.chunk_id IS NULL`,
  );
  if (documentChunkRows !== documentChunkFtsRows || missingDocumentChunks !== 0) {
    throw new Error(
      `RAG FTS 数据不一致: source=${documentChunkRows}, fts=${documentChunkFtsRows}, missing=${missingDocumentChunks}`,
    );
  }

  const version = db.prepare('SELECT sqlite_version() AS version').get();
  return {
    sqliteVersion: String(version?.version ?? 'unknown'),
    worldbookFtsRows,
    documentChunkFtsRows,
  };
}

function removeDatabaseArtifacts(databasePath: string): void {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function cleanupRehearsalCopy(databasePath: string): void {
  removeDatabaseArtifacts(databasePath);
}

export async function cutoverToNativeDatabase(
  sourcePath: string,
): Promise<NativeCutoverResult> {
  const resolvedSource = path.resolve(sourcePath);
  if (readDatabaseEngineMarker(resolvedSource)) {
    throw new Error('数据库已经处于 better-sqlite3 模式；请勿重复切换。');
  }
  const nativePath = getNativeDatabasePath(resolvedSource);
  if (fs.existsSync(nativePath)) {
    throw new Error(`检测到未激活的 native 数据库副本，请先检查或清理: ${nativePath}`);
  }
  if (fs.existsSync(`${nativePath}-wal`) || fs.existsSync(`${nativePath}-shm`)) {
    throw new Error(`检测到未激活的 native 数据库旁车文件，请先检查或清理: ${nativePath}-wal / ${nativePath}-shm`);
  }

  const rehearsal = await rehearseNativeMigration(resolvedSource, { keepMigratedCopy: true });
  const stagedPath = rehearsal.migratedCopyPath;
  if (!stagedPath) throw new Error('迁移演练没有留下可切换的 native 副本。');

  try {
    writeDatabaseFileAtomically(nativePath, fs.readFileSync(stagedPath));
    const native = openNativeDatabase(nativePath, { allowExisting: true, initialize: false });
    try {
      validateNativeDatabase(native);
    } finally {
      native.close();
    }

    const nativeSha256 = sha256File(nativePath);
    const marker: NativeDatabaseEngineMarker = {
      version: 1,
      engine: 'better-sqlite3',
      activatedAt: new Date().toISOString(),
      sourceSha256: rehearsal.sourceSha256,
      nativeSha256,
      rollbackBackupFile: path.basename(rehearsal.backupPath),
    };
    const markerPath = writeDatabaseEngineMarker(resolvedSource, marker);
    cleanupRehearsalCopy(stagedPath);
    return {
      sourcePath: resolvedSource,
      nativePath,
      markerPath,
      rollbackBackupPath: rehearsal.backupPath,
      sourceSha256: rehearsal.sourceSha256,
      nativeSha256,
    };
  } catch (error) {
    if (!readDatabaseEngineMarker(resolvedSource)) cleanupRehearsalCopy(nativePath);
    cleanupRehearsalCopy(stagedPath);
    throw error;
  }
}

export async function rollbackNativeDatabase(sourcePath: string): Promise<NativeRollbackResult> {
  const resolvedSource = path.resolve(sourcePath);
  const runtime = resolveDatabaseRuntime(resolvedSource);
  if (runtime.engine !== 'better-sqlite3' || !runtime.marker) {
    throw new Error('当前数据库不是 better-sqlite3 模式，无法执行 native 回滚。');
  }

  const native = openNativeDatabase(runtime.databasePath, { allowExisting: true, initialize: false });
  try {
    native.close();
  } catch (error) {
    try {
      native.close();
    } catch {
      // Preserve the first close error.
    }
    throw error;
  }

  const sourceBackupPath = path.join(path.dirname(resolvedSource), runtime.marker.rollbackBackupFile);
  const sourceBackup = await validateDatabaseFile(sourceBackupPath);
  if (sourceBackup.sha256 !== runtime.marker.sourceSha256) {
    throw new Error('native 回滚备份 SHA-256 与引擎标记不一致，已阻止回滚。');
  }
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`原 sql.js 数据库不存在，已阻止回滚: ${resolvedSource}`);
  }

  const nativeSafetyBackup = createDatabaseBackup(runtime.databasePath, 'pre-native-rollback');
  if (!nativeSafetyBackup) throw new Error('无法创建 native 回滚前安全备份。');
  removeDatabaseEngineMarker(resolvedSource);
  return {
    sourcePath: resolvedSource,
    nativePath: runtime.databasePath,
    markerPath: runtime.markerPath,
    nativeSafetyBackupPath: nativeSafetyBackup,
  };
}

export async function rehearseNativeMigration(
  sourcePath: string,
  options: NativeMigrationRehearsalOptions = {},
): Promise<NativeMigrationRehearsalReport> {
  const resolvedSource = path.resolve(sourcePath);
  const health = await inspectDatabaseHealth(resolvedSource);
  if (health.errors.length > 0) {
    throw new Error(`源数据库健康检查未通过: ${health.errors.join(' ')}`);
  }
  if (health.migrations.pending.length > 0 || health.migrations.partial > 0 || health.migrations.unknown > 0) {
    throw new Error('源数据库 migration 状态不允许进行 native 迁移演练。');
  }
  assertNoPendingWal(resolvedSource);
  if (health.sidecars.shmBytes > 0) {
    throw new Error('检测到非空 SHM 文件；请完全退出应用和 SQLite 工具后重试。');
  }

  const sourceValidation = await validateDatabaseFile(resolvedSource);
  const backupPath = createDatabaseBackup(resolvedSource, 'pre-native');
  if (!backupPath) throw new Error(`源数据库不存在: ${resolvedSource}`);
  const backupValidation = await validateDatabaseFile(backupPath);
  if (sourceValidation.sha256 !== backupValidation.sha256) {
    throw new Error('native 迁移备份与源数据库 SHA-256 不一致。');
  }
  const sourceAfterBackup = await validateDatabaseFile(resolvedSource);
  if (sourceAfterBackup.sha256 !== sourceValidation.sha256) {
    throw new Error('备份期间源数据库发生变化；请完全退出应用后重试。');
  }

  const workingDirectory = path.resolve(options.workingDirectory ?? path.dirname(resolvedSource));
  fs.mkdirSync(workingDirectory, { recursive: true });
  const runId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const basename = path.basename(resolvedSource);
  const migratedPath = path.join(workingDirectory, `.${basename}.native-rehearsal-${runId}.db`);
  const rollbackPath = path.join(workingDirectory, `.${basename}.native-rollback-${runId}.db`);
  let db: BetterSqliteDatabase | undefined;
  let succeeded = false;

  try {
    writeDatabaseFileAtomically(migratedPath, fs.readFileSync(backupPath));
    db = openNativeDatabase(migratedPath, { allowExisting: true, initialize: false });
    const before = snapshotApplicationTables(db);
    const appliedMigrations = runMigrations(db);
    const after = snapshotApplicationTables(db);
    assertSnapshotsEqual(before, after);
    const nativeValidation = validateNativeDatabase(db);
    db.close();
    db = undefined;

    if (fs.existsSync(`${migratedPath}-wal`) && fs.statSync(`${migratedPath}-wal`).size > 0) {
      throw new Error('native 副本关闭后仍存在非空 WAL。');
    }
    const migratedCopySizeBytes = fs.statSync(migratedPath).size;

    writeDatabaseFileAtomically(rollbackPath, fs.readFileSync(backupPath));
    const rollbackValidation = await validateDatabaseFile(rollbackPath);
    if (rollbackValidation.sha256 !== sourceValidation.sha256) {
      throw new Error('回滚探针与迁移前源数据库 SHA-256 不一致。');
    }

    const sourceAfterRehearsal = await validateDatabaseFile(resolvedSource);
    if (sourceAfterRehearsal.sha256 !== sourceValidation.sha256) {
      throw new Error('演练期间源数据库发生变化；本次结果无效。');
    }

    succeeded = true;
    return {
      sourcePath: resolvedSource,
      sourceSha256: sourceValidation.sha256,
      backupPath,
      backupSha256: backupValidation.sha256,
      migratedCopyPath: options.keepMigratedCopy ? migratedPath : null,
      migratedCopySizeBytes,
      sqliteVersion: nativeValidation.sqliteVersion,
      appliedMigrations,
      tableSnapshots: after,
      worldbookFtsRows: nativeValidation.worldbookFtsRows,
      documentChunkFtsRows: nativeValidation.documentChunkFtsRows,
      rollbackVerified: true,
    };
  } finally {
    try {
      db?.close();
    } finally {
      removeDatabaseArtifacts(rollbackPath);
      if (!succeeded || !options.keepMigratedCopy) removeDatabaseArtifacts(migratedPath);
    }
  }
}
