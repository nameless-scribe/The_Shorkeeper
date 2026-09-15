import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import { createTaskRun, markInterruptedRuns } from '../repositories/task-runs';
import {
  answerUserQuestion,
  createUserQuestion,
  findInterruptedQuestion,
  getUserQuestion,
  listUserQuestions,
  markInterruptedUserQuestions,
  statusForDecision,
} from '../repositories/user-questions';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

for (const adapter of adapters) {
  describe(`P6.2 user_questions ledger (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-p6-questions-'));
      db = (await adapter.open(path.join(tempDir, 'p6.db'))) as ContractDatabase;
      return db;
    }

    it('records a question with its options and settles it with the chosen option', async () => {
      const database = await open();
      createTaskRun({ id: 'run-1', sessionId: 's1' }, database);
      const created = createUserQuestion({
        runId: 'run-1',
        sessionId: 's1',
        question: '改哪一份？',
        why: '会写回文件',
        options: [{ id: 'v1', label: '报价单-v1', hint: '上周' }, { id: 'v2', label: '报价单-v2' }],
        askedAt: 1_000,
      }, database);
      expect(created).toMatchObject({
        runId: 'run-1', sessionId: 's1', question: '改哪一份？', why: '会写回文件',
        allowFreeText: true, status: 'pending', decidedBy: null, answer: null, optionId: null, askedAt: 1_000,
      });
      expect(created.options).toEqual([{ id: 'v1', label: '报价单-v1', hint: '上周' }, { id: 'v2', label: '报价单-v2' }]);

      const answered = answerUserQuestion(created.id, { answer: '报价单-v2', optionId: 'v2', decidedBy: 'user', answeredAt: 2_000 }, database);
      expect(answered).toMatchObject({ status: 'answered', decidedBy: 'user', answer: '报价单-v2', optionId: 'v2', answeredAt: 2_000 });

      // 已收口的记录不会被第二次结论覆盖
      answerUserQuestion(created.id, { decidedBy: 'timeout' }, database);
      expect(getUserQuestion(created.id, database)?.status).toBe('answered');
      expect(listUserQuestions('run-1', database).map((item) => item.id)).toEqual([created.id]);
    });

    it('maps every decision to a status and clips over-long text', async () => {
      const database = await open();
      expect(statusForDecision('user')).toBe('answered');
      expect(statusForDecision('timeout')).toBe('expired');
      expect(statusForDecision('abort')).toBe('cancelled');
      expect(statusForDecision('window_closed')).toBe('cancelled');
      expect(statusForDecision('startup')).toBe('interrupted');

      const created = createUserQuestion({ question: '问'.repeat(400), why: '因'.repeat(200) }, database);
      expect([...created.question].length).toBe(301);
      expect([...created.why ?? ''].length).toBe(121);
      const answered = answerUserQuestion(created.id, { answer: '答'.repeat(5_000), decidedBy: 'user' }, database);
      expect([...answered?.answer ?? ''].length).toBe(4_001);
    });

    it('collapses pending questions on startup together with their runs and exposes the last one', async () => {
      const database = await open();
      createTaskRun({ id: 'run-left', sessionId: 's1' }, database);
      createUserQuestion({ runId: 'run-left', question: '早一点的问题', askedAt: 10 }, database);
      createUserQuestion({ runId: 'run-left', question: '当时在等的问题', askedAt: 20 }, database);
      const done = createUserQuestion({ runId: 'run-left', question: '已答', askedAt: 5 }, database);
      answerUserQuestion(done.id, { answer: 'x', decidedBy: 'user' }, database);

      const summary = markInterruptedRuns(30, database);
      expect(summary.runIds).toEqual(['run-left']);
      expect(summary.questions).toBe(2);
      expect(listUserQuestions('run-left', database).map((item) => `${item.status}:${item.decidedBy}`))
        .toEqual(['answered:user', 'interrupted:startup', 'interrupted:startup']);
      expect(findInterruptedQuestion('run-left', database)?.question).toBe('当时在等的问题');
      expect(findInterruptedQuestion('run-missing', database)).toBeNull();
      // 再次收口没有 pending，返回 0
      expect(markInterruptedUserQuestions(40, database)).toBe(0);
    });
  });
}
