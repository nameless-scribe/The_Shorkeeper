import fs from 'node:fs';
import path from 'node:path';
import { listDatabaseBackups } from './backup';
import type { DatabaseHealthOptions, DatabaseHealthReport } from './health';
import { openNativeDatabase } from './native-adapter';
import { resolveMigrationsDir } from './runtime-paths';

const REQUIRED_TABLES = [
  'sessions', 'messages', 'app_settings', 'user_profile', 'long_term_memory',
  'worldbook_entries', 'token_usage', 'scheduled_tasks', 'documents',
  'document_chunks', 'mcp_servers', 'bookkeeping_entries', 'session_summaries',
  'user_tasks',
];

const FTS_EXPECTATIONS: Record<string, { table: string; tokenizer?: string }> = {
  '0002_worldbook_fts5.sql': { table: 'worldbook_fts' },
  '0010_rag_fts.sql': { table: 'document_chunks_fts' },
  '0014_rag_fts_trigram.sql': { table: 'document_chunks_fts', tokenizer: 'trigram' },
};

function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function tableSql(db: ReturnType<typeof openNativeDatabase>, name: string): string | undefined {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return typeof row?.sql === 'string' ? row.sql : undefined;
}

function tableCount(db: ReturnType<typeof openNativeDatabase>, name: string): number {
  const escaped = name.replaceAll('"', '""');
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${escaped}"`).get();
  return Number(row?.count ?? 0);
}

function embeddingSize(db: ReturnType<typeof openNativeDatabase>, name: string): number {
  if (!tableSql(db, name)) return 0;
  const columns = db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all();
  if (!columns.some((column) => column.name === 'embedding')) return 0;
  const row = db.prepare(`SELECT COALESCE(SUM(LENGTH(embedding)), 0) AS bytes FROM "${name}"`).get();
  return Number(row?.bytes ?? 0);
}

function expectedMigrations(migrationsDir: string): string[] {
  return fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql') && name !== '0000_init.sql').sort()
    : [];
}

function emptyReport(dbPath: string): DatabaseHealthReport {
  return {
    generatedAt: new Date().toISOString(), status: 'healthy', databasePath: dbPath,
    exists: false, fileSizeBytes: 0, modifiedAt: null, sqliteVersion: null,
    integrity: { ok: false, messages: [] },
    migrations: { ledgerExists: false, legacyLedger: false, total: 0, applied: 0, skipped: 0, partial: 0, unknown: 0, pending: [], issues: [] },
    tables: [],
    embeddingBytes: { longTermMemory: 0, documentChunks: 0, documents: 0, total: 0 },
    backups: { count: 0, corruptCount: 0, latest: null },
    sidecars: { walBytes: fileSize(`${dbPath}-wal`), shmBytes: fileSize(`${dbPath}-shm`) },
    warnings: [], errors: [],
  };
}

function finalize(report: DatabaseHealthReport): DatabaseHealthReport {
  report.status = report.errors.length > 0 ? 'critical' : report.warnings.length > 0 ? 'warning' : 'healthy';
  return report;
}

export function inspectNativeDatabaseHealth(
  dbPath: string,
  options: DatabaseHealthOptions = {},
): DatabaseHealthReport {
  const report = emptyReport(dbPath);
  if (!fs.existsSync(dbPath)) {
    report.errors.push('数据库文件不存在。');
    return finalize(report);
  }
  report.exists = true;
  report.fileSizeBytes = fs.statSync(dbPath).size;
  report.modifiedAt = fs.statSync(dbPath).mtime.toISOString();
  const backupPaths = options.backupPaths?.length ? options.backupPaths : [dbPath];
  const backups = [...new Map(
    backupPaths.flatMap((backupPath) => listDatabaseBackups(backupPath)).map((backup) => [backup.path, backup]),
  ).values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const usableBackups = backups.filter((backup) => backup.kind !== 'corrupt');
  report.backups = {
    count: usableBackups.length,
    corruptCount: backups.length - usableBackups.length,
    latest: usableBackups[0] ?? null,
  };

  let db: ReturnType<typeof openNativeDatabase> | undefined;
  try {
    db = openNativeDatabase(dbPath, { allowExisting: true, initialize: false, readonly: true });
    const integrityMessages = db.prepare('PRAGMA integrity_check').all().map((row) => String(Object.values(row)[0]));
    report.integrity.messages = integrityMessages;
    report.integrity.ok = integrityMessages.length === 1 && integrityMessages[0] === 'ok';
    if (!report.integrity.ok) report.errors.push(`完整性检查失败：${integrityMessages.join('; ') || '无结果'}`);
    report.sqliteVersion = String(db.prepare('SELECT sqlite_version() AS version').get()?.version ?? 'unknown');

    const requiredTables = options.requiredTables ?? REQUIRED_TABLES;
    report.tables = requiredTables.map((name) => {
      const exists = Boolean(tableSql(db!, name));
      if (!exists) report.errors.push(`缺少关键表：${name}`);
      return { name, exists, rowCount: exists ? tableCount(db!, name) : null };
    });
    const longTermMemory = embeddingSize(db, 'long_term_memory');
    const documentChunks = embeddingSize(db, 'document_chunks');
    const documents = embeddingSize(db, 'documents');
    report.embeddingBytes = { longTermMemory, documentChunks, documents, total: longTermMemory + documentChunks + documents };

    report.migrations.ledgerExists = Boolean(tableSql(db, 'schema_migrations'));
    const expected = expectedMigrations(options.migrationsDir ?? resolveMigrationsDir());
    if (!report.migrations.ledgerExists) {
      report.errors.push('缺少 schema_migrations 迁移账本。');
      report.migrations.pending = expected;
    } else {
      const rows = db.prepare('SELECT name, status, detail FROM schema_migrations').all() as Array<{ name: string; status: string; detail: string | null }>;
      const recorded = new Set<string>();
      for (const row of rows) {
        const name = String(row.name);
        const status = String(row.status);
        recorded.add(name);
        report.migrations.total += 1;
        if (status === 'applied') report.migrations.applied += 1;
        else if (status === 'skipped') report.migrations.skipped += 1;
        else if (status === 'partial') report.migrations.partial += 1;
        else report.migrations.unknown += 1;
        if (status !== 'applied') report.migrations.issues.push({ name, status, detail: row.detail ?? null });
        const expectation = FTS_EXPECTATIONS[name];
        if (status === 'applied' && expectation) {
          const sql = tableSql(db, expectation.table);
          const matches = !expectation.tokenizer || Boolean(sql?.toLowerCase().includes(`tokenize='${expectation.tokenizer}'`));
          if (!sql || !matches) report.migrations.issues.push({ name, status: 'inconsistent', detail: `账本为 applied，但 ${expectation.table} 实际不存在或配置不匹配` });
        }
      }
      report.migrations.pending = expected.filter((name) => !recorded.has(name));
      if (report.migrations.pending.length > 0) report.errors.push(`存在 ${report.migrations.pending.length} 个未执行 migration。`);
      if (report.migrations.partial > 0 || report.migrations.unknown > 0) report.errors.push('迁移账本包含 partial 或未知状态，需要人工检查。');
      if (report.migrations.skipped > 0) report.warnings.push(`有 ${report.migrations.skipped} 个可选 migration 被跳过。`);
    }
  } catch (error) {
    report.errors.push(`无法读取 native 数据库：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db?.close();
  }

  if (report.backups.latest) {
    const staleAfterMs = (options.backupStaleAfterDays ?? 30) * 24 * 60 * 60 * 1000;
    if (Date.now() - Date.parse(report.backups.latest.modifiedAt) > staleAfterMs) report.warnings.push(`最近一次可用备份已超过 ${options.backupStaleAfterDays ?? 30} 天。`);
  } else report.warnings.push('未找到可用数据库备份。');
  if (report.backups.corruptCount > 0) report.warnings.push(`发现 ${report.backups.corruptCount} 个历史损坏数据库备份。`);
  if (report.sidecars.walBytes > 0) report.warnings.push('检测到 native WAL；备份或切换前请完全退出应用。');
  if (report.sidecars.shmBytes > 0) report.warnings.push('检测到 native SHM；确认没有其他 SQLite 程序正在写入。');
  return finalize(report);
}
