import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_MODE_HINTS,
  ASSISTANT_MODE_LABELS,
  ASSISTANT_MODES,
  DEFAULT_ASSISTANT_MODE,
  allowsAutoMemoryExtraction,
  normalizeAssistantMode,
} from '../mode';
import { getAssistantModePrompt } from '../mode-prompt';

describe('assistant mode contract', () => {
  it('defaults unknown values to focus', () => {
    expect(DEFAULT_ASSISTANT_MODE).toBe('focus');
    expect(normalizeAssistantMode(undefined)).toBe('focus');
    expect(normalizeAssistantMode('unexpected')).toBe('focus');
  });

  it('keeps all supported modes explicit and permission-neutral', () => {
    for (const mode of ASSISTANT_MODES) {
      const prompt = getAssistantModePrompt(mode);
      expect(prompt).toContain(ASSISTANT_MODE_LABELS[mode]);
      expect(prompt).toContain('不改变工具权限');
      expect(ASSISTANT_MODE_HINTS[mode].length).toBeGreaterThan(4);
      expect(allowsAutoMemoryExtraction(mode)).toBe(mode !== 'companion');
    }
  });

  it('defines the focus and review feedback loops without changing permissions', () => {
    expect(getAssistantModePrompt('focus')).toContain('执行计划');
    expect(getAssistantModePrompt('focus')).toContain('工具失败或用户取消');
    expect(getAssistantModePrompt('review')).toContain('只读检查');
    expect(getAssistantModePrompt('review')).toContain('权限与确认链路');
  });

  it('defines organize and companion loops without changing permissions', () => {
    expect(getAssistantModePrompt('organize')).toContain('先检索再整理');
    expect(getAssistantModePrompt('organize')).toContain('不要把失败说成已归档');
    expect(getAssistantModePrompt('companion')).toContain('不会自动保存长期记忆');
    expect(getAssistantModePrompt('companion')).toContain('不调用有副作用的工具');
    expect(allowsAutoMemoryExtraction('companion')).toBe(false);
  });
});
