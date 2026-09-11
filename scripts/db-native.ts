import path from 'node:path';
import fs from 'node:fs';
import { config } from 'dotenv';
import { getDatabasePath } from '../src/config/paths.js';
import {
  cutoverToNativeDatabase,
  rehearseNativeMigration,
  rollbackNativeDatabase,
} from '../src/db/native-migration.js';
import {
  getNativeDatabasePath,
  resolveDatabaseRuntime,
} from '../src/db/engine-state.js';

config({ path: path.join(process.cwd(), '.env') });

const [command = 'rehearse', ...args] = process.argv.slice(2);

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

const source = path.resolve(optionValue('--source') ?? getDatabasePath());

if (command === 'status') {
  const runtime = resolveDatabaseRuntime(source);
  console.log('引擎:', runtime.engine);
  console.log('基础数据库:', runtime.baseDatabasePath);
  console.log('活动数据库:', runtime.databasePath);
  console.log('引擎标记:', runtime.markerPath);
  console.log('Native 文件存在:', fs.existsSync(getNativeDatabasePath(source)) ? '是' : '否');
} else if (command === 'rehearse') {
  console.log('开始 native SQLite 副本迁移演练。请确保应用和 SQLite 工具已完全退出。');
  console.log('源数据库:', source);

  const report = await rehearseNativeMigration(source, {
    keepMigratedCopy: args.includes('--keep'),
  });

  console.log('演练结果: PASSED');
  console.log('源库 SHA-256:', report.sourceSha256);
  console.log('迁移前备份:', report.backupPath);
  console.log('备份 SHA-256:', report.backupSha256);
  console.log('Native SQLite:', report.sqliteVersion);
  console.log('Native 副本:', formatBytes(report.migratedCopySizeBytes));
  console.log('本次补执行 migration:', report.appliedMigrations.length);
  for (const migration of report.appliedMigrations) console.log('  ', migration);
  console.log('业务表摘要:', `${report.tableSnapshots.length} 个表全部一致`);
  console.log('Worldbook FTS:', report.worldbookFtsRows);
  console.log('RAG chunk FTS:', report.documentChunkFtsRows);
  console.log('回滚探针:', report.rollbackVerified ? '通过' : '失败');
  if (report.migratedCopyPath) {
    console.log('迁移副本已保留:', report.migratedCopyPath);
  } else {
    console.log('临时迁移副本已清理；迁移前备份已保留。');
  }
  console.log('生产主库未替换，应用运行时仍为 sql.js。');
} else if (command === 'cutover') {
  if (!args.includes('--yes')) {
    console.error('正式切换会让应用从下次启动起使用 better-sqlite3。请完全退出应用后追加 --yes。');
    process.exitCode = 1;
  } else {
    console.log('开始 native SQLite 正式切换:', source);
    const result = await cutoverToNativeDatabase(source);
    console.log('切换完成。');
    console.log('Native 数据库:', result.nativePath);
    console.log('引擎标记:', result.markerPath);
    console.log('回滚备份:', result.rollbackBackupPath);
    console.log('切换后请运行 pnpm db:health 验证活动数据库。');
  }
} else if (command === 'rollback') {
  if (!args.includes('--yes')) {
    console.error('回滚会让应用下次启动恢复使用 sql.js，并保留 native 安全备份。请追加 --yes。');
    process.exitCode = 1;
  } else {
    const result = await rollbackNativeDatabase(source);
    console.log('native 引擎标记已移除，下一次启动将使用 sql.js。');
    console.log('Native 安全备份:', result.nativeSafetyBackupPath);
  }
} else {
  console.error('用法: pnpm db:native <status|rehearse|cutover|rollback> [--source <数据库路径>] [--keep|--yes]');
  process.exitCode = 1;
}
