import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn(() => '测试人设'),
}));

import {
  EVIDENCE_FIRST_RULE,
  EVIDENCE_FIRST_RULE_SENTENCES,
  formatToolGuideForPrompt,
  getStableSystemPrefix,
  invalidateStableContext,
} from '../stable-context';
import { readFileTool } from '../../tools/file/read-file';
import { createScheduledTaskTool } from '../../tools/schedule/schedule-tools';
import { updateAgentPlanTool } from '../../tools/plan/plan-tools';
import { prepareErpReportTool, submitErpReportTool } from '../../tools/erp/erp-tools';

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

  it('carries the evidence-first rule after the context priority block, sentence by sentence (P6.0)', () => {
    const text = getStableSystemPrefix();
    expect(text.indexOf('【上下文优先级】')).toBeLessThan(text.indexOf('【证据不足先问】'));
    expect(text).toContain(EVIDENCE_FIRST_RULE);
    // 措辞固定：P6 计划 §9.1 的原文逐句存在，改一句就要同步计划
    expect(EVIDENCE_FIRST_RULE_SENTENCES).toHaveLength(6);
    for (const sentence of EVIDENCE_FIRST_RULE_SENTENCES) {
      expect(text).toContain(sentence);
    }
    expect(text).toContain('先问一个问题再做');
    expect(text).toContain('直接做，并在回复里写明你的假设');
    expect(text).toContain('找得到的不问');
    expect(text).toContain('一次只问一个问题');
    expect(text).toContain('提问不能代替确认');
    // P6.1 之前没有 ask_user，规则不能提到它
    expect(text).not.toContain('ask_user');
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

  it('does not let draft-only ERP tools claim a submission', () => {
    const guide = formatToolGuideForPrompt([prepareErpReportTool], ['erp-work-report']);
    expect(guide).toContain('禁止声称已提交或已写入 ERP');
  });

  it('requires verified submit evidence when the ERP write tool is available', () => {
    const guide = formatToolGuideForPrompt([prepareErpReportTool, submitErpReportTool], ['erp-work-report']);
    expect(guide).toContain('只有该工具返回成功且说明已回查核验');
    expect(guide).toContain('禁止自动重试');
  });
});
