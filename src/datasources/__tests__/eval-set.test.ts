import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVAL_MIN_QUESTIONS, EVAL_MIN_VAGUE, parseEvalSet } from '../eval-set';

describe('P7 eval set format', () => {
  it('parses a valid set and warns when it is still too small', () => {
    const parsed = parseEvalSet([
      { id: 'q1', question: '上个月哪个客户买得最多？', expect: { slots: { 指标: '销售额', 时间范围: '上个月' }, mustNotContain: ['SELECT', 'orders'] } },
      { id: 'q2', question: '看看最近卖得怎么样', expect: { mustAsk: true } },
      { id: 'q3', question: '8 月订单数', expect: { rowCountBetween: [1, 1], aggregate: { column: '订单数', equalsQueryName: '月订单数' } }, notes: '与命名查询对照' },
    ]);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.questions).toHaveLength(3);
    expect(parsed.questions[1].expect.mustAsk).toBe(true);
    expect(parsed.warnings).toEqual([
      `评测集只有 3 个问题，计划要求至少 ${EVAL_MIN_QUESTIONS} 个`,
      `笼统问题（mustAsk）只有 1 个，计划要求至少 ${EVAL_MIN_VAGUE} 个`,
    ]);
  });

  it.each([
    [{}, '必须是数组'],
    [[{ question: 'x' }], '缺少 id'],
    [[{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }], 'id 重复'],
    [[{ id: 'a' }], '缺少 question'],
    [[{ id: 'a', question: 'x', expect: { rowCountBetween: [5, 1] } }], 'rowCountBetween'],
    [[{ id: 'a', question: 'x', expect: { mustAsk: 'yes' } }], 'mustAsk'],
    [[{ id: 'a', question: 'x', expect: { mustNotContain: 'SELECT' } }], 'mustNotContain'],
  ])('rejects malformed input %#', (value, fragment) => {
    const parsed = parseEvalSet(value);
    expect('error' in parsed && parsed.error).toContain(fragment);
  });

  it('accepts the 10 user questions as the first baseline without count warnings', () => {
    const file = path.resolve(__dirname, '../../../docs/p7-eval/questions.json');
    const parsed = parseEvalSet(JSON.parse(fs.readFileSync(file, 'utf-8')));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.questions).toHaveLength(EVAL_MIN_QUESTIONS);
    expect(parsed.questions.filter((item) => item.expect.mustAsk)).toHaveLength(EVAL_MIN_VAGUE);
    expect(parsed.warnings).toEqual([]);
  });
});
