import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DatabaseEngine = 'sql.js' | 'better-sqlite3';

export interface NativeDatabaseEngineMarker {
  version: 1;
  engine: 'better-sqlite3';
  activatedAt: string;
  sourceSha256: string;
  nativeSha256: string;
  rollbackBackupFile: string;
}

export interface DatabaseRuntimeSelection {
  engine: DatabaseEngine;
  databasePath: string;
  baseDatabasePath: string;
  markerPath: string;
  marker: NativeDatabaseEngineMarker | null;
}

export function getDatabaseEngineMarkerPath(baseDatabasePath: string): string {
  return `${path.resolve(baseDatabasePath)}.engine.json`;
}

export function getNativeDatabasePath(baseDatabasePath: string): string {
  const resolved = path.resolve(baseDatabasePath);
  const extension = path.extname(resolved) || '.db';
  const stem = path.basename(resolved, path.extname(resolved));
  return path.join(path.dirname(resolved), `${stem}.native${extension}`);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function parseMarker(baseDatabasePath: string, raw: string): NativeDatabaseEngineMarker {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error('数据库引擎标记不是有效 JSON，已阻止启动。', { cause: error });
  }
  if (!value || typeof value !== 'object') {
    throw new Error('数据库引擎标记结构无效，已阻止启动。');
  }
  const marker = value as Partial<NativeDatabaseEngineMarker>;
  const expectedBackupPrefix = `${path.basename(path.resolve(baseDatabasePath))}.pre-native.bak-`;
  if (
    marker.version !== 1
    || marker.engine !== 'better-sqlite3'
    || typeof marker.activatedAt !== 'string'
    || !Number.isFinite(Date.parse(marker.activatedAt))
    || !isSha256(marker.sourceSha256)
    || !isSha256(marker.nativeSha256)
    || typeof marker.rollbackBackupFile !== 'string'
    || path.basename(marker.rollbackBackupFile) !== marker.rollbackBackupFile
    || !marker.rollbackBackupFile.startsWith(expectedBackupPrefix)
  ) {
    throw new Error('数据库引擎标记字段无效，已阻止启动。');
  }
  return marker as NativeDatabaseEngineMarker;
}

export function readDatabaseEngineMarker(
  baseDatabasePath: string,
): NativeDatabaseEngineMarker | null {
  const markerPath = getDatabaseEngineMarkerPath(baseDatabasePath);
  if (!fs.existsSync(markerPath)) return null;
  return parseMarker(baseDatabasePath, fs.readFileSync(markerPath, 'utf8'));
}

export function resolveDatabaseRuntime(baseDatabasePath: string): DatabaseRuntimeSelection {
  const resolvedBase = path.resolve(baseDatabasePath);
  const markerPath = getDatabaseEngineMarkerPath(resolvedBase);
  const marker = readDatabaseEngineMarker(resolvedBase);
  if (!marker) {
    return {
      engine: 'sql.js',
      databasePath: resolvedBase,
      baseDatabasePath: resolvedBase,
      markerPath,
      marker: null,
    };
  }

  const nativePath = getNativeDatabasePath(resolvedBase);
  if (!fs.existsSync(nativePath)) {
    throw new Error(`数据库引擎标记要求使用 better-sqlite3，但 native 数据库不存在: ${nativePath}`);
  }
  const rollbackBackupPath = path.join(path.dirname(resolvedBase), marker.rollbackBackupFile);
  if (!fs.existsSync(rollbackBackupPath)) {
    throw new Error(`数据库引擎标记引用的回滚备份不存在: ${rollbackBackupPath}`);
  }
  return {
    engine: 'better-sqlite3',
    databasePath: nativePath,
    baseDatabasePath: resolvedBase,
    markerPath,
    marker,
  };
}

export function writeDatabaseEngineMarker(
  baseDatabasePath: string,
  marker: NativeDatabaseEngineMarker,
): string {
  const markerPath = getDatabaseEngineMarkerPath(baseDatabasePath);
  parseMarker(baseDatabasePath, JSON.stringify(marker));
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, markerPath);
    return markerPath;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

export function removeDatabaseEngineMarker(baseDatabasePath: string): void {
  const markerPath = getDatabaseEngineMarkerPath(baseDatabasePath);
  if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
}
