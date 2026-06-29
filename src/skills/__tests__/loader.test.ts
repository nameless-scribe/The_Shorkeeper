import { describe, expect, it } from 'vitest';
import { discoverSkills } from '../loader';

describe('skills loader', () => {
  it('discovers example skill from skills/example/SKILL.md', () => {
    const skills = discoverSkills();
    const example = skills.find((s) => s.id === 'example');
    expect(example).toBeDefined();
    expect(example?.name).toBe('简洁助手');
    expect(example?.allowedTools).toEqual(['read_file', 'list_dir', 'web_search', 'recall_memory']);
    expect(example?.systemPromptFragment).toContain('【技能：简洁助手】');
  });
});
