import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { createCommitment, listCommitments, setCommitmentStatus } from '../../db/repositories/commitments';
import { listUserTasks } from '../../db/user-tasks';
import {
  normalizeCommitmentTitle,
  parseCommitmentDrafts,
  proposeCommitmentsFromDrafts,
} from '../commitment-extraction';

describe('commitment extraction', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-commitment-extract-'));
    await initDatabase(path.join(tempDir, 'extract.db'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses only commitment items and tolerates malformed fields', () => {
    const drafts = parseCommitmentDrafts([
      { key: 'user.nickname', content: '汐', confidence: 0.9 },
      { type: 'commitment', title: ' 周五前把报告发给老板 ', due: '2026-09-18', promised_to: '老板', confidence: 0.9, reason: '明确说了' },
      { type: 'commitment', content: '明天给妈妈打电话', confidence: 'high' },
      { type: 'commitment', title: '' },
      null,
      'text',
    ]);
    expect(drafts).toEqual([
      { title: '周五前把报告发给老板', due: '2026-09-18', promisedTo: '老板', confidence: 0.9, reason: '明确说了' },
      { title: '明天给妈妈打电话', due: null, promisedTo: null, confidence: 0.55, reason: '' },
    ]);
    expect(normalizeCommitmentTitle('周五前, 把报告发给老板！')).toBe('周五前把报告发给老板');
  });

  it('proposes confident, new commitments without creating tasks, and skips duplicates for 30 days', () => {
    const result = proposeCommitmentsFromDrafts(
      [
        { title: '周五前把报告发给老板', due: '2026-09-18', promisedTo: '老板', confidence: 0.9, reason: '' },
        { title: '也许下周健身', due: null, promisedTo: null, confidence: 0.4, reason: '' },
        { title: '周五前把报告发给老板。', due: null, promisedTo: null, confidence: 0.8, reason: '' },
      ],
      { sessionId: 's1', runId: 'run-1' },
    );
    expect(result).toEqual({ proposed: 1, skippedLowConfidence: 1, skippedDuplicate: 1 });

    const [proposed] = listCommitments({ status: 'proposed' });
    expect(proposed).toMatchObject({
      title: '周五前把报告发给老板',
      owner: 'user',
      status: 'proposed',
      promisedTo: '老板',
      sourceSessionId: 's1',
      sourceRunId: 'run-1',
      taskId: null,
    });
    expect(proposed.dueAt).toBe(new Date(2026, 8, 18, 23, 59, 59, 999).getTime());
    expect(listUserTasks()).toEqual([]);

    // The user rejected it: it must not be proposed again next turn.
    setCommitmentStatus(proposed.id, 'cancelled');
    const again = proposeCommitmentsFromDrafts(
      [{ title: '周五前把报告发给老板', due: null, promisedTo: null, confidence: 0.95, reason: '' }],
      { sessionId: 's1' },
    );
    expect(again).toEqual({ proposed: 0, skippedLowConfidence: 0, skippedDuplicate: 1 });

    // An old record outside the window no longer blocks a fresh proposal.
    const old = createCommitment({ title: '每年体检', owner: 'user' });
    expect(
      proposeCommitmentsFromDrafts(
        [{ title: '每年体检', due: null, promisedTo: null, confidence: 0.9, reason: '' }],
        { sessionId: 's1', now: old.createdAt + 31 * 24 * 60 * 60 * 1000 },
      ).proposed,
    ).toBe(1);
  });
});
