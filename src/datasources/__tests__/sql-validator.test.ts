import { describe, expect, it } from 'vitest';
import { SQL_DEFAULT_LIMIT, SQL_MAX_LIMIT, validateReadOnlySql, wrapRawSql } from '../sql-validator';

function ok(sql: string, maxRows?: number) {
  const result = validateReadOnlySql(sql, maxRows);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

function rejected(sql: string): string {
  const result = validateReadOnlySql(sql);
  if (result.ok) throw new Error(`expected rejection for: ${sql}`);
  return result.error;
}

describe('read-only SQL validator', () => {
  it('accepts SELECT, WITH and subqueries and appends a LIMIT', () => {
    expect(ok('SELECT id FROM orders').sql).toBe(`SELECT id FROM orders LIMIT ${SQL_DEFAULT_LIMIT}`);
    expect(ok('WITH f AS (SELECT 1 AS x) SELECT x FROM f').sql).toMatch(/LIMIT 500$/);
    expect(ok('SELECT * FROM (SELECT id FROM orders) AS t WHERE id IN (SELECT id FROM customers)').ok).toBe(true);
    expect(ok('select id from orders;').sql).toBe('select id from orders LIMIT 500');
  });

  it('keeps the smaller of the requested and existing LIMIT and clamps to the ceiling', () => {
    expect(ok('SELECT id FROM orders LIMIT 20', 100).limit).toBe(20);
    expect(ok('SELECT id FROM orders LIMIT 9000', 100).sql).toMatch(/LIMIT 100$/);
    expect(ok('SELECT id FROM orders', 99_999).limit).toBe(SQL_MAX_LIMIT);
    expect(ok('SELECT id FROM orders LIMIT 10, 50', 500).sql).toMatch(/LIMIT 50$/);
  });

  it.each([
    ['UPDATE orders SET status = 1', 'UPDATE'],
    ['DELETE FROM orders', 'DELETE'],
    ['SELECT 1; DROP TABLE orders', '一条语句'],
    ['SELECT 1 -- comment', '注释'],
    ['SELECT /* x */ 1', '注释'],
    ["SELECT 1 # comment", '注释'],
    ["SELECT * INTO OUTFILE '/tmp/x' FROM orders", 'INTO'],
    ['CALL do_something()', 'SELECT 或 WITH'],
    ['WITH f AS (SELECT 1) UPDATE orders SET x = 1', 'WITH 的主体'],
    ['SELECT id FROM orders FOR UPDATE', '加锁'],
    ['SELECT LOAD_FILE(\'/etc/passwd\')', 'LOAD_FILE'],
    ['SHOW TABLES', 'SELECT 或 WITH'],
    ['', 'SQL 为空'],
  ])('rejects %s', (sql, fragment) => {
    expect(rejected(sql)).toContain(fragment);
  });

  it('does not treat keywords inside string literals as statements', () => {
    expect(ok("SELECT id FROM orders WHERE note = 'delete me; drop it -- now'").ok).toBe(true);
  });

  it('warns about aggregation right after a JOIN without DISTINCT or a grouped subquery', () => {
    const warned = ok('SELECT c.name, SUM(o.amount) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.name');
    expect(warned.warnings).toHaveLength(1);
    expect(warned.warnings[0]).toContain('放大');
    expect(ok('SELECT c.name, COUNT(DISTINCT o.id) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.name').warnings).toEqual([]);
    expect(ok('SELECT c.name, f.total FROM (SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id) f JOIN customers c ON c.id = f.customer_id').warnings).toEqual([]);
  });

  it('wraps raw SQL without parsing its own LIMIT', () => {
    expect(wrapRawSql('SELECT id FROM orders LIMIT 99999;', 50)).toBe('SELECT * FROM (SELECT id FROM orders LIMIT 99999) AS _q LIMIT 50');
  });
});
