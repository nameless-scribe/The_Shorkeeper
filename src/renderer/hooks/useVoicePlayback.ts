import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { streamSpeechPlayback } from '../voice/stream-speech-playback';
import {
  claimSpeechPlayback,
  releaseSpeechPlayback,
  stopAllSpeechPlayback,
} from '../voice/speech-playback-coordinator';

function abortPlaybackAttempt(
  generation: number,
  generationRef: MutableRefObject<number>,
  inFlightRef: MutableRefObject<string | null>,
  messageId: string,
  resetUi: () => void,
) {
  if (generation !== generationRef.current) return;
  if (inFlightRef.current === messageId) {
    inFlightRef.current = null;
  }
  resetUi();
}

export function useVoicePlayback() {
  const playbackRef = useRef<{ stop: () => void } | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const playingIdRef = useRef<string | null>(null);
  const loadingIdRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncPlayingId = useCallback((next: string | null) => {
    playingIdRef.current = next;
    setPlayingId(next);
  }, []);

  const syncLoadingId = useCallback((next: string | null) => {
    loadingIdRef.current = next;
    setLoadingId(next);
  }, []);

  const stopPlaybackOnly = useCallback(() => {
    if (playbackRef.current) {
      releaseSpeechPlayback(playbackRef.current.stop);
    }
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  const invalidatePlayback = useCallback(() => {
    generationRef.current += 1;
    stopPlaybackOnly();
  }, [stopPlaybackOnly]);

  useEffect(
    () => () => {
      invalidatePlayback();
    },
    [invalidatePlayback],
  );

  const stop = useCallback(() => {
    invalidatePlayback();
    inFlightRef.current = null;
    syncPlayingId(null);
    syncLoadingId(null);
  }, [invalidatePlayback, syncLoadingId, syncPlayingId]);

  const remapPlayingId = useCallback(
    (from: string, to: string) => {
      syncPlayingId(playingIdRef.current === from ? to : playingIdRef.current);
      syncLoadingId(loadingIdRef.current === from ? to : loadingIdRef.current);
    },
    [syncLoadingId, syncPlayingId],
  );

  const playText = useCallback(
    async (messageId: string, text: string) => {
      if (inFlightRef.current === messageId) {
        return;
      }

      inFlightRef.current = messageId;
      stopAllSpeechPlayback();
      invalidatePlayback();
      const generation = generationRef.current;

      setError(null);
      syncLoadingId(messageId);
      syncPlayingId(null);

      const resetUi = () => {
        syncPlayingId(null);
        syncLoadingId(null);
      };

      try {
        const settings = await window.shorekeeper.voice.getSettings();
        if (generation !== generationRef.current) {
          abortPlaybackAttempt(generation, generationRef, inFlightRef, messageId, resetUi);
          return;
        }

        const gain = settings.ttsPlaybackGain ?? 2;

        const handle = await streamSpeechPlayback(text, settings.ttsMaxChars, gain, {
          onLoading: () => {
            if (generation !== generationRef.current) return;
            syncLoadingId(messageId);
            syncPlayingId(null);
          },
          onPlaying: () => {
            if (generation !== generationRef.current) return;
            syncLoadingId(null);
            syncPlayingId(messageId);
          },
          onFinished: () => {
            if (generation !== generationRef.current) return;
            releaseSpeechPlayback(handle.stop);
            playbackRef.current = null;
            inFlightRef.current = null;
            resetUi();
          },
          onError: (message) => {
            if (generation !== generationRef.current) return;
            setError(message);
            stop();
          },
        });

        if (generation !== generationRef.current) {
          handle.stop();
          abortPlaybackAttempt(generation, generationRef, inFlightRef, messageId, resetUi);
          return;
        }

        playbackRef.current = handle;
        claimSpeechPlayback(handle.stop);
        inFlightRef.current = null;
      } catch (err) {
        if (generation !== generationRef.current) return;
        setError(err instanceof Error ? err.message : '朗读失败');
        stop();
      }
    },
    [invalidatePlayback, stop, syncLoadingId, syncPlayingId],
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
