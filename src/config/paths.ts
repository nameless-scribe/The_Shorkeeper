import path from 'node:path';

const DEFAULT_DATABASE_DIR = 'D:\\SQLlite';

/** 数据库文件根目录（启动时 bootstrap 可能写入 env） */
export function getDatabaseDir(): string {
  return process.env.SHOREKEEPER_DB_DIR ?? DEFAULT_DATABASE_DIR;
}

/** 主数据库文件路径 */
export function getDatabasePath(): string {
  return process.env.SHOREKEEPER_DB_PATH ?? path.join(getDatabaseDir(), 'shorekeeper.db');
}

/** Agent 工作区（工具读写文件的沙箱根目录） */
export function getWorkspaceDir(): string {
  return (
    process.env.SHOREKEEPER_WORKSPACE_DIR ?? path.join(getDatabaseDir(), 'workspace')
  );
}
