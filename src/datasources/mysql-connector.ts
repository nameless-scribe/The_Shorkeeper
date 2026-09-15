/**
 * P7.1 连接层（计划 §11.3）：ping / probeWritable / fetchSchema / fetchValues / explain / query。
 * 每个物理连接第一次拿到时做会话初始化：只读事务、30 秒执行上限、utf8mb4；
 * time_zone 只在明确设了值时才 SET（§10：不假设库存的是什么时间）。
 * 样例值与取值表只回给字典层，这里不打印任何行数据。
 */
import { createLinkedTimeoutSignal } from '../agent/abort';
import type { TableSkeleton } from './dictionary';
import { createMysql2Driver, type DriverConnection, type DriverFactory, type MysqlConnectionConfig, type MysqlDriver } from './mysql-driver';
import {
  describeTimeZoneProbe,
  grantsAllowWrite,
  quoteDatabaseName,
  quoteIdentifier,
  SAMPLE_SCAN_ROWS,
  SAMPLE_TIMEOUT_MS,
  samplesFromRows,
  shouldFetchValues,
  skeletonFromInformationSchema,
  VALUES_LIMIT,
  VALUES_TIMEOUT_MS,
  type ColumnInfoRow,
  type KeyUsageRow,
  type TableInfoRow,
  type TimeZoneProbe,
  type TimeZoneProbeRow,
  type WritableProbe,
} from './mysql-helpers';

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_POOL_SIZE = 3;
export const SESSION_MAX_EXECUTION_MS = 30_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_ROWS = 500;
export const HARD_MAX_ROWS = 5_000;
/** 一次刷新最多给多少张表抓样例（大库先勾关注表） */
export const SAMPLE_MAX_TABLES = 300;

export interface PingResult {
  serverVersion: string;
  tableCount: number;
  latencyMs: number;
  timeZone: TimeZoneProbe;
}

export interface SchemaFetchOptions {
  /** 关闭后不读任何行数据 */
  sampleValues: boolean;
  /** 只给这些表抓样例（关注表）；空则全部（上限 SAMPLE_MAX_TABLES） */
  sampleTables?: string[];
  signal?: AbortSignal;
}

export interface SchemaFetchResult {
  tables: TableSkeleton[];
  /** 抓样例失败或超时被跳过的表数 */
  skippedSamples: number;
}

export interface ValuesFetchResult {
  /** `table.column` → 取值表；null = 高基数或超时，不存 */
  values: Record<string, string[] | null>;
  scannedColumns: number;
}

export interface QueryOptions {
  maxRows?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  durationMs: number;
}

export interface MysqlConnector {
  ping(): Promise<PingResult>;
  probeWritable(): Promise<WritableProbe>;
  fetchSchema(options: SchemaFetchOptions): Promise<SchemaFetchResult>;
  fetchValues(tables: TableSkeleton[], options?: { signal?: AbortSignal }): Promise<ValuesFetchResult>;
  /** 关注表最新一条时间值，§10 时区核对用 */
  latestTimestamps(targets: Array<{ table: string; column: string }>): Promise<Array<{ table: string; column: string; value: string | null }>>;
  explain(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  query(sql: string, params?: unknown[], options?: QueryOptions): Promise<QueryResult>;
  close(): Promise<void>;
}

const TIME_ZONE_PROBE_SQL =
  'SELECT VERSION() AS version, @@global.time_zone AS global_tz, @@session.time_zone AS session_tz, ' +
  '@@system_time_zone AS system_tz, NOW() AS server_now, UTC_TIMESTAMP() AS server_utc_now, ' +
  'TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS offset_minutes';

export function createMysqlConnector(config: MysqlConnectionConfig, factory: DriverFactory = createMysql2Driver): MysqlConnector {
  let driver: MysqlDriver | null = null;

  function getDriver(): MysqlDriver {
    if (!driver) driver = factory(config);
    return driver;
  }

  async function initSession(connection: DriverConnection): Promise<void> {
    if (!connection.fresh) return;
    await connection.execute('SET SESSION TRANSACTION READ ONLY');
    await connection.execute('SET NAMES utf8mb4');
    try {
      await connection.execute(`SET SESSION max_execution_time = ${SESSION_MAX_EXECUTION_MS}`);
    } catch {
      // MariaDB 的变量名不同（max_statement_time，单位秒）；没有服务器侧上限时靠客户端超时与断连
    }
    if (config.timeZone?.trim()) {
      await connection.execute('SET time_zone = ?', [config.timeZone.trim()]);
    }
  }

  async function withConnection<T>(work: (connection: DriverConnection) => Promise<T>): Promise<T> {
    const connection = await getDriver().acquire();
    try {
      await initSession(connection);
      return await work(connection);
    } finally {
      connection.release();
    }
  }

  const schema = () => config.database;

  return {
    async ping() {
      const started = Date.now();
      return withConnection(async (connection) => {
        const [probe] = await connection.execute<TimeZoneProbeRow & { version: string }>(TIME_ZONE_PROBE_SQL);
        const [count] = await connection.execute<{ n: number | string }>(
          'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
          [schema()],
        );
        return {
          serverVersion: String(probe?.version ?? ''),
          tableCount: Number(count?.n ?? 0),
          latencyMs: Date.now() - started,
          timeZone: describeTimeZoneProbe(probe),
        };
      });
    },

    async probeWritable() {
      return withConnection(async (connection) => {
        const rows = await connection.execute<Record<string, unknown>>('SHOW GRANTS FOR CURRENT_USER()');
        const grants = rows.map((row) => String(Object.values(row)[0] ?? ''));
        return grantsAllowWrite(grants);
      });
    },

    async fetchSchema(options) {
      return withConnection(async (connection) => {
        const tables = await connection.execute<TableInfoRow>(
          `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT, TABLE_TYPE FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME`,
          [schema()],
        );
        const columns = await connection.execute<ColumnInfoRow>(
          `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          [schema()],
        );
        const keys = await connection.execute<KeyUsageRow>(
          `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
           FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [schema()],
        );
        const skeleton = skeletonFromInformationSchema(tables, columns, keys);
        let skippedSamples = 0;
        if (options.sampleValues) {
          const wanted = options.sampleTables?.length ? new Set(options.sampleTables) : null;
          const targets = skeleton.filter((table) => !wanted || wanted.has(table.name)).slice(0, SAMPLE_MAX_TABLES);
          for (const table of targets) {
            if (options.signal?.aborted) break;
            try {
              const rows = await connection.execute<Record<string, unknown>>(
                `SELECT * FROM ${quoteDatabaseName(schema())}.${quoteIdentifier(table.name)} LIMIT ${SAMPLE_SCAN_ROWS}`,
                [],
                { timeoutMs: SAMPLE_TIMEOUT_MS },
              );
              const samples = samplesFromRows(rows, table.columns.map((column) => column.name));
              for (const column of table.columns) column.samples = samples[column.name] ?? [];
            } catch {
              skippedSamples += 1;
            }
          }
        }
        return { tables: skeleton, skippedSamples };
      });
    },

    async fetchValues(tables, options = {}) {
      return withConnection(async (connection) => {
        const values: Record<string, string[] | null> = {};
        let scannedColumns = 0;
        for (const table of tables) {
          for (const column of table.columns) {
            if (options.signal?.aborted) return { values, scannedColumns };
            if (!shouldFetchValues(column, table.rowCountEstimate)) continue;
            scannedColumns += 1;
            const key = `${table.name}.${column.name}`;
            try {
              const rows = await connection.execute<{ v: unknown }>(
                `SELECT /*+ MAX_EXECUTION_TIME(${VALUES_TIMEOUT_MS}) */ ${quoteIdentifier(column.name)} AS v ` +
                  `FROM ${quoteDatabaseName(schema())}.${quoteIdentifier(table.name)} ` +
                  `WHERE ${quoteIdentifier(column.name)} IS NOT NULL GROUP BY ${quoteIdentifier(column.name)} LIMIT ${VALUES_LIMIT + 1}`,
                [],
                { timeoutMs: VALUES_TIMEOUT_MS + 500 },
              );
              if (rows.length > VALUES_LIMIT) {
                values[key] = null;
              } else {
                values[key] = rows.map((row) => String(row.v)).filter((text) => text.length > 0);
              }
            } catch {
              values[key] = null;
            }
          }
        }
        return { values, scannedColumns };
      });
    },

    async latestTimestamps(targets) {
      if (!targets.length) return [];
      return withConnection(async (connection) => {
        const results: Array<{ table: string; column: string; value: string | null }> = [];
        for (const target of targets.slice(0, 5)) {
          try {
            const [row] = await connection.execute<{ v: unknown }>(
              `SELECT MAX(${quoteIdentifier(target.column)}) AS v FROM ${quoteDatabaseName(schema())}.${quoteIdentifier(target.table)}`,
              [],
              { timeoutMs: SAMPLE_TIMEOUT_MS },
            );
            results.push({ ...target, value: row?.v == null ? null : String(row.v) });
          } catch {
            results.push({ ...target, value: null });
          }
        }
        return results;
      });
    },

    async explain(sql, params = []) {
      return withConnection((connection) =>
        connection.execute<Record<string, unknown>>(`EXPLAIN ${sql}`, params, { timeoutMs: SAMPLE_TIMEOUT_MS * 5 }),
      );
    },

    async query(sql, params = [], options = {}) {
      const maxRows = Math.max(1, Math.min(HARD_MAX_ROWS, Math.floor(options.maxRows ?? DEFAULT_MAX_ROWS)));
      const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
      const started = Date.now();
      const connection = await getDriver().acquire();
      const timeout = createLinkedTimeoutSignal(options.signal, timeoutMs);
      try {
        await initSession(connection);
        let columns: string[] = [];
        const rows: unknown[][] = [];
        const { truncated } = await connection.stream(
          sql,
          params,
          {
            onFields: (fields) => {
              columns = fields;
            },
            onRow: (row) => {
              if (rows.length >= maxRows) return false;
              rows.push(row);
              return true;
            },
          },
          { signal: timeout.signal, timeoutMs },
        );
        return { columns, rows, truncated, durationMs: Date.now() - started };
      } catch (error) {
        if (timeout.didTimeout()) throw new Error(`查询超过 ${Math.round(timeoutMs / 1000)} 秒，已中止`);
        throw error;
      } finally {
        timeout.dispose();
        connection.release();
      }
    },

    async close() {
      const current = driver;
      driver = null;
      if (current) await current.end();
    },
  };
}

export function connectionConfigFrom(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  options?: { ssl?: boolean; timeZone?: string; connectTimeoutMs?: number };
}): MysqlConnectionConfig {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    ssl: input.options?.ssl === true,
    ...(input.options?.timeZone?.trim() ? { timeZone: input.options.timeZone.trim() } : {}),
    connectTimeoutMs: input.options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    poolSize: DEFAULT_POOL_SIZE,
  };
}
