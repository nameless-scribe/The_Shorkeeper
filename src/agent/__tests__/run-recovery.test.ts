import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ready: true }));

vi.mock('../../db/state', () => ({
  isDatabaseReady: () => state.ready,
}));

import { closeDatabase, initDatabase } from '../../db';
import {
  createTaskRun,
  endTaskRunStep,
  finishTaskRun,
  getTaskRun,
  recordRunArtifacts,
  startTaskRunStep,
} from '../../db/repositories/task-runs';
import {
  acknowledgeInterruptedRuns,
  formatInterruptedRunNotice,
  peekInterruptedRunNotice,
  reconcileInterruptedRuns,
} from '../run-recovery';

describe('run recovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    state.ready = true;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-run-recovery-'));
    await initDatabase(path.join(tempDir, 'recovery.db'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('formats the interrupted run without claiming unfinished work as done', () => {
    const notice = formatInterruptedRunNotice({
      run: {
        id: 'r', sessionId: 's', kind: 'chat', triggerRef: null, phase: 'interrupted',
        terminalReason: 'process_exit', errorSummary: null, modelId: null, assistantMessageId: null,
        stepCount: 2, failedStepCount: 0, startedAt: Date.parse('2026-09-13T09:30:00'),
        updatedAt: 0, terminalAt: null, acknowledgedAt: null,
      },
      steps: [
        { id: 'r:1', runId: 'r', callId: '1', seq: 1, toolName: 'gen_docx', status: 'succeeded', errorCategory: null, errorSummary: null, riskLevel: 'medium', idempotent: true, startedAt: 0, endedAt: 1 },
        { id: 'r:2', runId: 'r', callId: '2', seq: 2, toolName: 'gen_pdf', status: 'interrupted', errorCategory: null, errorSummary: null, riskLevel: 'medium', idempotent: true, startedAt: 0, endedAt: 1 },
      ],
      artifacts: [
        { id: 'a', runId: 'r', stepId: 'r:1', sessionId: 's', toolName: 'gen_docx', relativePath: 'reports/week.docx', originalName: 'week.docx', size: 10, sha256: null, createdAt: 0 },
      ],
    });

    expect(notice).toContain('【上次运行中断】2026-09-13 09:30');
    expect(notice).toContain('已确认成功的步骤：gen_docx');
    expect(notice).toContain('未完成或失败的步骤：gen_pdf（interrupted）');
    expect(notice).toContain('已生成的文件：reports/week.docx');
    expect(notice).toContain('不要把未确认的步骤说成已完成');
  });

  it('reconciles leftover runs on startup and keeps the notice until a later run acknowledges it', () => {
    createTaskRun({ id: 'left', sessionId: 'session-a' });
    startTaskRunStep({ runId: 'left', callId: 'c1', toolName: 'write_file' });
    recordRunArtifacts({
      runId: 'left', callId: 'c1', sessionId: 'session-a', toolName: 'write_file',
      artifacts: [{ relativePath: 'notes.md', originalName: 'notes.md', size: 3 }],
    });
    endTaskRunStep('left', 'c1', { status: 'succeeded' });
    startTaskRunStep({ runId: 'left', callId: 'c2', toolName: 'gen_pdf' });
    createTaskRun({ id: 'ok', sessionId: 'session-a' });
    finishTaskRun('ok', { phase: 'finished', terminalReason: 'finished' });

    const summary = reconcileInterruptedRuns();
    expect(summary?.runIds).toEqual(['left']);
    expect(getTaskRun('left')?.phase).toBe('interrupted');
    expect(getTaskRun('ok')?.phase).toBe('finished');

    const first = peekInterruptedRunNotice('session-a');
    expect(first?.runId).toBe('left');
    expect(first?.notice).toContain('write_file');
    expect(first?.notice).toContain('gen_pdf（interrupted）');
    expect(first?.notice).toContain('notes.md');
    // A failed follow-up run does not acknowledge, so the notice survives for the next attempt.
    expect(peekInterruptedRunNotice('session-a')?.runId).toBe('left');
    expect(peekInterruptedRunNotice('session-b')).toBeNull();

    acknowledgeInterruptedRuns('session-a');
    expect(peekInterruptedRunNotice('session-a')).toBeNull();
  });

  it('acknowledges every older interrupted run of the session at once', () => {
    // Crash during A, restart, crash again during B (which carried A's notice), restart.
    createTaskRun({ id: 'run-a', sessionId: 's', startedAt: 1 });
    reconcileInterruptedRuns();
    createTaskRun({ id: 'run-b', sessionId: 's', startedAt: 2 });
    reconcileInterruptedRuns();
    createTaskRun({ id: 'other-session', sessionId: 't', startedAt: 3 });
    reconcileInterruptedRuns();

    expect(peekInterruptedRunNotice('s')?.runId).toBe('run-b');
    acknowledgeInterruptedRuns('s');
    // run-a must not resurface as a "last run" on the following turn.
    expect(peekInterruptedRunNotice('s')).toBeNull();
    expect(peekInterruptedRunNotice('t')?.runId).toBe('other-session');
  });

  it('does not list merged duplicate calls as unfinished work', () => {
    createTaskRun({ id: 'left', sessionId: 's' });
    startTaskRunStep({ runId: 'left', callId: 'c1', toolName: 'create_user_task' });
    endTaskRunStep('left', 'c1', { status: 'succeeded' });
    startTaskRunStep({ runId: 'left', callId: 'c2', toolName: 'create_user_task' });
    endTaskRunStep('left', 'c2', { status: 'skipped' });
    reconcileInterruptedRuns();

    const notice = peekInterruptedRunNotice('s')?.notice ?? '';
    expect(notice).toContain('已确认成功的步骤：create_user_task。');
    expect(notice).not.toContain('未完成或失败的步骤');
  });

  it('stays silent when the database is not ready', () => {
    createTaskRun({ id: 'left', sessionId: 'session-a' });
    reconcileInterruptedRuns();
    state.ready = false;
    expect(peekInterruptedRunNotice('session-a')).toBeNull();
    acknowledgeInterruptedRuns('session-a');
    state.ready = true;
    expect(peekInterruptedRunNotice('session-a')).not.toBeNull();
  });
});
