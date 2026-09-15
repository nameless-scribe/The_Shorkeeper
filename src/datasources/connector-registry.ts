/**
 * 每个数据源一个连接器（连接池最多 3 条），按 id 缓存；改配置或删除时关掉重建，退出时全部关闭。
 * 明文密码只在 getDataSourceCredentials → 连接配置这一步经手，不落日志。
 */
import { getDataSourceCredentials } from '../db/repositories/datasources';
import type { AppDatabase } from '../db';
import { connectionConfigFrom, createMysqlConnector, type MysqlConnector } from './mysql-connector';
import type { DriverFactory } from './mysql-driver';

const connectors = new Map<string, MysqlConnector>();
let driverFactoryOverride: DriverFactory | undefined;

/** 测试用：换成假驱动 */
export function setConnectorDriverFactory(factory: DriverFactory | undefined): void {
  driverFactoryOverride = factory;
}

export function getConnectorForSource(sourceId: string, db?: AppDatabase): MysqlConnector {
  const existing = connectors.get(sourceId);
  if (existing) return existing;
  const credentials = getDataSourceCredentials(sourceId, db);
  if (!credentials) throw new Error('数据源不存在');
  const connector = createMysqlConnector(connectionConfigFrom(credentials), driverFactoryOverride);
  connectors.set(sourceId, connector);
  return connector;
}

export async function invalidateConnector(sourceId: string): Promise<void> {
  const connector = connectors.get(sourceId);
  connectors.delete(sourceId);
  if (connector) await connector.close().catch(() => undefined);
}

export async function closeAllConnectors(): Promise<void> {
  const all = [...connectors.values()];
  connectors.clear();
  await Promise.all(all.map((connector) => connector.close().catch(() => undefined)));
}

export function openConnectorCount(): number {
  return connectors.size;
}
