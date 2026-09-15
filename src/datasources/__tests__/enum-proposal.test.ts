import { describe, expect, it } from 'vitest';
import { buildEnumProposalMessages, collectEnumCandidates, ENUM_PROPOSAL_MAX_VALUES, parseEnumProposals, proposeEnumMeanings } from '../enum-proposal';
import { sampleDictionary } from './fixtures';

describe('collectEnumCandidates', () => {
  it('picks columns with a value table and no enum meanings yet', () => {
    const dictionary = sampleDictionary();
    // status 已有 enumValues；region 有取值表没含义；is_test 有 enumValues
    dictionary.tables.orders.auto.columns.find((column) => column.name === 'paid_amount')!.knownValues = Array.from({ length: ENUM_PROPOSAL_MAX_VALUES + 1 }, (_, i) => String(i));
    const candidates = collectEnumCandidates(dictionary, 'orders');
    expect(candidates.map((candidate) => candidate.column)).toEqual(['region']);
    expect(candidates[0]).toMatchObject({ type: 'varchar(16)', businessName: '区域', values: ['华东', '华北', '华南'] });
    expect(collectEnumCandidates(dictionary, 'missing')).toEqual([]);
  });
});

describe('buildEnumProposalMessages / parseEnumProposals', () => {
  it('puts column names, comments and values into the prompt', () => {
    const dictionary = sampleDictionary();
    const candidates = collectEnumCandidates(dictionary, 'orders');
    const messages = buildEnumProposalMessages('orders', '订单', candidates);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('表 orders（订单）');
    expect(messages[1].content).toContain('列 region（varchar(16)）');
    expect(messages[1].content).toContain('"华东"');
  });

  it('parses fenced JSON, keeps only known values and drops unknown columns and "?" meanings', () => {
    const candidates = [{ column: 'status', type: 'tinyint', values: ['1', '2', '3'] }];
    const reply = '```json\n[{"column":"status","values":{"1":"待付款","2":"已付款","3":"?","9":"幽灵"},"note":"按列名"},{"column":"ghost","values":{"1":"x"}},{"column":"status","values":{"1":"重复"}}]\n```';
    expect(parseEnumProposals(reply, candidates)).toEqual([{ column: 'status', values: { '1': '待付款', '2': '已付款' }, note: '按列名' }]);
    expect(() => parseEnumProposals('没有 JSON', candidates)).toThrow();
    expect(parseEnumProposals('[{"column":"status","values":{"1":"?"}}]', candidates)).toEqual([]);
  });
});

describe('proposeEnumMeanings', () => {
  it('returns nothing without candidates and never calls the model', async () => {
    const dictionary = sampleDictionary();
    delete dictionary.tables.orders.columns.region;
    let calls = 0;
    const result = await proposeEnumMeanings(dictionary, 'orders', {}, { complete: async () => { calls += 1; return '[]'; } });
    expect(result.proposals).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(calls).toBe(0);
  });

  it('feeds the candidates to the model and returns parsed proposals', async () => {
    const dictionary = sampleDictionary();
    const result = await proposeEnumMeanings(dictionary, 'orders', {}, {
      complete: async (messages) => {
        expect(messages[1].content).toContain('region');
        return '[{"column":"region","values":{"华东":"华东","华北":"华北","华南":"华南"}}]';
      },
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.proposals).toEqual([{ column: 'region', values: { 华东: '华东', 华北: '华北', 华南: '华南' } }]);
  });
});
