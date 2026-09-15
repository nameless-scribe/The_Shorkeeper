import { describe, expect, it } from 'vitest';
import {
  describeNamedQueryExample,
  findSimilarNamedQueries,
  instantiateTemplate,
  matchNamedQuery,
  parameterizePlan,
  parseNamedQueryPayload,
  planShapeKey,
  sameSlots,
  TIME_FROM_SLOT,
  TIME_TO_SLOT,
} from '../named-queries';
import { sampleDictionary, samplePlan } from './fixtures';

describe('parameterizePlan / instantiateTemplate', () => {
  it('pulls the time range and filter values into slots and restores them', () => {
    const plan = samplePlan();
    const payload = parameterizePlan(plan);
    expect(payload.template.timeRange).toEqual({ column: 'paid_at', from: TIME_FROM_SLOT, to: TIME_TO_SLOT });
    expect(payload.template.filters).toEqual([{ column: 'orders.status', op: 'in', values: ['{{filter_0_0}}', '{{filter_0_1}}'] }]);
    expect(payload.exampleSlots).toEqual({ timeRange: { from: '2026-08-01', to: '2026-09-01' }, filterValues: [['2', '3']] });
    expect('unresolved' in payload.template).toBe(false);
    expect(instantiateTemplate(payload.template, payload.exampleSlots)).toEqual(plan);
    const shifted = instantiateTemplate(payload.template, { timeRange: { from: '2026-09-01', to: '2026-10-01' }, filterValues: [['2']] });
    expect(shifted.timeRange).toEqual({ column: 'paid_at', from: '2026-09-01', to: '2026-10-01' });
    expect(shifted.filters[0].values).toEqual(['2']);
    expect(parseNamedQueryPayload(JSON.stringify(payload))).toEqual(payload);
    expect(parseNamedQueryPayload('{"legacy":true}')).toBeNull();
    expect(parseNamedQueryPayload('not json')).toBeNull();
  });

  it('treats plans with different literals as the same shape and identical only when every slot matches', () => {
    const a = samplePlan();
    const b = samplePlan({ timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' } });
    const c = samplePlan({ grain: ['orders.region'], dimensions: [] });
    expect(planShapeKey(a)).toBe(planShapeKey(b));
    expect(planShapeKey(a)).not.toBe(planShapeKey(c));
    expect(sameSlots(a, samplePlan())).toBe(true);
    expect(sameSlots(a, b)).toBe(false);
    expect(sameSlots(a, samplePlan({ limit: 10 }))).toBe(false);
  });
});

describe('findSimilarNamedQueries', () => {
  const candidate = (id: string, question: string, embedding?: number[]) => ({
    id,
    name: id,
    question,
    planJson: JSON.stringify(parameterizePlan(samplePlan())),
    notes: null,
    embedding: embedding ? Float32Array.from(embedding) : null,
  });

  it('uses cosine similarity with a 0.80 threshold when vectors exist, keyword overlap otherwise', () => {
    const query = Float32Array.from([1, 0, 0]);
    const matches = findSimilarNamedQueries(
      [candidate('near', '8 月每个客户的销售额', [0.95, 0.3, 0]), candidate('far', '库存', [0, 1, 0]), candidate('kw', '看看每个客户的销售额'), candidate('other', '发货明细')],
      '9 月每个客户的销售额',
      query,
    );
    expect(matches.map((match) => [match.query.id, match.by])).toEqual([['near', 'vector'], ['kw', 'keyword']]);
    expect(matches[0].score).toBeGreaterThan(0.8);
    expect(findSimilarNamedQueries([candidate('a', '客户销售额', [1, 0, 0])], '客户销售额', null)[0].by).toBe('keyword');
  });

  it('caps the examples at three, highest first', () => {
    const matches = findSimilarNamedQueries(
      ['a', 'b', 'c', 'd'].map((id) => candidate(id, `${id} 每个客户的销售额`)),
      '每个客户的销售额',
      null,
    );
    expect(matches).toHaveLength(3);
  });
});

describe('describeNamedQueryExample / matchNamedQuery', () => {
  it('renders the stored plan in business language and reports shape and slot matches', () => {
    const dictionary = sampleDictionary();
    const stored = { id: 'nq1', name: '月度客户销售额', question: '8 月每个客户的销售额', planJson: JSON.stringify(parameterizePlan(samplePlan())), notes: '含税', embedding: null };
    const text = describeNamedQueryExample(stored, dictionary);
    expect(text).toContain('命名查询「月度客户销售额」');
    expect(text).toContain('做法示例：我准备这样统计：2026 年 8 月');
    expect(text).toContain('口径说明：含税');

    expect(matchNamedQuery(samplePlan(), [stored])).toEqual({ query: stored, identical: true });
    expect(matchNamedQuery(samplePlan({ timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' } }), [stored])).toEqual({ query: stored, identical: false });
    expect(matchNamedQuery(samplePlan({ grain: [], dimensions: [] }), [stored])).toBeNull();
    expect(matchNamedQuery(samplePlan(), [{ ...stored, planJson: 'broken' }])).toBeNull();
  });
});
