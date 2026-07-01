import { useCallback, useEffect, useRef, useState } from 'react';

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function useVoicePlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setPlayingId(null);
    setLoadingId(null);
  }, [cleanup]);

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
        const result = await window.shorekeeper.voice.synthesize({ text });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        const buffer = toArrayBuffer(result.audio);
        const blob = new Blob([buffer], { type: result.mime || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          cleanup();
          setPlayingId(null);
        };
        audio.onerror = () => {
          setError('音频播放失败');
          stop();
        };

        setLoadingId(null);
        setPlayingId(messageId);
        await audio.play();
      } catch (err) {
        setError(err instanceof Error ? err.message : '朗读失败');
        stop();
      } finally {
        setLoadingId((id) => (id === messageId ? null : id));
      }
    },
    [cleanup, loadingId, playingId, stop],
  );

  return {
    playText,
    stop,
    playingId,
    loadingId,
    error,
    isPlaying: (id: string) => playingId === id,
    isLoading: (id: string) => loadingId === id,
  };
}
