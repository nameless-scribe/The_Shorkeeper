/**
 * 连接层与 mysql2 之间的薄接口。连接器只依赖这里的 MysqlDriver，测试用假驱动，
 * 真库验证走 scripts/p7-mysql-probe.ts。
 */
import { AbortSignalError } from '../agent/abort';

export interface MysqlConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** 默认关；公网主机未开时设置页提醒（§10） */
  ssl: boolean;
  /** 明确设了才执行 SET time_zone；缺省跟随服务器 */
  timeZone?: string;
  connectTimeoutMs: number;
  poolSize: number;
}

export interface StreamHandlers {
  onFields(fields: string[]): void;
  /** 返回 false 表示够了：连接会被销毁，不再读后面的行 */
  onRow(row: unknown[]): boolean;
}

export interface DriverConnection {
  /** 普通查询：整份结果；timeoutMs 到了由驱动中止 */
  execute<T = Record<string, unknown>>(sql: string, params?: unknown[], options?: { timeoutMs?: number }): Promise<T[]>;
  /** 逐行读；onRow 返回 false 或 signal 触发都会销毁连接 */
  stream(sql: string, params: unknown[], handlers: StreamHandlers, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{ truncated: boolean }>;
  release(): void;
  destroy(): void;
  /** 每个物理连接只做一次会话初始化 */
  readonly fresh: boolean;
}

export interface MysqlDriver {
  acquire(): Promise<DriverConnection>;
  end(): Promise<void>;
}

export type DriverFactory = (config: MysqlConnectionConfig) => MysqlDriver;

type Mysql2Promise = typeof import('mysql2/promise');

let mysql2Module: Promise<Mysql2Promise> | null = null;

function loadMysql2(): Promise<Mysql2Promise> {
  if (!mysql2Module) {
    mysql2Module = import('mysql2/promise').catch((error) => {
      mysql2Module = null;
      throw error;
    });
  }
  return mysql2Module;
}

interface RawQueryLike {
  on(event: 'fields', listener: (fields: Array<{ name: string }>) => void): unknown;
  on(event: 'result', listener: (row: unknown) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** 真正的 mysql2 驱动。dateStrings 打开：日期时间按服务器给的文本原样返回，不经 JS Date 换时区。 */
export function createMysql2Driver(config: MysqlConnectionConfig): MysqlDriver {
  const poolPromise = loadMysql2().then((mysql) =>
    mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: config.connectTimeoutMs,
      connectionLimit: config.poolSize,
      waitForConnections: true,
      queueLimit: 20,
      charset: 'utf8mb4_general_ci',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
    }),
  );
  const initialized = new WeakSet<object>();

  return {
    async acquire() {
      const pool = await poolPromise;
      const connection = await pool.getConnection();
      const raw = connection.connection as unknown as { destroy(): void };
      const fresh = !initialized.has(raw);
      initialized.add(raw);
      let destroyed = false;
      return {
        fresh,
        async execute<T>(sql: string, params: unknown[] = [], options: { timeoutMs?: number } = {}) {
          const [rows] = await connection.query({ sql, values: params, timeout: options.timeoutMs });
          return rows as T[];
        },
        stream(sql, params, handlers, options = {}) {
          return new Promise<{ truncated: boolean }>((resolve, reject) => {
            if (options.signal?.aborted) {
              reject(new AbortSignalError());
              return;
            }
            let settled = false;
            let truncated = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              options.signal?.removeEventListener('abort', onAbort);
              if (error) reject(error);
              else resolve({ truncated });
            };
            const kill = () => {
              destroyed = true;
              raw.destroy();
            };
            const onAbort = () => {
              kill();
              finish(new AbortSignalError());
            };
            options.signal?.addEventListener('abort', onAbort, { once: true });
            const query = (connection.connection as unknown as {
              query(options: { sql: string; values: unknown[]; rowsAsArray: boolean; timeout?: number }): RawQueryLike;
            }).query({ sql, values: params, rowsAsArray: true, timeout: options.timeoutMs });
            query.on('fields', (fields) => handlers.onFields((fields ?? []).map((field) => field.name)));
            query.on('result', (row) => {
              if (settled) return;
              if (!handlers.onRow(row as unknown[])) {
                truncated = true;
                kill();
                finish();
              }
            });
            query.on('error', (error) => finish(error));
            query.on('end', () => finish());
          });
        },
        release() {
          if (destroyed) return;
          connection.release();
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          connection.destroy();
        },
      };
    },
    async end() {
      const pool = await poolPromise.catch(() => null);
      if (pool) await pool.end();
    },
  };
}
