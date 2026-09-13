import { beforeEach, describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../tools/builtin';
import { discoverSkills, invalidateSkillsCache } from '../loader';
import { resolveActiveSkills } from '../resolve';

describe('product skill contracts', () => {
  beforeEach(() => invalidateSkillsCache());

  it('keeps product skills valid and their required tools available', () => {
    const tools = new Set(createBuiltinRegistry().list().map((tool) => tool.name));
    const productSkills = discoverSkills().filter((skill) => skill.kind !== 'internal');

    expect(productSkills.map((skill) => skill.id).sort()).toEqual([
      'daily-steward',
      'doc-to-markdown',
      'excel',
      'progress-tracker',
      'task-execution',
      'workspace-doc-edit',
    ]);
    for (const skill of productSkills) {
      expect(skill.validationErrors, skill.id).toEqual([]);
      for (const tool of skill.requiredTools ?? []) {
        expect(tools.has(tool), `${skill.id} requires missing tool ${tool}`).toBe(true);
      }
      for (const tool of skill.allowedTools ?? []) {
        expect(tools.has(tool), `${skill.id} allows missing tool ${tool}`).toBe(true);
      }
    }
  });

  it('does not activate task tracking for an unrelated spreadsheet attachment', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const active = resolveActiveSkills(
      '[用户已上传以下文件到工作区]\n- sales.xlsx → 工作区: sales.xlsx\n\n帮我统计销售额' +
        '\n\n[工作区附件已解析]\n文件: sales.xlsx',
      skills,
    );
    expect(active.map((skill) => skill.id)).toContain('excel');
    expect(active.map((skill) => skill.id)).not.toContain('progress-tracker');
  });

  it('does not activate multi-step execution for generic analysis wording', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const active = resolveActiveSkills('分析一下这段话', skills);
    expect(active.map((skill) => skill.id)).not.toContain('task-execution');
  });

  it('keeps internal example skills out of prompt formatting and activation', () => {
    const example = discoverSkills().find((skill) => skill.id === 'example');
    expect(example?.kind).toBe('internal');
    expect(resolveActiveSkills('你好', example ? [example] : [])).toEqual([]);
  });
});
