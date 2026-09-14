import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: { new: (...args: unknown[]) => state.create(...args) },
}));

import { createVadController } from '../vad';

describe('VAD resource boundaries', () => {
  beforeEach(() => {
    state.create.mockReset();
    vi.stubGlobal('window', { location: { href: 'https://app.local/call' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('destroys an errored MicVAD instance before rejecting initialization', async () => {
    const destroy = vi.fn(async () => undefined);
    state.create.mockResolvedValue({ errored: '模型资源损坏', destroy });

    await expect(createVadController({
      redemptionMs: 800,
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
    })).rejects.toThrow('模型资源损坏');

    expect(destroy).toHaveBeenCalledOnce();
  });

  it('routes rejected speech callbacks to the VAD error handler', async () => {
    let runtimeOptions: { onSpeechStart(): void } | undefined;
    state.create.mockImplementation(async (options) => {
      runtimeOptions = options;
      return {
        errored: null,
        start: vi.fn(),
        pause: vi.fn(),
        setOptions: vi.fn(),
        destroy: vi.fn(),
      };
    });
    const onError = vi.fn();
    const controller = await createVadController({
      redemptionMs: 800,
      onSpeechStart: async () => {
        throw new Error('speech callback failed');
      },
      onSpeechEnd: vi.fn(),
      onError,
    });

    runtimeOptions?.onSpeechStart();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('speech callback failed'));
    await controller.destroy();
  });

  it('forwards vad-web misfires so callers can cancel a recording that will never get speech end', async () => {
    let runtimeOptions: { onVADMisfire(): void } | undefined;
    state.create.mockImplementation(async (options) => {
      runtimeOptions = options;
      return {
        errored: null,
        start: vi.fn(),
        pause: vi.fn(),
        setOptions: vi.fn(),
        destroy: vi.fn(),
      };
    });
    const onMisfire = vi.fn();
    const controller = await createVadController({
      redemptionMs: 800,
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onMisfire,
    });

    runtimeOptions?.onVADMisfire();
    await vi.waitFor(() => expect(onMisfire).toHaveBeenCalledOnce());
    await controller.destroy();
  });
});
