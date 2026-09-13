import type { SpeechPlaybackStep } from '@/shared/types';

export interface AudioPlaybackHandle {
  stop: () => void;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Decode and play audio with optional gain above 100% (HTMLAudioElement caps at 1.0). */
export async function playAudioWithGain(
  data: ArrayBuffer,
  gain: number,
  onEnded: () => void,
): Promise<AudioPlaybackHandle> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(data.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = decoded;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0.5, Math.min(3, gain));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
      gainNode.disconnect();
      void ctx.close();
    };

    source.onended = () => {
      stop();
      onEnded();
    };

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    source.start(0);

    return { stop };
  } catch (error) {
    await ctx.close().catch(() => undefined);
    throw error;
  }
}

export async function playSpeechSteps(
  steps: SpeechPlaybackStep[],
  gain: number,
  onEnded: () => void,
): Promise<AudioPlaybackHandle> {
  const controller = new AbortController();
  let currentAudio: AudioPlaybackHandle | null = null;

  const stop = () => {
    controller.abort();
    currentAudio?.stop();
    currentAudio = null;
  };

  void (async () => {
    try {
      for (const step of steps) {
        if (controller.signal.aborted) return;

        if (step.kind === 'pause') {
          await delay(step.durationMs, controller.signal);
          continue;
        }

        await new Promise<void>((resolve, reject) => {
          void playAudioWithGain(step.audio, gain, resolve)
            .then((handle) => {
              currentAudio = handle;
              controller.signal.addEventListener('abort', () => handle.stop(), { once: true });
            })
            .catch(reject);
        });
        currentAudio = null;
      }

      if (!controller.signal.aborted) {
        onEnded();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[voice] 播放序列失败:', err);
      stop();
    }
  })();

  return { stop };
}
