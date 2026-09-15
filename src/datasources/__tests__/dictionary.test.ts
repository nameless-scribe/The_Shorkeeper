import { describe, expect, it } from 'vitest';
import {
  CATALOG_MAX_TABLES,
  findJoin,
  formatMetrics,
  formatTableCatalog,
  formatTableDetail,
  mergeSkeleton,
  truncateSample,
} from '../dictionary';
import { JOIN_ORDERS_CUSTOMERS, sampleDictionary, sampleSkeleton } from './fixtures';

describe('data dictionary', () => {
  it('seeds business names from comments, derives N:1 joins from foreign keys and truncates samples', () => {
    const dictionary = mergeSkeleton('src-1', sampleSkeleton());
    expect(dictionary.tables.orders.manual.businessName).toBe('订单');
    expect(dictionary.tables.orders.columns.status?.businessName).toBe('状态');
    expect(findJoin(dictionary, JOIN_ORDERS_CUSTOMERS)).toMatchObject({ fromTable: 'orders', toTable: 'customers', cardinality: 'N:1' });
    const longest = dictionary.tables.customers.auto.columns.find((c) => c.name === 'name')!.samples[2];
    expect([...longest].length).toBe(41);
    expect(longest.endsWith('…')).toBe(true);
    expect(truncateSample('  a   b  ')).toBe('a b');
  });

  it('keeps the manual layer across a skeleton refresh and drops entries for vanished columns', () => {
    const previous = sampleDictionary();
    const refreshed = sampleSkeleton();
    refreshed[0].columns = refreshed[0].columns.filter((column) => column.name !== 'region');
    refreshed[0].comment = '订单主表';
    const merged = mergeSkeleton('src-1', refreshed, previous);
    expect(merged.tables.orders.manual.timeColumn).toBe('paid_at');
    expect(merged.tables.orders.manual.businessName).toBe('订单');
    expect(merged.tables.orders.columns.status?.enumValues).toEqual({ '1': '待付款', '2': '已付款', '3': '已退款' });
    expect(merged.tables.orders.columns.region).toBeUndefined();
    expect(merged.metrics.map((m) => m.name)).toEqual(['销售额', '订单数']);
    // 已有的连接不会因为外键再次出现而重复
    expect(merged.tables.orders.manual.joins.filter((join) => join.id === JOIN_ORDERS_CUSTOMERS)).toHaveLength(1);
  });

  it('formats the catalog one line per table and caps the list', () => {
    const catalog = formatTableCatalog(sampleDictionary());
    expect(catalog).toBe('- 订单（orders）；真源；时间基准 paid_at；约 120000 行\n- 客户（customers）；约 3000 行');
    const big = mergeSkeleton('src-2', Array.from({ length: CATALOG_MAX_TABLES + 5 }, (_, i) => ({
      name: `t${i}`, columns: [], foreignKeys: [],
    })));
    const lines = formatTableCatalog(big).split('\n');
    expect(lines).toHaveLength(CATALOG_MAX_TABLES + 1);
    expect(lines[lines.length - 1]).toContain('另有 5 张表未列出');
  });

  it('formats a table with enum meanings, known values and samples, and metrics with fragments', () => {
    const detail = formatTableDetail(sampleDictionary(), 'orders')!;
    expect(detail).toContain('表 订单（orders）');
    expect(detail).toContain('时间基准列：paid_at');
    expect(detail).toContain('- status tinyint；订单状态；枚举 1=待付款 2=已付款 3=已退款');
    expect(detail).toContain('- region varchar(16)；区域；取值 华东 / 华北 / 华南');
    expect(detail).toContain('- paid_amount decimal(12,2)；样例 199.00 / 38.50 / 1200.00');
    expect(detail).toContain('- orders.customer_id->customers.id（N:1，客户）');
    expect(formatTableDetail(sampleDictionary(), 'missing')).toBeNull();
    expect(formatMetrics(sampleDictionary())).toBe('- 销售额；粒度 订单；含税，扣退款；片段 SUM(f.paid_amount - f.refund_amount)\n- 订单数；片段 COUNT(DISTINCT f.id)');
    expect(formatMetrics({ ...sampleDictionary(), metrics: [] })).toContain('尚未定义指标');
  });
});
