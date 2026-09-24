import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErpConnectionService } from '../../../electron/erp/service';

const adapter = vi.hoisted(() => ({
  open: vi.fn(), cancel: vi.fn(), submit: vi.fn(), close: vi.fn(),
}));

vi.mock('../../../electron/erp/taskboard-adapter', () => ({
  openAndFillErpTimeEntryForm: adapter.open,
  cancelErpTimeEntryForm: adapter.cancel,
  submitFilledErpTimeEntryForm: adapter.submit,
  closeErpTimeEntryList: adapter.close,
  ErpTimeEntrySubmissionError: class ErpTimeEntrySubmissionError extends Error {
    constructor(message: string, readonly dispatched: boolean) { super(message); }
  },
}));

const input = {
  origin: 'http://erp.test', taskId: '1001', taskName: 'APS 调整',
  workDate: '2026-09-21', workMinutes: 30, workContent: '调整排产算法。',
};

function connectedService(): ErpConnectionService {
  const service = new ErpConnectionService('unused-test-profile');
  const page = { url: () => `${input.origin}/taskboard/index`,
    locator: () => ({ waitFor: async () => undefined }) };
  Object.assign(service, {
    runtime: { runExclusive: async (operation: (currentPage: typeof page) => Promise<unknown>) => operation(page) },
    connection: { state: 'authenticated', origin: input.origin, userId: '7' },
  });
  return service;
}

describe('ERP connection dispatch result', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keeps a successful click outcome unknown when closing the outer list fails', async () => {
    adapter.open.mockResolvedValue({ ...input });
    adapter.submit.mockResolvedValue(undefined);
    adapter.close.mockRejectedValue(new Error('外层弹窗未关闭'));

    const result = await connectedService().submitTimeEntry(input);
    expect(result).toEqual({ status: 'outcome_unknown', message: '外层弹窗未关闭' });
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it('reports a failure before clicking as known not written', async () => {
    adapter.open.mockRejectedValue(new Error('无法定位任务'));
    const result = await connectedService().submitTimeEntry(input);
    expect(result).toEqual({ status: 'known_not_written', message: '无法定位任务' });
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it('keeps the result unknown when clicking may have sent the form before Playwright rejects', async () => {
    adapter.open.mockResolvedValue({ ...input });
    adapter.submit.mockRejectedValue(new Error('点击后页面关闭'));

    const result = await connectedService().submitTimeEntry(input);
    expect(result).toEqual({ status: 'outcome_unknown', message: '点击后页面关闭' });
    expect(adapter.submit).toHaveBeenCalledOnce();
  });
});
