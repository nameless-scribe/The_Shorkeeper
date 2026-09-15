import { describe, expect, it } from 'vitest';
import { mergeSkeleton, type TableSkeleton } from '../dictionary';
import { pickTablesForQuestion, scoreTableForQuestion } from '../table-search';
import { sampleDictionary } from './fixtures';

function bigDictionary(count: number) {
  const skeleton: TableSkeleton[] = Array.from({ length: count }, (_, index) => ({
    name: `t_${index}`,
    comment: index === 7 ? '报工记录' : index === 12 ? '项目' : '',
    columns: [
      { name: 'id', type: 'bigint', nullable: false, primaryKey: true, samples: [] },
      ...(index === 7 ? [{ name: 'work_hours', type: 'decimal(8,2)', nullable: true, primaryKey: false, samples: [], comment: '工时' }] : []),
    ],
    foreignKeys: [],
  }));
  return mergeSkeleton('src-1', skeleton);
}

describe('pickTablesForQuestion', () => {
  it('ranks tables whose business names, comments or column comments overlap the question', () => {
    const dictionary = bigDictionary(80);
    const picked = pickTablesForQuestion(dictionary, '上个月的工时统计，按报工看', 5);
    expect(picked[0].table).toBe('t_7');
    expect(picked[0].score).toBeGreaterThan(0);
    expect(picked).toHaveLength(5);
    expect(picked.slice(1).every((item) => item.score === 0)).toBe(true);
  });

  it('matches latin identifiers and business names, and pads with focused tables', () => {
    const dictionary = sampleDictionary();
    const orders = scoreTableForQuestion(dictionary, 'orders', new Set(['订单', 'orders']));
    const customers = scoreTableForQuestion(dictionary, 'customers', new Set(['订单', 'orders']));
    expect(orders).toBeGreaterThan(customers);
    const picked = pickTablesForQuestion(dictionary, '看看客户', 2);
    expect(picked.map((item) => item.table)).toEqual(['customers', 'orders']);
  });
});
