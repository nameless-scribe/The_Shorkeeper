import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCallStreamPlayback,
  type CallStreamPlaybackHandle,
} from '../voice/call-stream-playback';
import { stopAllSpeechPlayback } from '../voice/speech-playback-coordinator';

export function useCallStreamPlayback() {
  const playbackRef = useRef<CallStreamPlaybackHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(false);
    setLoading(false);
  }, []);

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  const reset = useCallback(() => {
    stopAllSpeechPlayback();
    stop();
    setError(null);
  }, [stop]);

  const startRound = useCallback(async () => {
    reset();
    try {
      const settings = await window.shorekeeper.voice.getSettings();
      const handle = createCallStreamPlayback(settings.ttsPlaybackGain ?? 2);
      playbackRef.current = handle;
      handle.startRound();
      setLoading(true);
      setPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法初始化播放');
    }
  }, [reset]);

  const enqueue = useCallback((seq: number, audio: ArrayBuffer) => {
    const handle = playbackRef.current;
    if (!handle) return;
    setLoading(false);
    setPlaying(true);
    handle.enqueue(seq, audio);
  }, []);

  const markStreamEnd = useCallback(async (): Promise<boolean> => {
    const handle = playbackRef.current;
    if (!handle) return false;
    handle.markStreamEnd();
    await handle.waitForPlaybackEnd();
    playbackRef.current = null;
    setPlaying(false);
    setLoading(false);
    return true;
  }, []);

  return {
    playing,
    loading,
    error,
    reset,
    startRound,
    enqueue,
    markStreamEnd,
    stop,
  };
}
