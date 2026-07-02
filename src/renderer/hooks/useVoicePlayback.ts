import { useCallback, useEffect, useRef, useState } from 'react';
import { streamSpeechPlayback } from '../voice/stream-speech-playback';

export function useVoicePlayback() {
  const playbackRef = useRef<{ stop: () => void } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setPlayingId(null);
    setLoadingId(null);
  }, [cleanup]);

  const remapPlayingId = useCallback((from: string, to: string) => {
    setPlayingId((id) => (id === from ? to : id));
    setLoadingId((id) => (id === from ? to : id));
  }, []);

  const playText = useCallback(
    async (messageId: string, text: string) => {
      if (playingId === messageId || loadingId === messageId) {
        stop();
        return;
      }

      cleanup();
      setError(null);
      setLoadingId(messageId);
      setPlayingId(null);

      try {
        const settings = await window.shorekeeper.voice.getSettings();
        const gain = settings.ttsPlaybackGain ?? 2;

        const handle = await streamSpeechPlayback(text, settings.ttsMaxChars, gain, {
          onLoading: () => {
            setLoadingId(messageId);
            setPlayingId(null);
          },
          onPlaying: () => {
            setLoadingId(null);
            setPlayingId(messageId);
          },
          onFinished: () => {
            playbackRef.current = null;
            setPlayingId(null);
            setLoadingId(null);
          },
          onError: (message) => {
            setError(message);
            stop();
          },
        });

        playbackRef.current = handle;
      } catch (err) {
        setError(err instanceof Error ? err.message : '朗读失败');
        stop();
      }
    },
    [cleanup, loadingId, playingId, stop],
  );

  return {
    playText,
    stop,
    remapPlayingId,
    playingId,
    loadingId,
    error,
    isPlaying: (id: string) => playingId === id,
    isLoading: (id: string) => loadingId === id,
  };
}
