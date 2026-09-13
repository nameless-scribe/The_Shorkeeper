import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { createMemory, getMemoryById } from '../../db/repositories/long-term-memory';
import { listMemoryCandidates } from '../../db/repositories/memory-candidates';
import { saveMemoryTool } from '../memory/memory-tools';

describe('P1.2 save_memory policy boundary', () => {
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `p1-memory-tool-${Date.now()}-${Math.random()}.db`);
    await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  const context = {
    sessionId: 'session-1',
    runId: 'run-1',
    workspaceRoot: os.tmpdir(),
    signal: new AbortController().signal,
  };

  it('stages a conflict instead of overwriting the existing value', async () => {
    const existing = createMemory({
      memoryKey: 'user.preference.drink',
      content: '用户喜欢拿铁',
      importance: 0.9,
      memoryType: 'preference',
    });
    const result = await saveMemoryTool.execute({
      key: 'user.preference.drink',
      content: '用户现在改喝茶',
      importance: 0.95,
    }, context);
    expect(result).toMatchObject({ success: true });
    expect(result.output).toContain('未覆盖原事实');
    expect(getMemoryById(existing.id)?.status).toBe('disputed');
    expect(listMemoryCandidates('pending')).toEqual([
      expect.objectContaining({
        conflictsWithMemoryId: existing.id,
        proposedAction: 'replace',
        sourceRunId: 'run-1',
      }),
    ]);
  });

  it('routes identity through confirmation and refuses credential capture', async () => {
    const identity = await saveMemoryTool.execute({
      key: 'user.nickname',
      content: '用户希望被称为小汐',
      importance: 0.99,
    }, context);
    expect(identity.output).toContain('需要用户确认');
    expect(listMemoryCandidates('pending')).toEqual([
      expect.objectContaining({ memoryType: 'identity', sourceRunId: 'run-1' }),
    ]);

    const credential = await saveMemoryTool.execute({
      key: 'user.preference.note',
      content: '用户的密码是 123456',
      importance: 1,
    }, context);
    expect(credential).toMatchObject({ success: false, errorCategory: 'invalid_arguments' });
    expect(listMemoryCandidates('pending')).toHaveLength(1);
  });
});
