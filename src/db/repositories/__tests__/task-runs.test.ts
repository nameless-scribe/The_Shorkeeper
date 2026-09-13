import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../../index';
import { openNativeDatabase } from '../../native-adapter';
import {
  acknowledgeTaskRun,
  createApproval,
  createTaskRun,
  decideApproval,
  endTaskRunStep,
  findUnacknowledgedInterruptedRun,
  finishTaskRun,
  getTaskRun,
  listApprovals,
  listRunArtifacts,
  listTaskRunSteps,
  listTaskRuns,
  markInterruptedRuns,
  recordRunArtifacts,
  startTaskRunStep,
  summarizeApprovalArgs,
  updateTaskRunPhase,
} from '../task-runs';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

for (const adapter of adapters) {
  describe(`task run repository (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-task-runs-${adapter.name}-`));
      db = await adapter.open(path.join(tempDir, 'runs.db'));
      return db;
    }

    it('records a run through steps, artifacts and a terminal state exactly once', async () => {
      const database = await open();
      const run = createTaskRun(
        { id: 'run-1', sessionId: 'session-1', kind: 'chat', modelId: 'test-model' },
        database,
      );
      expect(run.phase).toBe('running');
      expect(run.stepCount).toBe(0);

      expect(updateTaskRunPhase('run-1', 'waiting_tool', database)).toBe(true);
      const step = startTaskRunStep(
        { runId: 'run-1', callId: 'call-1', toolName: 'write_file', riskLevel: 'medium', idempotent: true },
        database,
      );
      expect(step.seq).toBe(1);
      expect(step.status).toBe('running');

      recordRunArtifacts(
        {
          runId: 'run-1',
          callId: 'call-1',
          sessionId: 'session-1',
          toolName: 'write_file',
          artifacts: [{ relativePath: 'reports\\a.md', originalName: 'a.md', size: 12, sha256: 'abc' }],
        },
        database,
      );
      endTaskRunStep('run-1', 'call-1', { status: 'succeeded' }, database);

      const failing = startTaskRunStep(
        { runId: 'run-1', callId: 'call-2', toolName: 'fetch_url', riskLevel: 'read' },
        database,
      );
      expect(failing.seq).toBe(2);
      endTaskRunStep(
        'run-1',
        'call-2',
        { status: 'failed', errorCategory: 'network_failure', errorSummary: 'x'.repeat(900) },
        database,
      );

      const finished = finishTaskRun(
        'run-1',
        { phase: 'finished', terminalReason: 'finished', assistantMessageId: 'msg-1' },
        database,
      );
      expect(finished).toMatchObject({
        phase: 'finished',
        terminalReason: 'finished',
        assistantMessageId: 'msg-1',
        stepCount: 2,
        failedStepCount: 1,
      });
      expect(finished?.terminalAt).not.toBeNull();

      // A late event from the same run cannot reopen or overwrite the terminal state.
      expect(updateTaskRunPhase('run-1', 'running', database)).toBe(false);
      finishTaskRun('run-1', { phase: 'error', terminalReason: 'error', errorSummary: 'late' }, database);
      expect(getTaskRun('run-1', database)?.phase).toBe('finished');
      expect(endTaskRunStep('run-1', 'call-1', { status: 'failed' }, database)?.status).toBe('succeeded');

      const steps = listTaskRunSteps('run-1', database);
      expect(steps.map((item) => [item.toolName, item.status, item.errorCategory])).toEqual([
        ['write_file', 'succeeded', null],
        ['fetch_url', 'failed', 'network_failure'],
      ]);
      expect(steps[1].errorSummary?.length).toBeLessThanOrEqual(501);

      const artifacts = listRunArtifacts('run-1', database);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        relativePath: 'reports/a.md',
        sha256: 'abc',
        stepId: 'run-1:call-1',
        toolName: 'write_file',
      });
    });

    it('marks every non-terminal run, running step and pending approval as interrupted on startup', async () => {
      const database = await open();
      createTaskRun({ id: 'done', sessionId: 's', startedAt: 1 }, database);
      finishTaskRun('done', { phase: 'finished', terminalReason: 'finished' }, database);
      createTaskRun({ id: 'stuck', sessionId: 's', startedAt: 2 }, database);
      startTaskRunStep({ runId: 'stuck', callId: 'c1', toolName: 'gen_docx' }, database);
      endTaskRunStep('stuck', 'c1', { status: 'succeeded' }, database);
      startTaskRunStep({ runId: 'stuck', callId: 'c2', toolName: 'gen_pdf' }, database);
      updateTaskRunPhase('stuck', 'waiting_approval', database);
      const approval = createApproval(
        { runId: 'stuck', sessionId: 's', toolName: 'gen_pdf', args: { path: 'x.pdf' }, riskLevel: 'medium' },
        database,
      );
      createTaskRun({ id: 'other', sessionId: 't', startedAt: 3 }, database);

      const summary = markInterruptedRuns(1_000, database);
      expect(summary.runIds.sort()).toEqual(['other', 'stuck']);
      expect(summary.steps).toBe(1);
      expect(summary.approvals).toBe(1);

      expect(getTaskRun('done', database)?.phase).toBe('finished');
      expect(getTaskRun('stuck', database)).toMatchObject({
        phase: 'interrupted',
        terminalReason: 'process_exit',
        terminalAt: 1_000,
      });
      expect(listTaskRunSteps('stuck', database).map((step) => step.status)).toEqual([
        'succeeded',
        'interrupted',
      ]);
      expect(listApprovals({ runId: 'stuck' }, database)[0]).toMatchObject({
        id: approval.id,
        status: 'interrupted',
        decidedBy: 'startup',
      });

      // Running the reconciliation again is a no-op.
      expect(markInterruptedRuns(2_000, database).runIds).toEqual([]);

      const pending = findUnacknowledgedInterruptedRun('s', database);
      expect(pending?.id).toBe('stuck');
      acknowledgeTaskRun('stuck', database);
      expect(findUnacknowledgedInterruptedRun('s', database)).toBeNull();
      expect(listTaskRuns({ sessionId: 's' }, database).map((run) => run.id)).toEqual(['stuck', 'done']);
      expect(listTaskRuns({ phases: ['interrupted'] }, database).map((run) => run.id).sort()).toEqual([
        'other',
        'stuck',
      ]);
    });

    it('stores approvals with a bounded, serialisable argument summary and a single decision', async () => {
      const database = await open();
      createTaskRun({ id: 'run-a', sessionId: 's' }, database);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(summarizeApprovalArgs(cyclic)).toBe('[unserializable]');
      expect(summarizeApprovalArgs({ content: 'x'.repeat(5_000) }).length).toBeLessThanOrEqual(2_001);

      const approval = createApproval(
        { runId: 'run-a', sessionId: 's', toolName: 'write_file', args: { path: 'a.md' }, riskLevel: 'medium' },
        database,
      );
      expect(approval.status).toBe('pending');
      expect(approval.argsSummary).toBe('{"path":"a.md"}');

      const decided = decideApproval(approval.id, 'denied', 'timeout', database);
      expect(decided).toMatchObject({ status: 'denied', decidedBy: 'timeout' });
      expect(decided?.decidedAt).not.toBeNull();
      // A second decision is ignored.
      expect(decideApproval(approval.id, 'approved', 'user', database)).toMatchObject({
        status: 'denied',
        decidedBy: 'timeout',
      });
      expect(listApprovals({ status: 'denied' }, database)).toHaveLength(1);
    });
  });
}
