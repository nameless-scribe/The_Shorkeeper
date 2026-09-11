import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDb } from './index';
import { resolveMigrationsDir } from './runtime-paths';

export type MigrationStatus = 'applied' | 'skipped' | 'partial';

export interface RunMigrationsOptions {
  migrationsDir?: string;
  beforeMigrate?: () => void;
  capabilities?: {
    fts5: boolean;
    trigram: boolean;
  };
}

interface MigrationRow {
  name: string;
  status: MigrationStatus;
  detail?: string | null;
}

const FTS_REQUIREMENTS: Record<
  string,
  { table: string; tokenizer: 'unicode61' | 'trigram' }
> = {
  '0002_worldbook_fts5.sql': { table: 'worldbook_fts', tokenizer: 'unicode61' },
  '0010_rag_fts.sql': { table: 'document_chunks_fts', tokenizer: 'unicode61' },
  '0014_rag_fts_trigram.sql': { table: 'document_chunks_fts', tokenizer: 'trigram' },
};

function tableSql(db: SqliteDb, tableName: string): string | undefined {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql;
}

function ftsMigrationIsPresent(db: SqliteDb, file: string): boolean {
  const requirement = FTS_REQUIREMENTS[file];
  if (!requirement) return true;

  const sql = tableSql(db, requirement.table);
  if (!sql) return false;
  return requirement.tokenizer !== 'trigram' || /tokenize\s*=\s*['"]trigram['"]/i.test(sql);
}

function ensureMigrationLedger(db: SqliteDb, beforeMigrate: () => void): void {
  const ledgerExists = Boolean(tableSql(db, 'schema_migrations'));
  if (!ledgerExists) {
    beforeMigrate();
    db.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'applied',
        detail TEXT
      );
    `);
    return;
  }

  const columns = db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (names.has('status') && names.has('detail')) return;

  beforeMigrate();
  db.transaction(() => {
    if (!names.has('status')) {
      db.exec("ALTER TABLE schema_migrations ADD COLUMN status TEXT NOT NULL DEFAULT 'applied'");
    }
    if (!names.has('detail')) {
      db.exec('ALTER TABLE schema_migrations ADD COLUMN detail TEXT');
    }
  });
}

function recordMigration(
  db: SqliteDb,
  file: string,
  status: MigrationStatus,
  detail: string | null = null,
): void {
  db.prepare(
    `INSERT INTO schema_migrations (name, applied_at, status, detail)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       applied_at = excluded.applied_at,
       status = excluded.status,
       detail = excluded.detail`,
  ).run(file, Date.now(), status, detail);
}

function getCapabilities(
  db: SqliteDb,
  supplied?: RunMigrationsOptions['capabilities'],
): NonNullable<RunMigrationsOptions['capabilities']> {
  if (supplied) return supplied;
  const fts5 = db.supportsFts5();
  return { fts5, trigram: fts5 && db.supportsFts5('trigram') };
}

function requirementSupported(
  file: string,
  capabilities: NonNullable<RunMigrationsOptions['capabilities']>,
): boolean {
  const requirement = FTS_REQUIREMENTS[file];
  if (!requirement) return true;
  return requirement.tokenizer === 'trigram' ? capabilities.trigram : capabilities.fts5;
}

/** 按文件名顺序执行尚未应用的 SQL migration */
export function runMigrations(db: SqliteDb, options: RunMigrationsOptions = {}): string[] {
  let migrationStarted = false;
  const beforeMigrate = () => {
    if (migrationStarted) return;
    options.beforeMigrate?.();
    migrationStarted = true;
  };
  ensureMigrationLedger(db, beforeMigrate);

  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && f !== '0000_init.sql')
    .sort();

  const capabilities = getCapabilities(db, options.capabilities);
  const results: string[] = [];

  for (const file of files) {
    const row = db
      .prepare('SELECT name, status, detail FROM schema_migrations WHERE name = ?')
      .get(file) as MigrationRow | undefined;
    let currentStatus = row?.status;

    if (currentStatus === 'applied' && FTS_REQUIREMENTS[file] && !ftsMigrationIsPresent(db, file)) {
      beforeMigrate();
      recordMigration(db, file, 'skipped', 'legacy ledger entry had no matching FTS table');
      results.push(`${file} (skipped)`);
      currentStatus = 'skipped';
    } else if (currentStatus === 'applied') {
      continue;
    }

    if (currentStatus === 'partial') {
      throw new Error(
        `Migration ${file} 处于 partial 状态，已阻止应用继续启动。请先修复数据库结构和迁移账本。`,
      );
    }

    if (!requirementSupported(file, capabilities)) {
      if (currentStatus !== 'skipped') {
        beforeMigrate();
        const requirement = FTS_REQUIREMENTS[file];
        const detail = requirement?.tokenizer === 'trigram'
          ? 'SQLite runtime does not support FTS5 trigram tokenizer'
          : 'SQLite runtime does not support FTS5';
        recordMigration(db, file, 'skipped', detail);
        results.push(`${file} (skipped)`);
        console.warn(`[migrate] 跳过 ${file}（${detail}）`);
      }
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    beforeMigrate();
    try {
      db.transaction(() => {
        db.exec(sql);
        recordMigration(db, file, 'applied');
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('duplicate column')) {
        recordMigration(db, file, 'partial', message);
        throw new Error(
          `Migration ${file} 与现有列冲突，已回滚并标记为 partial；为避免在不完整 schema 上运行，应用启动已中止。`,
          { cause: err },
        );
      }
      throw err;
    }
    results.push(file);
  }

  return results;
}
