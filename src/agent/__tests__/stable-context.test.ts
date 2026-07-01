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
  formatToolGuideForPrompt,
  getStableSystemPrefix,
  invalidateStableContext,
} from '../stable-context';
import { getEnabledSkills } from '../../skills/state';
import { readFileTool } from '../../tools/file/read-file';
import { createScheduledTaskTool } from '../../tools/schedule/schedule-tools';

describe('stable context', () => {
  beforeEach(() => {
    invalidateStableContext();
    vi.mocked(getEnabledSkills).mockReturnValue([
      { id: 'skill-a', systemPromptFragment: '【技能A】' } as never,
    ]);
  });

  it('places persona before skills in stable prefix', () => {
    const text = getStableSystemPrefix();
    const personaIdx = text.indexOf('测试人设');
    const skillIdx = text.indexOf('【技能A】');

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(skillIdx).toBeGreaterThan(personaIdx);
    expect(text).not.toContain('create_scheduled_task');
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

  it('lists only provided tools in tool guide', () => {
    const guide = formatToolGuideForPrompt([readFileTool]);
    expect(guide).toContain('read_file');
    expect(guide).not.toContain('create_scheduled_task');
  });

  it('includes schedule hint when schedule tool is available', () => {
    const guide = formatToolGuideForPrompt([createScheduledTaskTool]);
    expect(guide).toContain('schedule_kind=once');
    expect(guide).toContain('create_scheduled_task');
    expect(guide).toContain('禁止仅口头答应');
  });
});
