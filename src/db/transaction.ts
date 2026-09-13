import { getDatabase, type AppDatabase } from './index';

export type { AppDatabase };

/**
 * 高层领域服务需要原子组合多个 Repository 操作时使用此边界。
 * 回调只应调用 Repository，不应直接执行 SQL。
 */
export function runInDatabaseTransaction<T>(
  operation: (db: AppDatabase) => T,
  db: AppDatabase = getDatabase(),
): T {
  return db.transaction(() => operation(db));
}
