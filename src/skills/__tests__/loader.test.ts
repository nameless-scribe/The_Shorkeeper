import { describe, expect, it } from 'vitest';
import {
  discoverSkills,
  formatSkillsForPrompt,
  invalidateSkillsCache,
} from '../loader';

describe('skills loader', () => {
  it('discovers example skill from skills/example/SKILL.md', () => {
    invalidateSkillsCache();
    const skills = discoverSkills();
    const example = skills.find((s) => s.id === 'example');
    expect(example).toBeDefined();
    expect(example?.name).toBe('简洁助手');
    expect(example?.trigger).toBe('manual');
    expect(example?.priority).toBe(0);
    expect(example?.allowedTools).toEqual(['read_file', 'list_dir', 'web_search', 'recall_memory']);
    expect(example?.systemPromptFragment).toContain('【技能：简洁助手】');
  });

  it('parses auto skill matchKeywords and priority', () => {
    invalidateSkillsCache();
    const excel = discoverSkills().find((s) => s.id === 'excel');
    expect(excel?.trigger).toBe('auto');
    expect(excel?.priority).toBe(10);
    expect(excel?.matchKeywords).toContain('xlsx');
    expect(excel?.matchKeywords).toContain('附件已解析');
  });

  it('wraps skills in structured tags for prompt', () => {
    const block = formatSkillsForPrompt([
      {
        id: 'excel',
        name: 'Excel 表格处理',
        description: '',
        version: '1.0.0',
        systemPromptFragment: 'body',
        trigger: 'auto',
        priority: 10,
      },
    ]);
    expect(block).toContain('<skill id="excel" name="Excel 表格处理">');
    expect(block).toContain('body');
    expect(block).toContain('</skill>');
  });

  it('caches discoverSkills until invalidated', () => {
    invalidateSkillsCache();
    const first = discoverSkills();
    const second = discoverSkills();
    expect(first).toBe(second);

    invalidateSkillsCache();
    const third = discoverSkills();
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });
});
