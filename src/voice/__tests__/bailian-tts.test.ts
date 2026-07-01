import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_DEFAULTS } from '../types';

vi.mock('../../config/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/voice')>();
  return {
    ...actual,
    getVoiceSettings: () => ({ ...VOICE_DEFAULTS, voiceApiKey: 'sk-test' }),
    resolveVoiceApiKey: () => 'sk-test',
    resolveTtsEndpoint: () => 'https://example.com/tts',
  };
});

import { BailianTtsEngine } from '../bailian-tts';

describe('BailianTtsEngine', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('downloads audio from response url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            audio: { url: 'https://example.com/out.mp3' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });

    const engine = new BailianTtsEngine(fetchMock as unknown as typeof fetch);
    const result = await engine.synthesize('你好', {
      model: 'cosyvoice-v3.5-plus',
      voiceId: 'cosyvoice-v3.5-plus-demo',
      rate: 1,
    });

    expect(result.mime).toBe('audio/mpeg');
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires voice id', async () => {
    const engine = new BailianTtsEngine(vi.fn() as unknown as typeof fetch);
    await expect(
      engine.synthesize('hi', {
        model: 'cosyvoice-v3.5-plus',
        voiceId: '',
        rate: 1,
      }),
    ).rejects.toThrow(/音色 ID/);
  });
});
