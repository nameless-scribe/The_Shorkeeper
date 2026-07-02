import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttLanguage } from '@/shared/types';
import { startPcmRecording, type PcmRecorder } from '../voice/record-pcm';

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

interface UseVoiceInputResult {
  status: VoiceInputStatus;
  error: string | null;
  /** RMS input level 0–1 while recording (for a mic meter). */
  level: number;
  /** Begin capture. No-op if already recording/transcribing. */
  start: () => Promise<void>;
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

  const teardown = useCallback(() => {
    clearLevelTimer();
    recorderRef.current = null;
  }, [clearLevelTimer]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      recorderRef.current?.cancel();
      teardown();
    },
    [teardown],
  );

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    setError(null);

    let recorder: PcmRecorder;
    try {
      recorder = await startPcmRecording();
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : '无法访问麦克风');
      setStatus('idle');
      return;
    }

    // A newer start/cancel happened while awaiting mic permission.
    if (generation !== generationRef.current) {
      recorder.cancel();
      return;
    }

    recorderRef.current = recorder;
    setStatus('recording');
    levelTimerRef.current = setInterval(() => {
      setLevel(recorder.level);
    }, 100);
  }, []);

  const stopAndTranscribe = useCallback(
    async (lang?: SttLanguage): Promise<string> => {
      const recorder = recorderRef.current;
      if (!recorder) return '';

      const generation = generationRef.current;
      clearLevelTimer();
      recorderRef.current = null;
      setStatus('transcribing');

      let pcm: ArrayBuffer;
      let sampleRate: number;
      try {
        ({ pcm, sampleRate } = await recorder.stop());
      } catch (err) {
        if (generation === generationRef.current) {
          setError(err instanceof Error ? err.message : '录音失败');
          setStatus('idle');
        }
        return '';
      }

      if (pcm.byteLength === 0) {
        if (generation === generationRef.current) setStatus('idle');
        return '';
      }

      try {
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
    [clearLevelTimer],
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
    recorderRef.current?.cancel();
    teardown();
    setStatus('idle');
  }, [teardown]);

  return { status, error, level, start, stopAndTranscribe, cancel };
}
