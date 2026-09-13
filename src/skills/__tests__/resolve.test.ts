import { describe, expect, it } from 'vitest';
import type { Skill } from '../loader';
import {
  getSkillRoutingText,
  resolveActiveSkills,
  resolveActiveSkillsWithDiagnostics,
} from '../resolve';

function skill(partial: Partial<Skill> & Pick<Skill, 'id' | 'trigger'>): Skill {
  return {
    name: partial.id,
    description: '',
    version: '1.0.0',
    systemPromptFragment: `【${partial.id}】`,
    priority: 0,
    kind: 'capability',
    validationErrors: [],
    ...partial,
  };
}

describe('resolveActiveSkills', () => {
  it('always activates manual skills when enabled', () => {
    const enabled = [
      skill({ id: 'example', trigger: 'manual' }),
      skill({
        id: 'excel',
        trigger: 'auto',
        matchKeywords: ['xlsx', '表格'],
      }),
    ];

    const active = resolveActiveSkills('你好', enabled);
    expect(active.map((s) => s.id)).toEqual(['example']);
  });

  it('activates auto skills when keywords match', () => {
    const enabled = [
      skill({
        id: 'excel',
        trigger: 'auto',
        matchKeywords: ['xlsx', '表格', '附件已解析'],
        priority: 10,
      }),
    ];

    expect(resolveActiveSkills('帮我分析这个表格', enabled).map((s) => s.id)).toEqual([
      'excel',
    ]);
    expect(
      resolveActiveSkills('[工作区附件已解析]\nheaders: ...', enabled).map((s) => s.id),
    ).toEqual(['excel']);
    expect(resolveActiveSkills('今天天气怎么样', enabled)).toEqual([]);
  });

  it('sorts by priority descending then name', () => {
    const enabled = [
      skill({
        id: 'excel',
        name: 'Excel',
        trigger: 'auto',
        matchKeywords: ['表格'],
        priority: 10,
      }),
      skill({
        id: 'task-execution',
        name: '多步任务',
        trigger: 'auto',
        matchKeywords: ['分析'],
        priority: 20,
      }),
    ];

    const active = resolveActiveSkills('分析表格数据', enabled);
    expect(active.map((s) => s.id)).toEqual(['task-execution', 'excel']);
  });

  it('deduplicates skills by id before activation', () => {
    const first = skill({ id: 'workspace', trigger: 'manual', priority: 10 });
    const duplicate = skill({ id: 'workspace', trigger: 'manual', priority: 1 });

    expect(resolveActiveSkills('你好', [first, duplicate]).map((s) => s.id)).toEqual([
      'workspace',
    ]);
  });

  it('resolves declared conflicts by priority', () => {
    const resolution = resolveActiveSkillsWithDiagnostics('运行任务', [
      skill({ id: 'high', trigger: 'manual', priority: 20, conflictsWith: ['low'] }),
      skill({ id: 'low', trigger: 'manual', priority: 10 }),
    ]);
    expect(resolution.activeSkills.map((item) => item.id)).toEqual(['high']);
    expect(resolution.decisions).toContainEqual(expect.objectContaining({
      skillId: 'low',
      status: 'conflict',
    }));
  });

  it('records the matched keyword without retaining the user message', () => {
    const resolution = resolveActiveSkillsWithDiagnostics('请分析这个 xlsx 表格', [
      skill({ id: 'excel', name: 'Excel', trigger: 'auto', matchKeywords: ['xlsx', '表格'] }),
      skill({ id: 'progress', name: 'Progress', trigger: 'auto', matchKeywords: ['导入待办'] }),
    ]);

    expect(resolution.decisions).toEqual([
      expect.objectContaining({ skillId: 'excel', status: 'active', matchedKeyword: 'xlsx' }),
      expect.objectContaining({ skillId: 'progress', status: 'not_matched' }),
    ]);
    expect(JSON.stringify(resolution.decisions)).not.toContain('请分析这个');
  });

  it('ignores parsed attachment contents when routing skills', () => {
    const message = '[用户已上传以下文件到工作区]\n- sales.xlsx → 工作区: sales.xlsx\n\n请分析销售额' +
      '\n\n[工作区附件已解析]\n数据行：[["导入待办"]]';
    expect(getSkillRoutingText(message)).not.toContain('导入待办');
    const active = resolveActiveSkills(message, [
      skill({ id: 'progress', trigger: 'auto', matchKeywords: ['导入待办'] }),
      skill({ id: 'excel', trigger: 'auto', matchKeywords: ['.xlsx'] }),
    ]);
    expect(active.map((item) => item.id)).toEqual(['excel']);
  });
});
