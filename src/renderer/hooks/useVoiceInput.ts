import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttLanguage } from '@/shared/types';
import { STT_FRAME_BYTES } from '@/voice/types';
import { startPcmRecording, type PcmRecorder } from '../voice/record-pcm';

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
  const pcmBufferRef = useRef<Uint8Array>(new Uint8Array(0));
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
    await window.shorekeeper.voice.stt.pushChunk({
      callId,
      chunk: pending.slice().buffer,
    });
  }, []);

  const pushPcmFrame = useCallback(
    async (callId: string, pcm: ArrayBuffer) => {
      const incoming = new Uint8Array(pcm);
      const merged = new Uint8Array(pcmBufferRef.current.byteLength + incoming.byteLength);
      merged.set(pcmBufferRef.current, 0);
      merged.set(incoming, pcmBufferRef.current.byteLength);
      pcmBufferRef.current = merged;

      while (pcmBufferRef.current.byteLength >= STT_FRAME_BYTES) {
        const frame = pcmBufferRef.current.slice(0, STT_FRAME_BYTES);
        pcmBufferRef.current = pcmBufferRef.current.slice(STT_FRAME_BYTES);
        const result = await window.shorekeeper.voice.stt.pushChunk({
          callId,
          chunk: frame.buffer,
        });
        if (!result.ok) {
          setError(result.error);
          break;
        }
      }
    },
    [],
  );

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
    callIdRef.current = callId ?? null;

    if (callId) {
      const streamResult = await window.shorekeeper.voice.stt.startCallStream({ callId });
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
        onPcmFrame: callId
          ? (pcm) => {
              void pushPcmFrame(callId, pcm);
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
  }, [pushPcmFrame]);

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
