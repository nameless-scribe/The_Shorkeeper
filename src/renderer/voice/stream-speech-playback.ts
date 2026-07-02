import type { SpeechPlanStep } from '@/voice/text-for-speech';
import { planStreamingSpeechFromMessage } from '@/voice/text-for-speech';
import { playAudioWithGain } from './play-audio';

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function playAudioAndWait(
  data: ArrayBuffer,
  gain: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    void playAudioWithGain(data, gain, resolve)
      .then((handle) => {
        signal.addEventListener('abort', () => handle.stop(), { once: true });
      })
      .catch(reject);
  });
}

async function fetchChunk(text: string): Promise<ArrayBuffer> {
  const result = await window.shorekeeper.voice.synthesizeChunk({ text });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.audio;
}

function findNextSpeakStep(plan: SpeechPlanStep[], fromIndex: number): string | null {
  for (let i = fromIndex + 1; i < plan.length; i += 1) {
    const step = plan[i];
    if (step.type === 'speak') return step.text;
  }
  return null;
}

export interface StreamSpeechPlaybackHandle {
  stop: () => void;
}

export async function streamSpeechPlayback(
  text: string,
  maxChars: number,
  gain: number,
  callbacks: {
    onLoading: () => void;
    onPlaying: () => void;
    onFinished: () => void;
    onError: (message: string) => void;
  },
): Promise<StreamSpeechPlaybackHandle> {
  const controller = new AbortController();
  const plan = planStreamingSpeechFromMessage(text, maxChars);

  if (!plan.some((step) => step.type === 'speak')) {
    callbacks.onError('清理后无可用朗读文本');
    return { stop: () => undefined };
  }

  callbacks.onLoading();

  void (async () => {
    try {
      let prefetch: Promise<ArrayBuffer> | null = null;
      let startedPlayback = false;

      for (let i = 0; i < plan.length; i += 1) {
        if (controller.signal.aborted) return;

        const step = plan[i];
        if (step.type === 'pause') {
          callbacks.onPlaying();
          await delay(step.ms, controller.signal);
          continue;
        }

        const audio = prefetch ? await prefetch : await fetchChunk(step.text);
        prefetch = null;

        const nextSpeak = findNextSpeakStep(plan, i);
        if (nextSpeak) {
          prefetch = fetchChunk(nextSpeak);
        }

        if (!startedPlayback) {
          startedPlayback = true;
          callbacks.onPlaying();
        }

        await playAudioAndWait(audio, gain, controller.signal);
      }

      if (!controller.signal.aborted) {
        callbacks.onFinished();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      callbacks.onError(err instanceof Error ? err.message : '朗读失败');
    }
  })();

  return {
    stop: () => controller.abort(),
  };
}
