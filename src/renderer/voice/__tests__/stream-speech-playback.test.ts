import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playAudioWithGain = vi.hoisted(() => vi.fn());

vi.mock('../play-audio', () => ({ playAudioWithGain }));

import { streamSpeechPlayback } from '../stream-speech-playback';

describe('stream speech playback lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      shorekeeper: {
        voice: {
          synthesizeChunk: vi.fn(async () => ({
            ok: true,
            audio: new ArrayBuffer(8),
          })),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops a playback handle that finishes creating after cancellation', async () => {
    let releaseHandle!: (handle: { stop: () => void }) => void;
    const pendingHandle = new Promise<{ stop: () => void }>((resolve) => {
      releaseHandle = resolve;
    });
    const stop = vi.fn();
    playAudioWithGain.mockReturnValueOnce(pendingHandle);
    const onFinished = vi.fn();
    const onError = vi.fn();

    const playback = await streamSpeechPlayback('这是一句试听文本。', 200, 1, {
      onLoading: vi.fn(),
      onPlaying: vi.fn(),
      onFinished,
      onError,
    });
    await vi.waitFor(() => expect(playAudioWithGain).toHaveBeenCalledOnce());
    playback.stop();
    releaseHandle({ stop });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(onFinished).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
