import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ value: '测试人设' })),
    })),
  })),
}));

vi.mock('../../skills/state', () => ({
  getEnabledSkills: vi.fn(() => [{ id: 'skill-a', systemPromptFragment: '【技能A】' }]),
  formatSkillsForPrompt: vi.fn((skills: { systemPromptFragment: string }[]) =>
    skills.map((s) => s.systemPromptFragment).join('\n\n'),
  ),
}));

import {
  getStableSystemPrefix,
  invalidateStableContext,
  TOOL_GUIDE,
} from '../stable-context';
import { getEnabledSkills } from '../../skills/state';

describe('stable context', () => {
  beforeEach(() => {
    invalidateStableContext();
    vi.mocked(getEnabledSkills).mockReturnValue([
      { id: 'skill-a', systemPromptFragment: '【技能A】' } as never,
    ]);
  });

  it('places persona and tool guide before skills', () => {
    const text = getStableSystemPrefix();
    const personaIdx = text.indexOf('测试人设');
    const toolIdx = text.indexOf('【可用工具】');
    const skillIdx = text.indexOf('【技能A】');

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(personaIdx);
    expect(skillIdx).toBeGreaterThan(toolIdx);
    expect(text).toContain(TOOL_GUIDE.slice(0, 20));
  });

  it('caches prefix until invalidated', () => {
    const first = getStableSystemPrefix();
    const second = getStableSystemPrefix();
    expect(first).toBe(second);

    invalidateStableContext();
    vi.mocked(getEnabledSkills).mockReturnValue([
      { id: 'skill-b', systemPromptFragment: '【技能B】' } as never,
    ]);
    const third = getStableSystemPrefix();
    expect(third).not.toBe(first);
    expect(third).toContain('【技能B】');
  });
});
