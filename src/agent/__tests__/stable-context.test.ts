import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn(() => '测试人设'),
}));

import {
  formatToolGuideForPrompt,
  getStableSystemPrefix,
  invalidateStableContext,
} from '../stable-context';
import { readFileTool } from '../../tools/file/read-file';
import { createScheduledTaskTool } from '../../tools/schedule/schedule-tools';
import { updateAgentPlanTool } from '../../tools/plan/plan-tools';

describe('stable context', () => {
  beforeEach(() => {
    invalidateStableContext();
  });

  it('stable prefix contains persona but not skills', () => {
    const text = getStableSystemPrefix();
    expect(text).toContain('测试人设');
    expect(text).toContain('【上下文优先级】');
    expect(text).not.toContain('【技能');
    expect(text).not.toContain('create_scheduled_task');
  });

  it('caches prefix until invalidated', () => {
    const first = getStableSystemPrefix();
    const second = getStableSystemPrefix();
    expect(first).toBe(second);

    invalidateStableContext();
    const third = getStableSystemPrefix();
    expect(third).toBe(first);
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

  it('skips plan hint when task-execution skill is active', () => {
    const guide = formatToolGuideForPrompt(
      [updateAgentPlanTool, readFileTool],
      ['task-execution'],
    );
    expect(guide).not.toContain('【执行计划】');
  });

  it('shortens workspace write hint when workspace-doc-edit is active', () => {
    const guide = formatToolGuideForPrompt([readFileTool], ['workspace-doc-edit']);
    expect(guide).toContain('工作区文档维护');
    expect(guide).not.toContain('不可只在回复文字中描述已修改');
  });
});
