import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/repositories/task-runs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/repositories/task-runs')>();
  return { ...actual, updateTaskRunPhase: vi.fn(actual.updateTaskRunPhase) };
});

import { closeDatabase, initDatabase } from '../../db';
import {
  getTaskRun,
  listRunArtifacts,
  listTaskRunSteps,
  updateTaskRunPhase,
} from '../../db/repositories/task-runs';
import { LOCAL_APPEND_CONTRACT, READ_ONLY_CONTRACT, WORKSPACE_WRITE_CONTRACT } from '../../tools/contract';
import { createRunRecorder } from '../run-record';
import { listTaskRunContextSources } from '../../db/repositories/context-sources';

describe('run recorder', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-run-record-'));
    await initDatabase(path.join(tempDir, 'record.db'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists the run, its steps, artifacts and terminal state', () => {
    const recorder = createRunRecorder({ runId: 'run-1', sessionId: 's', kind: 'scheduled', triggerRef: 'task-9', enabled: true });
    recorder.start();
    recorder.setModel('model-x');
    recorder.context([{
      sourceType: 'memory', sourceId: 'memory-1', sourceRef: 'mem:memory-1',
      label: '偏好', summary: '用户喜欢拿铁', sourceUpdatedAt: 123,
    }]);
    recorder.phase('running');
    recorder.stepStart('c1', 'write_file', WORKSPACE_WRITE_CONTRACT);
    recorder.stepEnd('c1', 'write_file', {
      success: true,
      output: 'ok',
      artifacts: [{ relativePath: 'a.md', originalName: 'a.md', size: 1, sha256: 'h' }],
    });
    // A replayed call must not duplicate the artifact evidence.
    recorder.stepStart('c1', 'write_file', WORKSPACE_WRITE_CONTRACT);
    recorder.stepEnd('c1', 'write_file', {
      success: true,
      output: 'ok',
      metadata: { replayedToolCall: true },
      artifacts: [{ relativePath: 'a.md', originalName: 'a.md', size: 1, sha256: 'h' }],
    });
    recorder.waitingApproval();
    expect(getTaskRun('run-1')?.phase).toBe('waiting_approval');
    recorder.stepStart('c2', 'fetch_url');
    recorder.stepEnd('c2', 'fetch_url', { success: false, output: '', error: '已取消', errorCategory: 'cancelled' });
    // A read-only tool that echoes its input file as an attachment is not a produced artifact.
    recorder.stepStart('c3', 'read_file', READ_ONLY_CONTRACT);
    recorder.stepEnd('c3', 'read_file', {
      success: true,
      output: 'contents',
      artifacts: [{ relativePath: 'input.md', originalName: 'input.md', size: 8 }],
    });
    // A merged duplicate is recorded as skipped, never as a second success.
    recorder.stepStart('c4', 'create_user_task', LOCAL_APPEND_CONTRACT);
    recorder.stepEnd('c4', 'create_user_task', {
      success: true,
      output: 'ok',
      metadata: { duplicateSuppressed: true },
    });
    recorder.finish('finished', 'finished', undefined, 'msg-1');
    // Late events after the terminal state are ignored.
    recorder.phase('running');
    recorder.finish('error', 'error', 'late');

    expect(getTaskRun('run-1')).toMatchObject({
      kind: 'scheduled',
      triggerRef: 'task-9',
      modelId: 'model-x',
      phase: 'finished',
      assistantMessageId: 'msg-1',
      stepCount: 4,
      failedStepCount: 0,
    });
    expect(listTaskRunSteps('run-1').map((step) => [step.toolName, step.status, step.riskLevel])).toEqual([
      ['write_file', 'succeeded', 'medium'],
      ['fetch_url', 'cancelled', null],
      ['read_file', 'succeeded', 'read'],
      ['create_user_task', 'skipped', 'low'],
    ]);
    expect(listRunArtifacts('run-1').map((artifact) => artifact.relativePath)).toEqual(['a.md']);
    expect(listTaskRunContextSources('run-1')).toMatchObject([{
      sourceRef: 'mem:memory-1', label: '偏好', summary: '用户喜欢拿铁',
    }]);
  });

  it('never throws into the run when persistence fails, and degrades after the first failure', () => {
    const warnings: string[] = [];
    const recorder = createRunRecorder({ runId: 'run-2', sessionId: 's', enabled: true, logger: (message) => warnings.push(message) });
    closeDatabase();
    expect(() => recorder.start()).not.toThrow();
    expect(recorder.isEnabled()).toBe(false);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const seen = warnings.length;
    expect(() => recorder.stepStart('c', 'x')).not.toThrow();
    expect(() => recorder.finish('finished', 'finished')).not.toThrow();
    expect(warnings).toHaveLength(seen);
  });

  it('still writes the terminal state after a mid-run step write failed', () => {
    const warnings: string[] = [];
    const recorder = createRunRecorder({ runId: 'run-4', sessionId: 's', enabled: true, logger: (message) => warnings.push(message) });
    recorder.start();
    vi.mocked(updateTaskRunPhase).mockImplementationOnce(() => {
      throw new Error('EBUSY: resource busy');
    });
    recorder.phase('waiting_tool');
    expect(recorder.isEnabled()).toBe(false);
    expect(warnings[0]).toContain('EBUSY');

    recorder.stepStart('c1', 'write_file', WORKSPACE_WRITE_CONTRACT);
    recorder.finish('finished', 'finished', undefined, 'msg-4');

    expect(getTaskRun('run-4')).toMatchObject({ phase: 'finished', assistantMessageId: 'msg-4', stepCount: 0 });
    expect(listTaskRunSteps('run-4')).toEqual([]);
  });

  it('does nothing when disabled', () => {
    const recorder = createRunRecorder({ runId: 'run-3', sessionId: 's', enabled: false });
    recorder.start();
    recorder.finish('finished', 'finished');
    expect(getTaskRun('run-3')).toBeNull();
  });
});
