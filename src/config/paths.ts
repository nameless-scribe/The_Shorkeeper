import path from 'node:path';

/** 数据库文件根目录（可通过环境变量覆盖） */
export const DATABASE_DIR =
  process.env.SHOREKEEPER_DB_DIR ?? 'D:\\SQLlite';

/** 主数据库文件路径 */
export const DATABASE_PATH =
  process.env.SHOREKEEPER_DB_PATH ?? path.join(DATABASE_DIR, 'shorekeeper.db');

/** Agent 工作区（工具读写文件的沙箱根目录，与数据库分离） */
export const WORKSPACE_DIR =
  process.env.SHOREKEEPER_WORKSPACE_DIR ??
  path.join(DATABASE_DIR, 'workspace');
