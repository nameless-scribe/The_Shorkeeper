import { describe, expect, it } from 'vitest';
import { locateFilterValues, similarity } from '../value-locator';
import { sampleDictionary, samplePlan } from './fixtures';

describe('locateFilterValues', () => {
  it('keeps exact values, maps enum labels to codes and fuzzy-matches close values with a note', () => {
    const dictionary = sampleDictionary();
    const plan = samplePlan({
      filters: [
        { column: 'orders.status', op: 'in', values: ['已付款', '3'] },
        { column: 'orders.region', op: 'eq', values: ['华东区'] },
      ],
    });
    const located = locateFilterValues(plan, dictionary);
    expect(located.plan.filters[0].values).toEqual(['2', '3']);
    expect(located.plan.filters[1].values).toEqual(['华东']);
    expect(located.plan.unresolved).toEqual([]);
    expect(located.locations.map((item) => item.how)).toEqual(['label', 'exact', 'fuzzy']);
    expect(located.notes).toEqual(['「华东区」按区域的登记值匹配为「华东」']);
  });

  it('turns an unknown value into a 范围过滤 question with candidate options', () => {
    const dictionary = sampleDictionary();
    const plan = samplePlan({ filters: [{ column: 'orders.status', op: 'eq', values: ['已发货'] }] });
    const located = locateFilterValues(plan, dictionary);
    expect(located.plan.unresolved).toHaveLength(1);
    expect(located.plan.unresolved[0].slot).toBe('范围过滤');
    expect(located.plan.unresolved[0].question).toBe('订单状态里没有「已发货」这一项，你指的是哪一个？');
    expect(located.plan.unresolved[0].options).toEqual(['待付款', '已付款', '已退款', '其他']);
    // 原值保留，等用户回答后由模型改写
    expect(located.plan.filters[0].values).toEqual(['已发货']);
  });

  it('leaves columns without a value table alone and wraps like values with wildcards', () => {
    const dictionary = sampleDictionary();
    const plan = samplePlan({
      filters: [
        { column: 'orders.paid_amount', op: 'gte', values: ['100'] },
        { column: 'customers.name', op: 'like', values: ['星泓'] },
        { column: 'customers.name', op: 'eq', values: ['岸边工作室'] },
      ],
    });
    const located = locateFilterValues(plan, dictionary);
    expect(located.plan.filters[0].values).toEqual(['100']);
    expect(located.plan.filters[1].values).toEqual(['%星泓%']);
    expect(located.plan.filters[2].values).toEqual(['岸边工作室']);
    expect(located.plan.unresolved).toEqual([]);
    expect(located.notes).toEqual([]);
  });

  it('does not duplicate an existing question and scores similarity sensibly', () => {
    const dictionary = sampleDictionary();
    const plan = samplePlan({
      filters: [{ column: 'orders.status', op: 'in', values: ['已发货', '已发货'] }],
    });
    expect(locateFilterValues(plan, dictionary).plan.unresolved).toHaveLength(1);
    expect(similarity('华东', '华东')).toBe(1);
    expect(similarity('华东区', '华东')).toBeCloseTo(0.9);
    expect(similarity('华北', '华南')).toBeLessThan(0.6);
  });
});
