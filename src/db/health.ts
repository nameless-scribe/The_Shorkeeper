import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { listDatabaseBackups } from './backup';
import { resolveMigrationsDir, resolveSqlWasmPath } from './runtime-paths';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

const DEFAULT_REQUIRED_TABLES = [
  'sessions',
  'messages',
  'app_settings',
  'user_profile',
  'long_term_memory',
  'worldbook_entries',
  'token_usage',
  'scheduled_tasks',
  'documents',
  'document_chunks',
  'mcp_servers',
  'bookkeeping_entries',
  'session_summaries',
  'user_tasks',
  'task_runs',
  'task_run_steps',
  'artifacts',
  'approvals',
  'goals',
  'commitments',
  'briefings',
] as const;

const FTS_EXPECTATIONS: Record<string, { table: string; tokenizer?: string }> = {
  '0002_worldbook_fts5.sql': { table: 'worldbook_fts' },
  '0010_rag_fts.sql': { table: 'document_chunks_fts' },
  '0014_rag_fts_trigram.sql': { table: 'document_chunks_fts', tokenizer: 'trigram' },
};

export type DatabaseHealthStatus = 'healthy' | 'warning' | 'critical';

export interface DatabaseHealthOptions {
  migrationsDir?: string;
  requiredTables?: readonly string[];
  backupStaleAfterDays?: number;
  backupPaths?: readonly string[];
}

export interface DatabaseHealthReport {
  engine?: 'sql.js' | 'better-sqlite3';
  generatedAt: string;
  status: DatabaseHealthStatus;
  databasePath: string;
  exists: boolean;
  fileSizeBytes: number;
  modifiedAt: string | null;
  sqliteVersion: string | null;
  integrity: {
    ok: boolean;
    messages: string[];
  };
  migrations: {
    ledgerExists: boolean;
    legacyLedger: boolean;
    total: number;
    applied: number;
    skipped: number;
    partial: number;
    unknown: number;
    pending: string[];
    issues: Array<{ name: string; status: string; detail: string | null }>;
  };
  tables: Array<{ name: string; exists: boolean; rowCount: number | null }>;
  embeddingBytes: {
    longTermMemory: number;
    documentChunks: number;
    documents: number;
    total: number;
  };
  backups: {
    count: number;
    corruptCount: number;
    latest: { path: string; sizeBytes: number; modifiedAt: string } | null;
  };
  sidecars: {
    walBytes: number;
    shmBytes: number;
  };
  warnings: string[];
  errors: string[];
}

function queryAll(
  db: import('sql.js').SqlJsDatabase,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    if (params.length) statement.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
    return rows;
  } finally {
    statement.free();
  }
}

function queryOne(
  db: import('sql.js').SqlJsDatabase,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown> | undefined {
  return queryAll(db, sql, params)[0];
}

function tableSql(db: import('sql.js').SqlJsDatabase, tableName: string): string | undefined {
  const row = queryOne(
    db,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return typeof row?.sql === 'string' ? row.sql : undefined;
}

function tableColumns(db: import('sql.js').SqlJsDatabase, tableName: string): Set<string> {
  const escaped = tableName.replaceAll('"', '""');
  return new Set(
    queryAll(db, `PRAGMA table_info("${escaped}")`)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

function tableCount(db: import('sql.js').SqlJsDatabase, tableName: string): number {
  const escaped = tableName.replaceAll('"', '""');
  const row = queryOne(db, `SELECT COUNT(*) AS count FROM "${escaped}"`);
  return Number(row?.count ?? 0);
}

function embeddingSize(
  db: import('sql.js').SqlJsDatabase,
  tableName: string,
): number {
  if (!tableSql(db, tableName) || !tableColumns(db, tableName).has('embedding')) return 0;
  const escaped = tableName.replaceAll('"', '""');
  const row = queryOne(
    db,
    `SELECT COALESCE(SUM(LENGTH(embedding)), 0) AS bytes FROM "${escaped}"`,
  );
  return Number(row?.bytes ?? 0);
}

function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function listExpectedMigrations(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql') && name !== '0000_init.sql')
    .sort();
}

function inspectBackups(dbPath: string): DatabaseHealthReport['backups'] {
  const allBackups = listDatabaseBackups(dbPath);
  const backups = allBackups.filter((backup) => backup.kind !== 'corrupt');
  const corruptCount = allBackups.length - backups.length;

  return { count: backups.length, corruptCount, latest: backups[0] ?? null };
}

function emptyReport(dbPath: string): DatabaseHealthReport {
  return {
    generatedAt: new Date().toISOString(),
    status: 'healthy',
    databasePath: dbPath,
    exists: false,
    fileSizeBytes: 0,
    modifiedAt: null,
    sqliteVersion: null,
    integrity: { ok: false, messages: [] },
    migrations: {
      ledgerExists: false,
      legacyLedger: false,
      total: 0,
      applied: 0,
      skipped: 0,
      partial: 0,
      unknown: 0,
      pending: [],
      issues: [],
    },
    tables: [],
    embeddingBytes: { longTermMemory: 0, documentChunks: 0, documents: 0, total: 0 },
    backups: inspectBackups(dbPath),
    sidecars: { walBytes: fileSize(`${dbPath}-wal`), shmBytes: fileSize(`${dbPath}-shm`) },
    warnings: [],
    errors: [],
  };
}

function finalizeReport(report: DatabaseHealthReport): DatabaseHealthReport {
  report.status = report.errors.length > 0
    ? 'critical'
    : report.warnings.length > 0
      ? 'warning'
      : 'healthy';
  return report;
}

export async function inspectDatabaseHealth(
  dbPath: string,
  options: DatabaseHealthOptions = {},
): Promise<DatabaseHealthReport> {
  const report = emptyReport(dbPath);
  if (!fs.existsSync(dbPath)) {
    report.errors.push('数据库文件不存在。');
    return finalizeReport(report);
  }

  report.exists = true;
  const stat = fs.statSync(dbPath);
  report.fileSizeBytes = stat.size;
  report.modifiedAt = stat.mtime.toISOString();

  let db: import('sql.js').SqlJsDatabase | undefined;
  try {
    const SQL = await initSqlJs({ locateFile: resolveSqlWasmPath });
    db = new SQL.Database(fs.readFileSync(dbPath));
    db.run('PRAGMA foreign_keys = ON');

    const integrityRows = queryAll(db, 'PRAGMA integrity_check');
    report.integrity.messages = integrityRows.map((row) => String(Object.values(row)[0]));
    report.integrity.ok =
      report.integrity.messages.length === 1 && report.integrity.messages[0] === 'ok';
    if (!report.integrity.ok) {
      report.errors.push(`完整性检查失败：${report.integrity.messages.join('; ') || '无结果'}`);
    }

    const version = queryOne(db, 'SELECT sqlite_version() AS version');
    report.sqliteVersion = typeof version?.version === 'string' ? version.version : null;

    const requiredTables = options.requiredTables ?? DEFAULT_REQUIRED_TABLES;
    report.tables = requiredTables.map((name) => {
      const exists = Boolean(tableSql(db!, name));
      if (!exists) report.errors.push(`缺少关键表：${name}`);
      return { name, exists, rowCount: exists ? tableCount(db!, name) : null };
    });

    const longTermMemory = embeddingSize(db, 'long_term_memory');
    const documentChunks = embeddingSize(db, 'document_chunks');
    const documents = embeddingSize(db, 'documents');
    report.embeddingBytes = {
      longTermMemory,
      documentChunks,
      documents,
      total: longTermMemory + documentChunks + documents,
    };

    report.migrations.ledgerExists = Boolean(tableSql(db, 'schema_migrations'));
    const expected = listExpectedMigrations(options.migrationsDir ?? resolveMigrationsDir());
    if (!report.migrations.ledgerExists) {
      report.errors.push('缺少 schema_migrations 迁移账本。');
      report.migrations.pending = expected;
    } else {
      const columns = tableColumns(db, 'schema_migrations');
      const hasStatus = columns.has('status');
      const hasDetail = columns.has('detail');
      report.migrations.legacyLedger = !hasStatus || !hasDetail;
      if (report.migrations.legacyLedger) {
        report.warnings.push('迁移账本仍是旧结构，下一次正常启动会自动升级。');
      }

      const rows = queryAll(
        db,
        hasStatus
          ? `SELECT name, status, ${hasDetail ? 'detail' : 'NULL AS detail'} FROM schema_migrations`
          : "SELECT name, 'applied' AS status, NULL AS detail FROM schema_migrations",
      );
      const recorded = new Set<string>();
      for (const row of rows) {
        const name = String(row.name);
        const status = String(row.status);
        const detail = row.detail == null ? null : String(row.detail);
        recorded.add(name);
        report.migrations.total += 1;
        if (status === 'applied') report.migrations.applied += 1;
        else if (status === 'skipped') report.migrations.skipped += 1;
        else if (status === 'partial') report.migrations.partial += 1;
        else report.migrations.unknown += 1;

        if (status !== 'applied') {
          report.migrations.issues.push({ name, status, detail });
        }

        const ftsExpectation = FTS_EXPECTATIONS[name];
        if (status === 'applied' && ftsExpectation) {
          const sql = tableSql(db, ftsExpectation.table);
          const tokenizerMatches =
            !ftsExpectation.tokenizer ||
            Boolean(sql?.toLowerCase().includes(`tokenize='${ftsExpectation.tokenizer}'`));
          if (!sql || !tokenizerMatches) {
            report.migrations.issues.push({
              name,
              status: 'inconsistent',
              detail: `账本为 applied，但 ${ftsExpectation.table} 实际不存在或配置不匹配`,
            });
          }
        }
      }

      report.migrations.pending = expected.filter((name) => !recorded.has(name));
      if (report.migrations.pending.length > 0) {
        report.errors.push(`存在 ${report.migrations.pending.length} 个未执行 migration。`);
      }
      if (report.migrations.partial > 0 || report.migrations.unknown > 0) {
        report.errors.push('迁移账本包含 partial 或未知状态，需要人工检查。');
      }
      const inconsistent = report.migrations.issues.filter(
        (issue) => issue.status === 'inconsistent',
      ).length;
      if (inconsistent > 0) {
        report.warnings.push(`发现 ${inconsistent} 个 migration 记录与实际结构不一致。`);
      }
      if (report.migrations.skipped > 0) {
        report.warnings.push(`有 ${report.migrations.skipped} 个可选 migration 被跳过。`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(`无法读取数据库：${message}`);
  } finally {
    db?.close();
  }

  if (report.backups.latest) {
    const staleAfterMs = (options.backupStaleAfterDays ?? 30) * 24 * 60 * 60 * 1000;
    const backupAge = Date.now() - Date.parse(report.backups.latest.modifiedAt);
    if (backupAge > staleAfterMs) {
      report.warnings.push(`最近一次可用备份已超过 ${options.backupStaleAfterDays ?? 30} 天。`);
    }
  } else {
    report.warnings.push('未找到可用数据库备份。');
  }
  if (report.backups.corruptCount > 0) {
    report.warnings.push(`发现 ${report.backups.corruptCount} 个历史损坏数据库备份。`);
  }
  if (report.sidecars.walBytes > 0) {
    report.errors.push('检测到非空 WAL 文件；sql.js 不会读取其中尚未 checkpoint 的事务。');
  } else if (report.sidecars.shmBytes > 0) {
    report.warnings.push('检测到残留 SHM 文件；确认没有其他 SQLite 程序正在写入主库。');
  }

  return finalizeReport(report);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatDatabaseHealthReport(report: DatabaseHealthReport): string {
  const latestBackup = report.backups.latest
    ? `${report.backups.latest.modifiedAt} (${formatBytes(report.backups.latest.sizeBytes)})`
    : '无';
  const lines = [
    `数据库健康状态: ${report.status.toUpperCase()}`,
    ...(report.engine ? [`引擎: ${report.engine}`] : []),
    `路径: ${report.databasePath}`,
    `文件: ${report.exists ? formatBytes(report.fileSizeBytes) : '不存在'}`,
    `SQLite: ${report.sqliteVersion ?? '不可用'}`,
    `完整性: ${report.integrity.ok ? 'ok' : 'failed'}`,
    `迁移: applied=${report.migrations.applied}, skipped=${report.migrations.skipped}, partial=${report.migrations.partial}, unknown=${report.migrations.unknown}, pending=${report.migrations.pending.length}`,
    `Embedding: ${formatBytes(report.embeddingBytes.total)}`,
    `最近备份: ${latestBackup}`,
    `Sidecar: WAL=${formatBytes(report.sidecars.walBytes)}, SHM=${formatBytes(report.sidecars.shmBytes)}`,
    '',
    '关键表:',
    ...report.tables.map(
      (table) => `  ${table.name}: ${table.exists ? table.rowCount : 'missing'}`,
    ),
  ];

  if (report.migrations.issues.length > 0) {
    lines.push('', '迁移异常:');
    for (const issue of report.migrations.issues) {
      lines.push(`  ${issue.name}: ${issue.status}${issue.detail ? ` - ${issue.detail}` : ''}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push('', '警告:', ...report.warnings.map((warning) => `  - ${warning}`));
  }
  if (report.errors.length > 0) {
    lines.push('', '错误:', ...report.errors.map((error) => `  - ${error}`));
  }
  return lines.join('\n');
}
