import {
  claimSpeechPlayback,
  releaseSpeechPlayback,
} from './speech-playback-coordinator';
import { AppendQueue } from './call-stream-append-queue';
import { SeqChunkCollector } from './call-stream-seq-collector';

export interface CallStreamPlaybackHandle {
  startRound(): void;
  enqueue(seq: number, audio: ArrayBuffer): void;
  markStreamEnd(): void;
  stop(): void;
  /** Resolves when stream ended and all queued chunks have played. */
  waitForPlaybackEnd(): Promise<void>;
}

export const MSE_MP3_MIME = 'audio/mpeg';

export function isMsePlaybackSupported(): boolean {
  return (
    typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MSE_MP3_MIME)
  );
}

/** Concatenate ordered MP3 byte chunks into one buffer for a single decode (fallback path). */
export function mergeAudioChunks(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function createFallbackCallStreamPlayback(gain: number): CallStreamPlaybackHandle {
  let ctx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let activeSource: AudioBufferSourceNode | null = null;
  let streamEnded = false;
  let stopped = false;
  let playbackStarted = false;
  let playInFlight = false;

  const collector = new SeqChunkCollector();
  const accumulated: Uint8Array[] = [];
  let endResolve: (() => void) | null = null;
  let endPromise: Promise<void> | null = null;

  const clampedGain = Math.max(0.5, Math.min(3, gain));

  const ensureContext = async (): Promise<AudioContext> => {
    if (!ctx) {
      ctx = new AudioContext();
      gainNode = ctx.createGain();
      gainNode.gain.value = clampedGain;
      gainNode.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  };

  const finishPlayback = () => {
    releaseSpeechPlayback(stop);
    endResolve?.();
    endResolve = null;
  };

  const maybeFinish = () => {
    if (!streamEnded || playInFlight || activeSource || stopped) return;
    finishPlayback();
  };

  const playAccumulated = async () => {
    if (stopped || playInFlight || playbackStarted) return;
    if (!streamEnded || collector.hasSeqGap()) return;

    playInFlight = true;
    try {
      if (accumulated.length === 0) {
        if (streamEnded) finishPlayback();
        return;
      }

      const audioCtx = await ensureContext();
      if (stopped || !gainNode) return;

      const merged = mergeAudioChunks(accumulated);
      let decoded: AudioBuffer;
      try {
        decoded = await audioCtx.decodeAudioData(merged.slice(0));
      } catch {
        if (streamEnded) finishPlayback();
        return;
      }
      if (stopped || !gainNode) return;

      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(gainNode);
      activeSource = source;
      playbackStarted = true;

      await new Promise<void>((resolve) => {
        source.onended = () => {
          activeSource = null;
          resolve();
        };
        source.start(0);
      });
    } finally {
      playInFlight = false;
      maybeFinish();
    }
  };

  const drain = () => {
    accumulated.push(...collector.drainOrdered());
    void playAccumulated();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    collector.clear();
    accumulated.length = 0;
    if (activeSource) {
      try {
        activeSource.stop();
      } catch {
        // already stopped
      }
      activeSource = null;
    }
    releaseSpeechPlayback(stop);
    try {
      void ctx?.close();
    } catch {
      // ignore
    }
    ctx = null;
    gainNode = null;
    endResolve?.();
    endResolve = null;
  };

  return {
    startRound() {
      stopped = false;
      streamEnded = false;
      playbackStarted = false;
      playInFlight = false;
      collector.reset();
      accumulated.length = 0;
      endPromise = new Promise<void>((resolve) => {
        endResolve = resolve;
      });
      claimSpeechPlayback(stop);
    },

    enqueue(seq, audio) {
      if (stopped) return;
      collector.add(seq, audio);
      drain();
    },

    markStreamEnd() {
      if (stopped) return;
      streamEnded = true;
      drain();
    },

    stop,

    waitForPlaybackEnd() {
      return endPromise ?? Promise.resolve();
    },
  };
}

function createMseCallStreamPlayback(gain: number): CallStreamPlaybackHandle {
  let audioEl: HTMLAudioElement | null = null;
  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  let objectUrl: string | null = null;
  let mediaElementSource: MediaElementAudioSourceNode | null = null;
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;

  let streamEnded = false;
  let stopped = false;
  let playbackStarted = false;
  let endOfStreamSent = false;
  let appendedAny = false;

  const collector = new SeqChunkCollector();
  const appendQueue = new AppendQueue();
  let endResolve: (() => void) | null = null;
  let endPromise: Promise<void> | null = null;

  const clampedGain = Math.max(0.5, Math.min(3, gain));

  const finishPlayback = () => {
    releaseSpeechPlayback(stop);
    endResolve?.();
    endResolve = null;
  };

  const tryEndOfStream = () => {
    if (
      stopped ||
      endOfStreamSent ||
      !mediaSource ||
      mediaSource.readyState !== 'open' ||
      !sourceBuffer
    ) {
      return;
    }
    if (!appendQueue.shouldEndStream(sourceBuffer.updating, collector.hasSeqGap())) {
      return;
    }
    try {
      mediaSource.endOfStream();
      endOfStreamSent = true;
    } catch {
      // already ended or invalid state
      endOfStreamSent = true;
    }
    if (!appendedAny) {
      finishPlayback();
    }
  };

  const tryStartPlayback = async () => {
    if (stopped || playbackStarted || !audioEl) return;
    playbackStarted = true;
    if (audioCtx?.state === 'suspended') {
      await audioCtx.resume();
    }
    try {
      await audioEl.play();
    } catch {
      playbackStarted = false;
    }
  };

  const flushAppendQueue = () => {
    if (stopped || !sourceBuffer) return;

    const didAppend = appendQueue.flush(sourceBuffer.updating, (chunk) => {
      appendedAny = true;
      try {
        sourceBuffer!.appendBuffer(new Uint8Array(chunk));
      } catch (err) {
        console.warn('[call-stream-playback] appendBuffer failed', err);
      }
    });

    if (!didAppend) {
      tryEndOfStream();
    }
  };

  const onSourceBufferUpdateEnd = () => {
    if (stopped) return;
    if (appendedAny && !playbackStarted) {
      void tryStartPlayback();
    }
    flushAppendQueue();
  };

  const drainIncoming = () => {
    const ready = collector.drainOrdered();
    if (ready.length > 0) {
      appendQueue.push(...ready);
    }
    flushAppendQueue();
    if (streamEnded && !appendedAny && !collector.hasSeqGap() && appendQueue.isEmpty) {
      tryEndOfStream();
    }
  };

  const teardownMedia = () => {
    if (sourceBuffer) {
      try {
        sourceBuffer.removeEventListener('updateend', onSourceBufferUpdateEnd);
      } catch {
        // ignore
      }
      sourceBuffer = null;
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
      audioEl.remove();
      audioEl = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    mediaSource = null;
    if (mediaElementSource) {
      try {
        mediaElementSource.disconnect();
      } catch {
        // ignore
      }
      mediaElementSource = null;
    }
    if (audioCtx) {
      try {
        void audioCtx.close();
      } catch {
        // ignore
      }
      audioCtx = null;
    }
    gainNode = null;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    collector.clear();
    appendQueue.clear();
    teardownMedia();
    endResolve?.();
    endResolve = null;
    releaseSpeechPlayback(stop);
  };

  const initMse = () => {
    audioEl = document.createElement('audio');
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = clampedGain;
    mediaElementSource = audioCtx.createMediaElementSource(audioEl);
    mediaElementSource.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    audioEl.src = objectUrl;

    audioEl.addEventListener('ended', () => {
      if (stopped) return;
      finishPlayback();
    });

    mediaSource.addEventListener(
      'sourceopen',
      () => {
        if (stopped || !mediaSource) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(MSE_MP3_MIME);
          sourceBuffer.mode = 'sequence';
          sourceBuffer.addEventListener('updateend', onSourceBufferUpdateEnd);
          drainIncoming();
        } catch (err) {
          console.warn('[call-stream-playback] MSE SourceBuffer init failed', err);
          stop();
        }
      },
      { once: true },
    );
  };

  return {
    startRound() {
      stopped = false;
      streamEnded = false;
      playbackStarted = false;
      endOfStreamSent = false;
      appendedAny = false;
      collector.reset();
      appendQueue.reset();
      endPromise = new Promise<void>((resolve) => {
        endResolve = resolve;
      });
      claimSpeechPlayback(stop);
      initMse();
    },

    enqueue(seq, audio) {
      if (stopped) return;
      collector.add(seq, audio);
      drainIncoming();
    },

    markStreamEnd() {
      if (stopped) return;
      streamEnded = true;
      appendQueue.markStreamEnded();
      drainIncoming();
    },

    stop,

    waitForPlaybackEnd() {
      return endPromise ?? Promise.resolve();
    },
  };
}

export function createCallStreamPlayback(gain: number): CallStreamPlaybackHandle {
  if (isMsePlaybackSupported()) {
    return createMseCallStreamPlayback(gain);
  }
  return createFallbackCallStreamPlayback(gain);
}
