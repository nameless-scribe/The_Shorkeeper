import { describe, expect, it } from 'vitest';
import { quoteDatabaseName, quoteIdentifier } from '../mysql-helpers';
import { isQualifiedColumn, isSqlIdentifier } from '../query-plan';

describe('identifiers', () => {
  it('accepts Chinese and digit-leading MySQL names but never backticks, spaces or all-digit names', () => {
    for (const name of ['orders', '订单表', '2024_orders', 'tbl$1', '报工记录']) {
      expect(isSqlIdentifier(name), name).toBe(true);
      expect(quoteIdentifier(name)).toBe(`\`${name}\``);
    }
    for (const name of ['', '123', 'a b', 'a`b', 'a.b', 'orders; DROP TABLE x', 'x'.repeat(65)]) {
      expect(isSqlIdentifier(name), name).toBe(false);
      expect(() => quoteIdentifier(name)).toThrow();
    }
    expect(isQualifiedColumn('订单.状态')).toBe(true);
    expect(isQualifiedColumn('orders.1')).toBe(false);
    expect(isQualifiedColumn('a.b.c')).toBe(false);
  });

  it('quotes database names with hyphens or dots by escaping backticks', () => {
    expect(quoteDatabaseName('erp')).toBe('`erp`');
    expect(quoteDatabaseName('my-db.prod')).toBe('`my-db.prod`');
    expect(() => quoteDatabaseName('we`ird')).toThrow();
    expect(() => quoteDatabaseName('')).toThrow();
    expect(() => quoteDatabaseName(' padded')).toThrow();
    expect(() => quoteDatabaseName('a\nb')).toThrow();
  });
});
