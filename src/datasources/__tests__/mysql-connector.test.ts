import { describe, expect, it } from 'vitest';
import { createMysqlConnector, HARD_MAX_ROWS, SESSION_MAX_EXECUTION_MS } from '../mysql-connector';
import type { DriverConnection, MysqlConnectionConfig, MysqlDriver, StreamHandlers } from '../mysql-driver';
import { sampleSkeleton } from './fixtures';

type Responder = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;

interface FakeState {
  executed: Array<{ sql: string; params: unknown[]; timeoutMs?: number }>;
  destroyed: number;
  released: number;
  acquired: number;
  ended: boolean;
}

function fakeDriver(respond: Responder, streamRows: unknown[][] = [], options: { streamError?: Error; reuse?: boolean } = {}) {
  const state: FakeState = { executed: [], destroyed: 0, released: 0, acquired: 0, ended: false };
  let physical: object | null = null;
  const factory = (_config: MysqlConnectionConfig): MysqlDriver => ({
    async acquire(): Promise<DriverConnection> {
      state.acquired += 1;
      const fresh = !(options.reuse && physical);
      if (!physical || !options.reuse) physical = {};
      let destroyed = false;
      return {
        fresh,
        async execute(sql, params = [], opts = {}) {
          state.executed.push({ sql, params, timeoutMs: opts.timeoutMs });
          return (await respond(sql, params)) as never;
        },
        async stream(sql: string, params: unknown[], handlers: StreamHandlers, opts: { signal?: AbortSignal } = {}) {
          state.executed.push({ sql, params });
          if (options.streamError) throw options.streamError;
          handlers.onFields(['a', 'b']);
          for (const row of streamRows) {
            if (opts.signal?.aborted) {
              destroyed = true;
              state.destroyed += 1;
              throw new Error('已取消');
            }
            if (!handlers.onRow(row)) {
              destroyed = true;
              state.destroyed += 1;
              return { truncated: true };
            }
          }
          return { truncated: false };
        },
        release() {
          if (!destroyed) state.released += 1;
        },
        destroy() {
          destroyed = true;
          state.destroyed += 1;
        },
      };
    },
    async end() {
      state.ended = true;
    },
  });
  return { factory, state };
}

const config: MysqlConnectionConfig = {
  host: '10.0.0.5',
  port: 3306,
  database: 'erp',
  user: 'reader',
  password: 'secret',
  ssl: false,
  connectTimeoutMs: 10_000,
  poolSize: 3,
};

const sessionInit = (executed: FakeState['executed']) => executed.filter((item) => /^SET /.test(item.sql)).map((item) => item.sql);

describe('createMysqlConnector session setup', () => {
  it('runs read-only, charset and execution-limit statements once per fresh connection and never sets time_zone by default', async () => {
    const { factory, state } = fakeDriver(() => [{ version: '8.0.36', global_tz: 'SYSTEM', session_tz: 'SYSTEM', system_tz: 'CST', server_now: '2026-09-15 10:00:00', server_utc_now: '2026-09-15 02:00:00', offset_minutes: 480, n: 12 }], [], { reuse: true });
    const connector = createMysqlConnector(config, factory);
    await connector.ping();
    await connector.ping();
    const sets = sessionInit(state.executed);
    expect(sets).toEqual(['SET SESSION TRANSACTION READ ONLY', 'SET NAMES utf8mb4', `SET SESSION max_execution_time = ${SESSION_MAX_EXECUTION_MS}`]);
    expect(state.executed.some((item) => /time_zone = \?/.test(item.sql))).toBe(false);
    expect(state.released).toBe(2);
  });

  it('sets time_zone only when the source configured one, and tolerates a missing max_execution_time variable', async () => {
    const { factory, state } = fakeDriver((sql) => {
      if (/max_execution_time/.test(sql)) throw Object.assign(new Error('Unknown system variable'), { code: 'ER_UNKNOWN_SYSTEM_VARIABLE' });
      return [{ version: '10.6-MariaDB', global_tz: '+00:00', session_tz: '+00:00', system_tz: 'UTC', server_now: '', server_utc_now: '', offset_minutes: 0, n: 1 }];
    });
    const connector = createMysqlConnector({ ...config, timeZone: '+08:00' }, factory);
    const ping = await connector.ping();
    expect(ping.serverVersion).toBe('10.6-MariaDB');
    const tz = state.executed.find((item) => /time_zone = \?/.test(item.sql));
    expect(tz?.params).toEqual(['+08:00']);
  });
});

describe('ping / probeWritable', () => {
  it('returns version, table count and the time zone probe', async () => {
    const { factory } = fakeDriver((sql) =>
      /COUNT\(\*\)/.test(sql)
        ? [{ n: '42' }]
        : [{ version: '8.4.0', global_tz: 'SYSTEM', session_tz: 'SYSTEM', system_tz: 'CST', server_now: '2026-09-15 10:00:00', server_utc_now: '2026-09-15 02:00:00', offset_minutes: 480 }],
    );
    const ping = await createMysqlConnector(config, factory).ping();
    expect(ping.serverVersion).toBe('8.4.0');
    expect(ping.tableCount).toBe(42);
    expect(ping.timeZone.offsetMinutes).toBe(480);
    expect(ping.timeZone.summary).toContain('CST');
  });

  it('reads SHOW GRANTS rows regardless of the column name', async () => {
    const { factory, state } = fakeDriver((sql) =>
      /SHOW GRANTS/.test(sql) ? [{ 'Grants for reader@%': 'GRANT USAGE ON *.* TO `reader`@`%`' }, { 'Grants for reader@%': 'GRANT SELECT, INSERT ON `erp`.* TO `reader`@`%`' }] : [],
    );
    const probe = await createMysqlConnector(config, factory).probeWritable();
    expect(probe.writable).toBe(true);
    expect(state.executed.some((item) => item.sql === 'SHOW GRANTS FOR CURRENT_USER()')).toBe(true);
  });
});

describe('fetchSchema / fetchValues', () => {
  const infoSchema: Responder = (sql) => {
    if (/information_schema\.TABLES/.test(sql)) {
      return [
        { TABLE_NAME: 'orders', TABLE_ROWS: 120000, TABLE_COMMENT: '订单', TABLE_TYPE: 'BASE TABLE' },
        { TABLE_NAME: 'customers', TABLE_ROWS: 3000, TABLE_COMMENT: '客户', TABLE_TYPE: 'BASE TABLE' },
      ];
    }
    if (/information_schema\.COLUMNS/.test(sql)) {
      return [
        { TABLE_NAME: 'orders', COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: '' },
        { TABLE_NAME: 'orders', COLUMN_NAME: 'status', COLUMN_TYPE: 'tinyint', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: '状态' },
        { TABLE_NAME: 'customers', COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: '' },
      ];
    }
    if (/KEY_COLUMN_USAGE/.test(sql)) return [];
    if (/SELECT \* FROM `erp`\.`orders` LIMIT 20/.test(sql)) return [{ id: 1, status: 2 }, { id: 2, status: 3 }];
    if (/SELECT \* FROM `erp`\.`customers`/.test(sql)) throw new Error('timeout');
    return [];
  };

  it('builds the skeleton with per-column samples, counting tables whose sample scan failed', async () => {
    const { factory, state } = fakeDriver(infoSchema);
    const result = await createMysqlConnector(config, factory).fetchSchema({ sampleValues: true });
    expect(result.tables.map((table) => table.name)).toEqual(['orders', 'customers']);
    expect(result.tables[0].columns.find((column) => column.name === 'status')?.samples).toEqual(['2', '3']);
    expect(result.skippedSamples).toBe(1);
    expect(state.executed.filter((item) => /^SELECT \* FROM/.test(item.sql)).every((item) => item.timeoutMs === 2_000)).toBe(true);
    expect(state.executed.every((item) => !/secret/.test(item.sql))).toBe(true);
  });

  it('does not read any rows when samples are off, and limits sample scans to the requested tables', async () => {
    const off = fakeDriver(infoSchema);
    await createMysqlConnector(config, off.factory).fetchSchema({ sampleValues: false });
    expect(off.state.executed.some((item) => /^SELECT \* FROM/.test(item.sql))).toBe(false);

    const focused = fakeDriver(infoSchema);
    await createMysqlConnector(config, focused.factory).fetchSchema({ sampleValues: true, sampleTables: ['orders'] });
    const scans = focused.state.executed.filter((item) => /^SELECT \* FROM/.test(item.sql));
    expect(scans).toHaveLength(1);
    expect(scans[0].sql).toContain('`orders`');
  });

  it('collects value tables only for enum-like columns, marking 201+ distinct values and failures as null', async () => {
    const { factory, state } = fakeDriver((sql) => {
      if (/`status` AS v/.test(sql)) return [{ v: 1 }, { v: 2 }, { v: 3 }];
      if (/`region` AS v/.test(sql)) return Array.from({ length: 201 }, (_, index) => ({ v: `r${index}` }));
      if (/`is_test` AS v/.test(sql)) throw new Error('slow');
      return [];
    });
    const result = await createMysqlConnector(config, factory).fetchValues(sampleSkeleton());
    expect(result.values['orders.status']).toEqual(['1', '2', '3']);
    expect(result.values['orders.region']).toBeNull();
    expect(result.values['customers.is_test']).toBeNull();
    // customers.name 是 varchar(64)，也算候选；假驱动没给行就是空取值表
    expect(result.values['customers.name']).toEqual([]);
    expect(result.values['orders.paid_amount']).toBeUndefined();
    expect(result.values['orders.id']).toBeUndefined();
    expect(result.scannedColumns).toBe(4);
    const valueQuery = state.executed.find((item) => /`status` AS v/.test(item.sql));
    expect(valueQuery?.sql).toContain('MAX_EXECUTION_TIME(2000)');
    expect(valueQuery?.sql).toContain('LIMIT 201');
  });
});

describe('query', () => {
  it('streams rows up to maxRows and reports truncation after destroying the connection', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => [index, `r${index}`]);
    const { factory, state } = fakeDriver(() => [], rows);
    const result = await createMysqlConnector(config, factory).query('SELECT a, b FROM t', [], { maxRows: 4 });
    expect(result.columns).toEqual(['a', 'b']);
    expect(result.rows).toHaveLength(4);
    expect(result.truncated).toBe(true);
    expect(state.destroyed).toBe(1);
    expect(state.released).toBe(0);
  });

  it('caps maxRows at the hard limit and returns everything when the result is smaller', async () => {
    const rows = [[1, 'x'], [2, 'y']];
    const { factory, state } = fakeDriver(() => [], rows);
    const result = await createMysqlConnector(config, factory).query('SELECT a, b FROM t', [], { maxRows: HARD_MAX_ROWS * 10 });
    expect(result.rows).toEqual(rows);
    expect(result.truncated).toBe(false);
    expect(state.released).toBe(1);
  });

  it('propagates an already-aborted signal and translates its own timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = fakeDriver(() => [], [[1, 'x']]);
    await expect(createMysqlConnector(config, aborted.factory).query('SELECT 1', [], { signal: controller.signal })).rejects.toThrow('已取消');

    const slow = fakeDriver(() => [], [[1, 'x']], { streamError: new Error('boom') });
    await expect(createMysqlConnector(config, slow.factory).query('SELECT 1')).rejects.toThrow('boom');
  });

  it('closes the driver and starts a fresh one afterwards', async () => {
    const { factory, state } = fakeDriver(() => [], []);
    const connector = createMysqlConnector(config, factory);
    await connector.query('SELECT 1');
    await connector.close();
    expect(state.ended).toBe(true);
    await connector.query('SELECT 1');
    expect(state.acquired).toBe(2);
  });
});
