import { describe, expect, it } from 'vitest';
import { sanitizeFilename, formatAttachmentsForMessage } from '../../workspace/import';
import { parseRunAtIso, formatScheduleLabel, validateScheduleInput } from '../../scheduler/format';
import { createScheduledTaskTool } from '../schedule/schedule-tools';
import { setTaskChangeHandler, notifyTasksChanged } from '../../scheduler/task-events';
import type { ScheduledTaskInfo } from '../../shared/types';

describe('workspace import helpers', () => {
  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeFilename('foo<bar>.txt')).toBe('foo_bar_.txt');
  });

  it('formats attachments into user message prefix', () => {
    const msg = formatAttachmentsForMessage('请总结', [
      { relativePath: 'notes.md', originalName: 'notes.md', size: 120 },
    ]);
    expect(msg).toContain('notes.md');
    expect(msg).toContain('read_file');
    expect(msg).toContain('请总结');
  });
});

describe('schedule format', () => {
  it('parses ISO run_at', () => {
    const ts = parseRunAtIso('2026-06-30T15:00:00');
    expect(ts).not.toBeNull();
  });

  it('formats once vs recurring labels', () => {
    const once: ScheduledTaskInfo = {
      id: '1',
      name: 'test',
      scheduleKind: 'once',
      cron: '',
      runAt: new Date('2026-06-30T15:00:00').getTime(),
      actionType: 'reminder',
      actionPayload: '{}',
      enabled: true,
      lastRunAt: null,
    };
    expect(formatScheduleLabel(once)).toContain('一次性');

    const recurring: ScheduledTaskInfo = {
      ...once,
      scheduleKind: 'recurring',
      cron: '0 9 * * *',
      runAt: null,
    };
    expect(formatScheduleLabel(recurring)).toContain('周期');
  });

  it('validates schedule input', () => {
    expect(validateScheduleInput({ scheduleKind: 'once', runAt: Date.now() })).toBeNull();
    expect(validateScheduleInput({ scheduleKind: 'once', runAt: null })).toMatch(/run_at/);
    expect(validateScheduleInput({ scheduleKind: 'recurring', cron: '0 9 * * *' })).toBeNull();
    expect(validateScheduleInput({ scheduleKind: 'recurring', cron: '' })).toMatch(/cron/);
  });
});

describe('create_scheduled_task', () => {
  it('rejects invalid cron for recurring', async () => {
    const result = await createScheduledTaskTool.execute(
      {
        name: 'test',
        schedule_kind: 'recurring',
        cron: 'not-a-cron',
        message: 'hi',
      },
      { sessionId: 's1', workspaceRoot: '/tmp', signal: new AbortController().signal },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cron/);
  });

  it('requires run_at for once', async () => {
    const result = await createScheduledTaskTool.execute(
      {
        name: 'test',
        schedule_kind: 'once',
        message: 'hi',
      },
      { sessionId: 's1', workspaceRoot: '/tmp', signal: new AbortController().signal },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/run_at/);
  });
});

describe('task change handler', () => {
  it('notifies registered handler', () => {
    let called = 0;
    setTaskChangeHandler(() => {
      called += 1;
    });
    notifyTasksChanged();
    expect(called).toBe(1);
  });
});
