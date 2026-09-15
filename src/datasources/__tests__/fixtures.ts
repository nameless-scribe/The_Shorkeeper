import { mergeSkeleton, type DataDictionary, type TableSkeleton } from '../dictionary';
import type { QueryPlan } from '../query-plan';

/** 订单 / 客户两张表的固定字典：事实表 orders（时间基准 paid_at），维度 customers（N:1） */
export function sampleSkeleton(): TableSkeleton[] {
  return [
    {
      name: 'orders',
      comment: '订单',
      rowCountEstimate: 120_000,
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true, samples: ['1', '2', '3'] },
        { name: 'customer_id', type: 'bigint', nullable: false, primaryKey: false, samples: ['11', '12', '13'] },
        { name: 'status', type: 'tinyint', nullable: false, primaryKey: false, samples: ['1', '2', '3'], comment: '状态' },
        { name: 'paid_amount', type: 'decimal(12,2)', nullable: true, primaryKey: false, samples: ['199.00', '38.50', '1200.00'] },
        { name: 'refund_amount', type: 'decimal(12,2)', nullable: true, primaryKey: false, samples: ['0.00', '0.00', '38.50'] },
        { name: 'region', type: 'varchar(16)', nullable: true, primaryKey: false, samples: ['华东', '华北', '华南'] },
        { name: 'paid_at', type: 'datetime', nullable: true, primaryKey: false, samples: ['2026-08-01 10:00:00', '2026-08-02 11:30:00', '2026-08-03 09:15:00'], comment: '付款时间' },
      ],
      foreignKeys: [{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }],
    },
    {
      name: 'customers',
      comment: '客户',
      rowCountEstimate: 3_000,
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true, samples: ['11', '12', '13'] },
        { name: 'name', type: 'varchar(64)', nullable: false, primaryKey: false, samples: ['星泓科技', '岸边工作室', '客'.repeat(60)], comment: '客户名称' },
        { name: 'is_test', type: 'tinyint', nullable: false, primaryKey: false, samples: ['0', '0', '1'] },
      ],
      foreignKeys: [],
    },
  ];
}

export function sampleDictionary(): DataDictionary {
  const dictionary = mergeSkeleton('src-1', sampleSkeleton());
  dictionary.tables.orders.manual.isSource = true;
  dictionary.tables.orders.manual.timeColumn = 'paid_at';
  dictionary.tables.orders.manual.focused = true;
  dictionary.tables.orders.columns.status = {
    businessName: '订单状态',
    enumValues: { '1': '待付款', '2': '已付款', '3': '已退款' },
  };
  dictionary.tables.orders.columns.region = { businessName: '区域', knownValues: ['华东', '华北', '华南'] };
  dictionary.tables.customers.manual.focused = true;
  dictionary.tables.customers.columns.name = { businessName: '客户名称' };
  dictionary.tables.customers.columns.is_test = { businessName: '测试账号', enumValues: { '0': '否', '1': '是' } };
  dictionary.metrics = [
    { name: '销售额', sqlFragment: 'SUM(f.paid_amount - f.refund_amount)', grain: '订单', notes: '含税，扣退款', source: 'user' },
    { name: '订单数', sqlFragment: 'COUNT(DISTINCT f.id)', source: 'user' },
  ];
  return dictionary;
}

export const JOIN_ORDERS_CUSTOMERS = 'orders.customer_id->customers.id';

/** 每个客户 2026 年 8 月的销售额与订单数，只算已付款与已退款，销售额降序前 100 */
export function samplePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    sourceId: 'src-1',
    fact: { table: 'orders' },
    dimensions: [{ table: 'customers', join: JOIN_ORDERS_CUSTOMERS }],
    timeRange: { column: 'paid_at', from: '2026-08-01', to: '2026-09-01' },
    filters: [{ column: 'orders.status', op: 'in', values: ['2', '3'] }],
    grain: ['customers.name'],
    metrics: [
      { name: '销售额', fragment: 'SUM(f.paid_amount - f.refund_amount)' },
      { name: '订单数', fragment: 'COUNT(DISTINCT f.id)' },
    ],
    orderBy: { metric: '销售额', direction: 'desc' },
    limit: 100,
    unresolved: [],
    ...overrides,
  };
}
