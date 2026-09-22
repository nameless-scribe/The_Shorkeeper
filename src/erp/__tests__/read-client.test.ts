import { describe, expect, it } from 'vitest';
import { ErpReadClient, type ErpApiTransport } from '../read-client';

class FakeTransport implements ErpApiTransport {
  calls: Array<{ path: string; params?: Record<string, string | number> }> = [];
  constructor(private readonly responses: unknown[]) {}
  async get(path: '/getInfo' | '/business/task/board' | '/business/time-entry/list', params?: Record<string, string | number>): Promise<unknown> {
    this.calls.push({ path, params });
    if (!this.responses.length) throw new Error('unexpected request');
    return this.responses.shift();
  }
}

describe('ERP read client', () => {
  it('reads the current identity, own tasks, and every daily entry page', async () => {
    const transport = new FakeTransport([
      { code: 200, user: { userId: 7, userName: '苏运来' } },
      { code: 200, data: [{ taskId: 1001, taskName: 'APS 调整', projectName: '日常', ownerId: 7, ownerName: '苏运来', actualHours: 3.5 }] },
      { code: 200, total: 2, rows: [{ timeEntryId: 31, taskId: 1001, ownerId: 7, workDate: '2026-09-21', workHour: 0.5, workContent: '修复', createBy: '苏运来' }] },
      { code: 200, total: 2, rows: [{ timeEntryId: 32, taskId: 1001, ownerId: 7, workDate: '2026-09-21', workHour: 1, workContent: '验证', createBy: '苏运来' }] },
    ]);
    const context = await new ErpReadClient(transport).readContext('2026-09-21');
    expect(context.identity).toEqual({ userId: '7', userName: '苏运来' });
    expect(context.existingMinutes).toBe(90);
    expect(context.entries.map((entry) => entry.timeEntryId)).toEqual(['31', '32']);
    expect(transport.calls.at(-1)?.params).toMatchObject({ pageNum: 2, ownerId: '7', workDate: '2026-09-21' });
  });

  it('stops when a response contains another user or date', async () => {
    const transport = new FakeTransport([
      { code: 200, total: 1, rows: [{ timeEntryId: 31, taskId: 1001, ownerId: 8, workDate: '2026-09-21', workHour: 1 }] },
    ]);
    await expect(new ErpReadClient(transport).listDailyEntries('7', '2026-09-21')).rejects.toThrow('其他用户或日期');
  });

  it('stops when pagination changes during the read', async () => {
    const transport = new FakeTransport([
      { code: 200, total: 2, rows: [{ timeEntryId: 31, taskId: 1001, ownerId: 7, workDate: '2026-09-21', workHour: 1 }] },
      { code: 200, total: 3, rows: [{ timeEntryId: 32, taskId: 1001, ownerId: 7, workDate: '2026-09-21', workHour: 1 }] },
    ]);
    await expect(new ErpReadClient(transport).listDailyEntries('7', '2026-09-21')).rejects.toThrow('发生变化');
  });

  it('rejects a daily total already above the eight-hour policy', async () => {
    const transport = new FakeTransport([
      { code: 200, user: { userId: 7, userName: '苏运来' } },
      { code: 200, data: [] },
      { code: 200, total: 1, rows: [{ timeEntryId: 31, taskId: 1001, ownerId: 7, workDate: '2026-09-21', workHour: 8.5 }] },
    ]);
    await expect(new ErpReadClient(transport).readContext('2026-09-21')).rejects.toThrow('超过 8 小时');
  });
});
