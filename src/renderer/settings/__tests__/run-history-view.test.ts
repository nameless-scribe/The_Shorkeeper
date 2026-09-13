import { describe, expect, it } from 'vitest';
import type { TaskRunInfo } from '@/shared/types';
import {
  formatApprovalDecider,
  formatErrorCategory,
  formatRiskLevel,
  formatRunDuration,
  formatRunIssue,
  runMatchesFilter,
  runPhaseTone,
} from '../run-history-view';

function run(phase: TaskRunInfo['phase'], patch: Partial<TaskRunInfo> = {}): TaskRunInfo {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    kind: 'chat',
    triggerRef: null,
    phase,
    terminalReason: null,
    errorSummary: null,
    modelId: null,
    assistantMessageId: null,
    stepCount: 0,
    failedStepCount: 0,
    startedAt: 1_000,
    updatedAt: 3_500,
    terminalAt: null,
    acknowledgedAt: null,
    ...patch,
  };
}

describe('run history view helpers', () => {
  it('groups active, successful and attention-needed phases', () => {
    expect(runMatchesFilter(run('waiting_approval'), 'active')).toBe(true);
    expect(runMatchesFilter(run('finished'), 'finished')).toBe(true);
    expect(runMatchesFilter(run('interrupted'), 'attention')).toBe(true);
    expect(runMatchesFilter(run('error'), 'attention')).toBe(true);
    expect(runMatchesFilter(run('cancelled'), 'attention')).toBe(false);
  });

  it('formats durations from the terminal timestamp when available', () => {
    expect(formatRunDuration(run('running'))).toBe('2.5s');
    expect(formatRunDuration(run('finished', { terminalAt: 66_000 }))).toBe('1m 5s');
  });

  it('uses semantic tones for terminal and active states', () => {
    expect(runPhaseTone('finished')).toBe('green');
    expect(runPhaseTone('error')).toBe('amber');
    expect(runPhaseTone('waiting_tool')).toBe('cyan');
    expect(runPhaseTone('cancelled')).toBe('muted');
  });

  it('hides the normal finished reason and translates actionable terminal reasons', () => {
    expect(formatRunIssue(run('finished', { terminalReason: 'finished' }))).toBeNull();
    expect(formatRunIssue(run('interrupted', {
      terminalReason: 'process_exit',
      errorSummary: '等待写入确认',
    }))).toBe('上次应用退出时运行尚未完成：等待写入确认');
  });

  it('uses user-facing labels for persisted enum values', () => {
    expect(formatRiskLevel('medium')).toBe('中');
    expect(formatApprovalDecider('user')).toBe('用户');
    expect(formatErrorCategory('path_out_of_scope')).toBe('路径超出工作区');
  });
});
