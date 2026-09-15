import { describe, expect, it } from 'vitest';
import {
  describeMysqlError,
  describeTimeZoneProbe,
  formatCellValue,
  grantsAllowWrite,
  isPrivateHost,
  quoteIdentifier,
  samplesFromRows,
  shouldFetchValues,
  skeletonFromInformationSchema,
  sslWarning,
  VALUES_MAX_TABLE_ROWS,
} from '../mysql-helpers';

describe('isPrivateHost / sslWarning', () => {
  it('treats loopback, RFC1918, link-local and bare machine names as private', () => {
    for (const host of ['localhost', '127.0.0.1', '10.2.3.4', '192.168.1.10', '172.16.0.1', '172.31.255.1', '169.254.1.1', '::1', 'fd12::1', 'db-server', 'erp.lan', 'erp.corp']) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['db.example.com', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it('warns only for a public host with SSL off', () => {
    expect(sslWarning('db.example.com', false)).toContain('SSL');
    expect(sslWarning('db.example.com', true)).toBeNull();
    expect(sslWarning('192.168.0.8', false)).toBeNull();
  });
});

describe('quoteIdentifier', () => {
  it('backticks valid identifiers and rejects injection-shaped names', () => {
    expect(quoteIdentifier('orders')).toBe('`orders`');
    expect(quoteIdentifier('_tmp$1')).toBe('`_tmp$1`');
    expect(() => quoteIdentifier('orders`; DROP TABLE x')).toThrow();
    expect(() => quoteIdentifier('a b')).toThrow();
    expect(() => quoteIdentifier('')).toThrow();
  });
});

describe('grantsAllowWrite', () => {
  it('reads USAGE and SELECT-only grants as read-only', () => {
    const probe = grantsAllowWrite([
      "GRANT USAGE ON *.* TO `reader`@`%`",
      'GRANT SELECT, SHOW VIEW ON `erp`.* TO `reader`@`%`',
    ]);
    expect(probe).toEqual({ writable: false, evidence: null, hasRoles: false });
  });

  it('flags INSERT, ALL PRIVILEGES and column-level UPDATE as writable, without the password', () => {
    expect(grantsAllowWrite(['GRANT SELECT, INSERT ON `erp`.* TO `app`@`%`']).writable).toBe(true);
    const all = grantsAllowWrite(["GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost' IDENTIFIED BY PASSWORD '*ABC' WITH GRANT OPTION"]);
    expect(all.writable).toBe(true);
    expect(all.evidence).not.toContain('IDENTIFIED');
    expect(all.evidence).not.toContain('*ABC');
    expect(grantsAllowWrite(['GRANT SELECT, UPDATE (status) ON `erp`.`orders` TO `app`@`%`']).writable).toBe(true);
  });

  it('notes role grants because their privileges are not visible here', () => {
    const probe = grantsAllowWrite(['GRANT USAGE ON *.* TO `u`@`%`', 'GRANT `app_writer`@`%` TO `u`@`%`']);
    expect(probe.writable).toBe(false);
    expect(probe.hasRoles).toBe(true);
    expect(grantsAllowWrite(['GRANT PROXY ON ``@`` TO `root`@`localhost` WITH GRANT OPTION']).hasRoles).toBe(false);
  });
});

describe('describeTimeZoneProbe', () => {
  it('explains SYSTEM sessions by the system zone and explicit sessions by their offset', () => {
    const system = describeTimeZoneProbe({ global_tz: 'SYSTEM', session_tz: 'SYSTEM', system_tz: 'CST', server_now: '2026-09-15 10:00:00', server_utc_now: '2026-09-15 02:00:00', offset_minutes: 480 });
    expect(system.summary).toContain('CST');
    expect(system.summary).toContain('UTC+08:00');
    expect(system.serverNow).toBe('2026-09-15 10:00:00');
    const explicit = describeTimeZoneProbe({ global_tz: '+00:00', session_tz: '-05:30', system_tz: 'UTC', server_now: new Date(Date.UTC(2026, 8, 15, 4, 30)), server_utc_now: null, offset_minutes: '-330' });
    expect(explicit.summary).toContain('-05:30');
    expect(explicit.summary).toContain('UTC-05:30');
    expect(explicit.serverNow).toBe('2026-09-15 04:30:00');
    expect(explicit.offsetMinutes).toBe(-330);
  });
});

describe('shouldFetchValues', () => {
  it('picks enum, short text and small integer status columns on tables under the row cap', () => {
    expect(shouldFetchValues({ type: "enum('a','b')", primaryKey: false })).toBe(true);
    expect(shouldFetchValues({ type: 'varchar(16)', primaryKey: false })).toBe(true);
    expect(shouldFetchValues({ type: 'char(2)', primaryKey: false })).toBe(true);
    expect(shouldFetchValues({ type: 'tinyint(1)', primaryKey: false })).toBe(true);
    expect(shouldFetchValues({ type: 'smallint unsigned', primaryKey: false })).toBe(true);
    expect(shouldFetchValues({ type: 'varchar(255)', primaryKey: false })).toBe(false);
    expect(shouldFetchValues({ type: 'int', primaryKey: false })).toBe(false);
    expect(shouldFetchValues({ type: 'text', primaryKey: false })).toBe(false);
    expect(shouldFetchValues({ type: 'varchar(16)', primaryKey: true })).toBe(false);
    expect(shouldFetchValues({ type: 'varchar(16)', primaryKey: false }, VALUES_MAX_TABLE_ROWS + 1)).toBe(false);
    expect(shouldFetchValues({ type: 'varchar(16)', primaryKey: false }, VALUES_MAX_TABLE_ROWS)).toBe(true);
  });
});

describe('skeletonFromInformationSchema', () => {
  it('assembles tables, columns in order, primary keys, comments and foreign keys', () => {
    const skeleton = skeletonFromInformationSchema(
      [
        { TABLE_NAME: 'orders', TABLE_ROWS: '120000', TABLE_COMMENT: '订单', TABLE_TYPE: 'BASE TABLE' },
        { TABLE_NAME: 'customers', TABLE_ROWS: null, TABLE_COMMENT: '', TABLE_TYPE: 'BASE TABLE' },
      ],
      [
        { TABLE_NAME: 'orders', COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: '' },
        { TABLE_NAME: 'orders', COLUMN_NAME: 'customer_id', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: 'MUL', COLUMN_COMMENT: '客户' },
        { TABLE_NAME: 'orders', COLUMN_NAME: 'paid_at', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: null },
        { TABLE_NAME: 'customers', COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: '' },
        { TABLE_NAME: 'ghost', COLUMN_NAME: 'x', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '', COLUMN_COMMENT: '' },
      ],
      [
        { TABLE_NAME: 'orders', COLUMN_NAME: 'customer_id', REFERENCED_TABLE_NAME: 'customers', REFERENCED_COLUMN_NAME: 'id' },
        { TABLE_NAME: 'orders', COLUMN_NAME: 'customer_id', REFERENCED_TABLE_NAME: 'customers', REFERENCED_COLUMN_NAME: 'id' },
        { TABLE_NAME: 'orders', COLUMN_NAME: 'id', REFERENCED_TABLE_NAME: null, REFERENCED_COLUMN_NAME: null },
      ],
    );
    expect(skeleton.map((table) => table.name)).toEqual(['orders', 'customers']);
    const orders = skeleton[0];
    expect(orders.rowCountEstimate).toBe(120_000);
    expect(orders.comment).toBe('订单');
    expect(orders.columns.map((column) => column.name)).toEqual(['id', 'customer_id', 'paid_at']);
    expect(orders.columns[0].primaryKey).toBe(true);
    expect(orders.columns[1].comment).toBe('客户');
    expect(orders.columns[2].nullable).toBe(true);
    expect(orders.columns[2].comment).toBeUndefined();
    expect(orders.foreignKeys).toEqual([{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }]);
    expect(skeleton[1].rowCountEstimate).toBeUndefined();
    expect(skeleton[1].comment).toBeUndefined();
  });
});

describe('samples', () => {
  it('takes the first three distinct non-null values per column and skips binary', () => {
    const rows = [
      { a: 1, b: null, c: Buffer.from('x'), d: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
      { a: 1, b: ' 华东 ', c: 'ok', d: null },
      { a: 2, b: '', c: { nested: true }, d: 'kept' },
      { a: 3, b: 'x', c: null, d: null },
      { a: 4, b: 'y', c: null, d: null },
    ];
    expect(samplesFromRows(rows, ['a', 'b', 'c', 'd'])).toEqual({
      a: ['1', '2', '3'],
      b: ['华东', 'x', 'y'],
      c: ['ok'],
      d: ['2026-01-02 03:04:05', 'kept'],
    });
    expect(formatCellValue(new Uint8Array([1]))).toBeNull();
  });
});

describe('describeMysqlError', () => {
  it('translates common driver codes and clips unknown messages', () => {
    expect(describeMysqlError(Object.assign(new Error('x'), { code: 'ER_ACCESS_DENIED_ERROR' }))).toContain('密码');
    expect(describeMysqlError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toContain('端口');
    expect(describeMysqlError(Object.assign(new Error('x'), { code: 'ER_BAD_DB_ERROR' }))).toContain('数据库名');
    const long = describeMysqlError(new Error('y'.repeat(300)));
    expect(long.length).toBeLessThan(200);
    expect(long.endsWith('…')).toBe(true);
  });
});
