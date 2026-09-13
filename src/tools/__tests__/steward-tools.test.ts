import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { getBriefing, listBriefings } from '../../db/repositories/briefings';
import { createUserTask } from '../../db/user-tasks';
import { formatLocalDate } from '../../tasks/due-date';
import { buildDailyBriefTool, buildEveningReviewTool } from '../tasks/steward-tools';
import { discoverSkills } from '../../skills/loader';
import { createBuiltinRegistry } from '../builtin';

const ctx = (runId: string) => ({
  sessionId: 's',
  workspaceRoot: '',
  signal: new AbortController().signal,
  runId,
});

describe('daily steward tools', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-steward-tools-'));
    await initDatabase(path.join(tempDir, 'steward.db'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates the morning brief once per day unless forced', async () => {
    createUserTask({ title: '今天的事', dueAt: formatLocalDate() });
    const first = await buildDailyBriefTool.execute({}, ctx('run-1'));
    expect(first.success).toBe(true);
    expect(first.output).toContain('今日到期待办（1）');
    expect(first.metadata).toMatchObject({ alreadyGenerated: false });
    expect(getBriefing(formatLocalDate(), 'morning')).toMatchObject({ runId: 'run-1', status: 'generated' });

    const again = await buildDailyBriefTool.execute({}, ctx('run-2'));
    expect(again.metadata).toMatchObject({ alreadyGenerated: true });
    expect(again.output).toContain('已在');
    expect(again.output).toContain('force=true');
    expect(again.output).not.toContain('今日到期待办');
    expect(getBriefing(formatLocalDate(), 'morning')?.runId).toBe('run-1');

    const forced = await buildDailyBriefTool.execute({ force: true }, ctx('run-3'));
    expect(forced.metadata).toMatchObject({ alreadyGenerated: false, regenerated: true });
    expect(forced.output).toContain('今日到期待办（1）');
    expect(getBriefing(formatLocalDate(), 'morning')?.runId).toBe('run-3');
    expect(listBriefings()).toHaveLength(1);
  });

  it('keeps morning and evening briefings independent', async () => {
    await buildDailyBriefTool.execute({}, ctx('run-m'));
    const evening = await buildEveningReviewTool.execute({}, ctx('run-e'));
    expect(evening.metadata).toMatchObject({ alreadyGenerated: false });
    expect(evening.output).toContain('晚间复盘数据');
    expect(listBriefings().map((item) => item.kind).sort()).toEqual(['evening', 'morning']);
  });

  it('is packaged as an auto skill whose required tools exist', () => {
    const skill = discoverSkills().find((item) => item.id === 'daily-steward');
    expect(skill).toBeDefined();
    expect(skill?.validationErrors).toEqual([]);
    expect(skill?.trigger).toBe('auto');
    const registered = new Set(createBuiltinRegistry().list().map((tool) => tool.name));
    for (const name of [...(skill?.requiredTools ?? []), ...(skill?.allowedTools ?? [])]) {
      expect(registered.has(name), `skill references unknown tool ${name}`).toBe(true);
    }
  });
});
