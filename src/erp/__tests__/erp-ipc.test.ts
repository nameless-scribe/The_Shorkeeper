import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, raw: unknown) => unknown>(),
  disconnect: vi.fn(async () => undefined),
}));

vi.mock('../../../electron/ipc/trusted-ipc', () => ({
  trustedIpcMain: { handle: (channel: string, handler: (_event: unknown, raw: unknown) => unknown) => {
    ipc.handlers.set(channel, handler);
  } },
}));
vi.mock('../../../electron/erp/service', () => ({
  getErpConnectionService: () => ({ disconnect: ipc.disconnect }),
}));

import { registerErpIpc } from '../../../electron/ipc/erp';

describe('ERP settings IPC', () => {
  beforeEach(() => {
    ipc.handlers.clear();
    ipc.disconnect.mockClear();
    registerErpIpc();
  });

  it('does not disconnect an active browser for malformed settings', async () => {
    const save = ipc.handlers.get('erp:saveSettings');
    expect(save).toBeDefined();
    await expect(save!(undefined, { enabled: 'yes' })).rejects.toThrow();
    expect(ipc.disconnect).not.toHaveBeenCalled();
    await expect(save!(undefined, { apiPrefix: '/../invalid' })).rejects.toThrow('API 前缀无效');
    expect(ipc.disconnect).not.toHaveBeenCalled();
  });
});
