interface MessageSpeechButtonProps {
  messageId: string;
  text: string;
  disabled?: boolean;
  playing: boolean;
  loading: boolean;
  onToggle: (messageId: string, text: string) => void;
}

export function MessageSpeechButton({
  messageId,
  text,
  disabled,
  playing,
  loading,
  onToggle,
}: MessageSpeechButtonProps) {
  const label = loading ? '合成中' : playing ? '停止' : '朗读';

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => onToggle(messageId, text)}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs transition ${
        playing
          ? 'border-keeper-cyan/40 bg-keeper-cyan/20 text-keeper-cyan'
          : 'border-keeper-silver/15 bg-keeper-silver/5 text-keeper-ice/50 hover:border-keeper-cyan/30 hover:text-keeper-cyan'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {loading ? (
        <span className="h-3 w-3 animate-spin rounded-full border border-keeper-cyan/30 border-t-keeper-cyan" />
      ) : (
        <span aria-hidden>{playing ? '⏹' : '🔊'}</span>
      )}
    </button>
  );
}
