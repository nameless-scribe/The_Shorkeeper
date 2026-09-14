import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttLanguage } from '@/shared/types';
import { STT_FRAME_BYTES } from '@/voice/types';
import { startPcmRecording, type PcmRecorder } from '../voice/record-pcm';
import { splitPcmFrames, type PcmBytes } from '../voice/pcm-frames';

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

interface UseVoiceInputResult {
  status: VoiceInputStatus;
  error: string | null;
  /** RMS input level 0–1 while recording (for a mic meter). */
  level: number;
  /** Begin capture. Pass callId to use streaming STT during a voice call. */
  start: (callId?: string) => Promise<void>;
  /** Stop capture, transcribe, and return the recognized text ('' if empty). */
  stopAndTranscribe: (lang?: SttLanguage) => Promise<string>;
  /** Abort capture without transcribing. */
  cancel: () => void;
}

/**
 * Push-to-talk microphone input: records 16 kHz PCM, sends it to the main
 * process for Paraformer transcription, and returns the text. Mirrors the
 * generation-guard + unmount-cleanup conventions of useVoicePlayback.
 */
export function useVoiceInput(): UseVoiceInputResult {
  const recorderRef = useRef<PcmRecorder | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pcmBufferRef = useRef<PcmBytes>(new Uint8Array(0));
  const pushQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pushFailedRef = useRef(false);
  const generationRef = useRef(0);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const clearLevelTimer = useCallback(() => {
    if (levelTimerRef.current !== null) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    setLevel(0);
  }, []);

  const flushPcmBuffer = useCallback(async (callId: string) => {
    const pending = pcmBufferRef.current;
    if (pending.byteLength === 0) return;
    pcmBufferRef.current = new Uint8Array(0);
    const result = await window.shorekeeper.voice.stt.pushChunk({
      callId,
      chunk: pending.slice().buffer,
    });
    if (!result.ok) throw new Error(result.error);
  }, []);

  const pushPcmFrame = useCallback(
    async (callId: string, pcm: ArrayBuffer) => {
      const { frames, remainder } = splitPcmFrames(pcmBufferRef.current, new Uint8Array(pcm), STT_FRAME_BYTES);
      // 先把余数落回缓冲：即使某一帧发送失败抛出，已切出的帧也不会被重复发送。
      pcmBufferRef.current = remainder;
      for (const frame of frames) {
        const result = await window.shorekeeper.voice.stt.pushChunk({
          callId,
          chunk: frame.buffer,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
      }
    },
    [],
  );

  const enqueuePcmFrame = useCallback((callId: string, pcm: ArrayBuffer) => {
    if (pushFailedRef.current) return;
    const generation = generationRef.current;
    const queued = pushQueueRef.current
      .then(async () => {
        if (generation !== generationRef.current || pushFailedRef.current) return;
        await pushPcmFrame(callId, pcm);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        pushFailedRef.current = true;
        setError(err instanceof Error ? err.message : '语音识别流发送失败');
        void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      });
    pushQueueRef.current = queued;
  }, [pushPcmFrame]);

  const teardown = useCallback(() => {
    clearLevelTimer();
    recorderRef.current = null;
    callIdRef.current = null;
    pcmBufferRef.current = new Uint8Array(0);
  }, [clearLevelTimer]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      const callId = callIdRef.current;
      if (callId) {
        void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      recorderRef.current?.cancel();
      teardown();
    },
    [teardown],
  );

  const start = useCallback(async (callId?: string) => {
    if (recorderRef.current) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    setError(null);
    pcmBufferRef.current = new Uint8Array(0);
    pushQueueRef.current = Promise.resolve();
    pushFailedRef.current = false;
    callIdRef.current = callId ?? null;

    if (callId) {
      let streamResult: Awaited<ReturnType<typeof window.shorekeeper.voice.stt.startCallStream>>;
      try {
        streamResult = await window.shorekeeper.voice.stt.startCallStream({ callId });
      } catch (err) {
        if (generation === generationRef.current) {
          setError(err instanceof Error ? err.message : '语音识别流启动失败');
          callIdRef.current = null;
          setStatus('idle');
        }
        return;
      }
      if (generation !== generationRef.current) return;
      if (!streamResult.ok) {
        setError(streamResult.error);
        callIdRef.current = null;
        setStatus('idle');
        return;
      }
    }

    let recorder: PcmRecorder;
    try {
      recorder = await startPcmRecording({
        retainAudio: !callId,
        onError: (message) => {
          if (generation !== generationRef.current) return;
          recorderRef.current = null;
          clearLevelTimer();
          setError(message);
          setStatus('idle');
        },
        onPcmFrame: callId
          ? (pcm) => {
              enqueuePcmFrame(callId, pcm);
            }
          : undefined,
      });
    } catch (err) {
      if (generation !== generationRef.current) return;
      if (callId) {
        await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      setError(err instanceof Error ? err.message : '无法访问麦克风');
      callIdRef.current = null;
      setStatus('idle');
      return;
    }

    if (generation !== generationRef.current) {
      recorder.cancel();
      if (callId) {
        await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      return;
    }

    recorderRef.current = recorder;
    setStatus('recording');
    levelTimerRef.current = setInterval(() => {
      setLevel(recorder.level);
    }, 100);
  }, [clearLevelTimer, enqueuePcmFrame]);

  const stopAndTranscribe = useCallback(
    async (lang?: SttLanguage): Promise<string> => {
      const recorder = recorderRef.current;
      if (!recorder) return '';

      const generation = generationRef.current;
      const callId = callIdRef.current;
      clearLevelTimer();
      recorderRef.current = null;
      callIdRef.current = null;
      setStatus('transcribing');

      try {
        if (callId) {
          await recorder.stop();
          if (generation !== generationRef.current) return '';
          await pushQueueRef.current;
          if (generation !== generationRef.current) return '';
          if (pushFailedRef.current) {
            setStatus('idle');
            return '';
          }
          await flushPcmBuffer(callId);
          const result = await window.shorekeeper.voice.stt.finishCallStream({ callId });
          pcmBufferRef.current = new Uint8Array(0);
          if (generation !== generationRef.current) return '';
          setStatus('idle');
          if (!result.ok) {
            setError(result.error);
            return '';
          }
          return result.text;
        }

        const { pcm, sampleRate } = await recorder.stop();
        if (pcm.byteLength === 0) {
          if (generation === generationRef.current) setStatus('idle');
          return '';
        }

        const result = await window.shorekeeper.voice.transcribe({ audio: pcm, sampleRate, lang });
        if (generation !== generationRef.current) return '';
        setStatus('idle');
        if (!result.ok) {
          setError(result.error);
          return '';
        }
        return result.text;
      } catch (err) {
        if (callId) {
          await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
        }
        if (generation === generationRef.current) {
          setError(err instanceof Error ? err.message : '语音识别失败');
          setStatus('idle');
        }
        return '';
      }
    },
    [clearLevelTimer, flushPcmBuffer],
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const callId = callIdRef.current;
    recorderRef.current?.cancel();
    if (callId) {
      void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
    }
    teardown();
    setStatus('idle');
  }, [teardown]);

  return { status, error, level, start, stopAndTranscribe, cancel };
}
