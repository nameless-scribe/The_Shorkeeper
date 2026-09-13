import type { SpeechPlanStep } from '../../voice/text-for-speech';
import {
  hasSpeakableCharacters,
  planStreamingSpeechFromMessage,
  prepareChunkForTts,
} from '../../voice/text-for-speech';
import { playAudioWithGain } from './play-audio';

type PrefetchState = {
  text: string;
  promise: Promise<ArrayBuffer>;
};

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

    let playbackHandle: { stop: () => void } | null = null;
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      playbackHandle?.stop();
      fail(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    void playAudioWithGain(data, gain, finish)
      .then((handle) => {
        if (settled || signal.aborted) {
          handle.stop();
          onAbort();
          return;
        }
        playbackHandle = handle;
      })
      .catch(fail);
  });
}

async function fetchChunk(text: string): Promise<ArrayBuffer> {
  const prepared = prepareChunkForTts(text);
  if (!prepared || !hasSpeakableCharacters(prepared)) {
    throw new Error('朗读文本为空');
  }

  const result = await window.shorekeeper.voice.synthesizeChunk({ text: prepared });
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
    let prefetch: PrefetchState | null = null;
    try {
      let startedPlayback = false;

      for (let i = 0; i < plan.length; i += 1) {
        if (controller.signal.aborted) return;

        const step = plan[i];
        if (step.type === 'pause') {
          callbacks.onPlaying();
          await delay(step.ms, controller.signal);
          continue;
        }

        const preparedText = prepareChunkForTts(step.text);
        if (!preparedText || !hasSpeakableCharacters(preparedText)) {
          continue;
        }

        const audio =
          prefetch?.text === preparedText
            ? await prefetch.promise
            : await fetchChunk(preparedText);
        prefetch = null;

        const nextSpeak = findNextSpeakStep(plan, i);
        if (nextSpeak) {
          const nextPrepared = prepareChunkForTts(nextSpeak);
          if (nextPrepared && hasSpeakableCharacters(nextPrepared)) {
            prefetch = { text: nextPrepared, promise: fetchChunk(nextPrepared) };
          }
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
    } finally {
      // A prefetched IPC request cannot currently be cancelled. Always attach a
      // rejection sink when playback ends before that request is consumed.
      void prefetch?.promise.catch(() => undefined);
    }
  })();

  return {
    stop: () => controller.abort(),
  };
}
