import { useState, type FormEvent, type KeyboardEvent } from 'react';

interface InputBarProps {
  disabled?: boolean;
  onSend: (text: string) => void;
}

export function InputBar({ disabled, onSend }: InputBarProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="border-t border-white/10 p-3 no-drag">
      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-black/20 p-2 backdrop-blur-md">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="输入消息，Enter 发送…"
          className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-white placeholder:text-white/35 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="rounded-xl bg-shore-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-shore-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </form>
  );
}
