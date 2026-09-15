import { describe, expect, it } from 'vitest';
import { containsTechnicalTerms, describeTimeRange, renderQueryPlan } from '../plan-render';
import { sampleDictionary, samplePlan } from './fixtures';

describe('describeTimeRange', () => {
  it('says whole months, whole years, single days and explicit spans in plain words', () => {
    expect(describeTimeRange('2026-08-01', '2026-09-01')).toBe('2026 年 8 月');
    expect(describeTimeRange('2026-12-01', '2027-01-01')).toBe('2026 年 12 月');
    expect(describeTimeRange('2026-01-01', '2027-01-01')).toBe('2026 年全年');
    expect(describeTimeRange('2026-08-15', '2026-08-16')).toBe('2026 年 8 月 15 日');
    expect(describeTimeRange('2026-08-10', '2026-08-21')).toBe('2026 年 8 月 10 日 到 2026 年 8 月 20 日');
  });
});

describe('renderQueryPlan', () => {
  it('renders the plan in business language with enum labels and no technical terms', () => {
    const rendering = renderQueryPlan(samplePlan(), sampleDictionary());
    expect(rendering.summary).toBe(
      '我准备这样统计：2026 年 8 月（按付款时间），每个客户名称的销售额和订单数，只算订单状态在「已付款、已退款」之内，按销售额从高到低取前 100 条。',
    );
    expect(rendering.lines).toEqual([
      '时间范围：2026 年 8 月（按付款时间）',
      '统计：销售额、订单数',
      '按客户名称分别统计',
      '只算：订单状态在「已付款、已退款」之内',
      '按销售额从高到低，最多取 100 条',
    ]);
    expect(rendering.missingNames).toEqual([]);
    expect(containsTechnicalTerms(rendering.summary)).toBe(false);
    expect(containsTechnicalTerms(rendering.lines.join('\n'))).toBe(false);
    for (const forbidden of ['orders', 'customers', 'paid_at', 'status', 'SUM', 'DISTINCT', 'JOIN']) {
      expect(rendering.summary).not.toContain(forbidden);
    }
  });

  it('lists missing business names instead of leaking physical names', () => {
    const dictionary = sampleDictionary();
    delete dictionary.tables.customers.columns.name;
    dictionary.tables.orders.manual.businessName = undefined;
    dictionary.tables.orders.manual.description = undefined;
    const rendering = renderQueryPlan(samplePlan({ dimensions: [], grain: [] }), dictionary);
    expect(rendering.missingNames).toEqual(['orders']);
    expect(rendering.summary).toContain('某项数据');
    expect(rendering.summary).not.toContain('orders');
    const withGrain = renderQueryPlan(samplePlan(), dictionary);
    expect(withGrain.missingNames).toEqual(['orders', 'customers.name']);
    expect(withGrain.summary).toContain('每个某个字段');
  });

  it('carries the open question into the summary and describes comparisons', () => {
    const rendering = renderQueryPlan(
      samplePlan({ compare: { kind: 'yoy' }, unresolved: [{ slot: '范围过滤', question: '要不要把测试账号剔除？' }] }),
      sampleDictionary(),
    );
    expect(rendering.summary).toContain('并和去年同期比');
    expect(rendering.summary).toMatch(/有一点要确认：要不要把测试账号剔除？$/);
    expect(rendering.questions).toEqual(['要不要把测试账号剔除？']);
    expect(rendering.lines).toContain('并与去年同期对比');
  });

  it('flags the raw SQL escape hatch as unchecked', () => {
    const rendering = renderQueryPlan(samplePlan({ rawSql: 'SELECT 1', metrics: [] }), sampleDictionary());
    expect(rendering.lines[0]).toContain('未经自动核对');
    expect(containsTechnicalTerms(rendering.lines.join('\n'))).toBe(false);
  });
});
