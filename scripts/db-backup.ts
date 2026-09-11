import path from 'node:path';
import { config } from 'dotenv';
import { getDatabasePath } from '../src/config/paths.js';
import {
  createManualDatabaseBackup,
  listDatabaseBackups,
  pruneDatabaseBackups,
  restoreDatabaseBackup,
  validateDatabaseFile,
} from '../src/db/backup.js';

config({ path: path.join(process.cwd(), '.env') });

const [command = 'list', ...args] = process.argv.slice(2);
const dbPath = getDatabasePath();
const confirmed = args.includes('--yes');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printBackups(): void {
  const backups = listDatabaseBackups(dbPath);
  console.log('数据库:', dbPath);
  if (backups.length === 0) {
    console.log('未找到备份。');
    return;
  }
  for (const backup of backups) {
    console.log(`${backup.modifiedAt}  ${backup.kind.padEnd(13)}  ${formatBytes(backup.sizeBytes)}  ${backup.path}`);
  }
}

switch (command) {
  case 'create': {
    const result = await createManualDatabaseBackup(dbPath);
    console.log('备份已创建:', result.backup.path);
    console.log('大小:', formatBytes(result.backup.sizeBytes));
    console.log('SHA-256:', result.validation.sha256);
    break;
  }
  case 'list': {
    printBackups();
    break;
  }
  case 'validate': {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) throw new Error('用法: pnpm db:backup validate -- <备份路径>');
    const validation = await validateDatabaseFile(path.resolve(target));
    console.log('校验通过:', validation.path);
    console.log('大小:', formatBytes(validation.sizeBytes));
    console.log('SQLite:', validation.sqliteVersion);
    console.log('SHA-256:', validation.sha256);
    break;
  }
  case 'prune': {
    const keep = Number(optionValue('--keep') ?? '10');
    const result = pruneDatabaseBackups(dbPath, { keep, execute: confirmed });
    if (!confirmed) {
      console.log(`预览：保留最近 ${result.keep} 个备份，将删除 ${result.candidates.length} 个。`);
      for (const backup of result.candidates) console.log('  ', backup.path);
      console.log('确认删除请追加 --yes。');
    } else {
      console.log(`已删除 ${result.deleted.length} 个旧备份，保留 ${result.retained.length} 个。`);
    }
    break;
  }
  case 'restore': {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) throw new Error('用法: pnpm db:backup restore -- <备份路径> --yes');
    if (!confirmed) {
      console.error('恢复会替换当前主库。请完全退出 The Shorekeeper 和 SQLite 工具后追加 --yes。');
      process.exitCode = 1;
      break;
    }
    const result = await restoreDatabaseBackup(dbPath, path.resolve(target));
    console.log('恢复完成:', result.restoredFrom);
    console.log('恢复前安全备份:', result.safetyBackup ?? '原主库不存在');
    console.log('SHA-256:', result.restoredValidation.sha256);
    if (result.movedShmPath) console.log('原 SHM 已保留:', result.movedShmPath);
    break;
  }
  default:
    console.error('用法: pnpm db:backup <create|list|validate|prune|restore>');
    process.exitCode = 1;
}
