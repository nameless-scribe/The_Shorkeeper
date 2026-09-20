import { describe, expect, it, vi } from 'vitest';
import { sendAgentRequestSafely } from '../agent-send';

describe('sendAgentRequestSafely', () => {
  it('turns a rejected IPC call into the optimistic-message rollback path', async () => {
    const rollback = vi.fn();

    await expect(sendAgentRequestSafely(
      () => Promise.reject(new Error('IPC channel closed')),
      rollback,
    )).resolves.toBeNull();
    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith('IPC channel closed');
  });

  it('returns domain results without treating them as transport failures', async () => {
    const rollback = vi.fn();
    const result = { ok: false, error: '会话不存在', runId: null };

    await expect(sendAgentRequestSafely(() => Promise.resolve(result), rollback)).resolves.toEqual(result);
    expect(rollback).not.toHaveBeenCalled();
  });
});
