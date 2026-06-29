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
    <form
      onSubmit={onSubmit}
      className="keeper-glass-panel shrink-0 border-t border-keeper-cyan/10 p-3 no-drag"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-keeper-silver/20 bg-keeper-navyDeep/50 p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="输入消息，Enter 发送…"
          className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-keeper-ice placeholder:text-keeper-ice/35 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="rounded-xl bg-keeper-cyan px-4 py-2 text-sm font-medium text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim hover:shadow-cyan disabled:cursor-not-allowed disabled:bg-keeper-navy disabled:text-keeper-ice/30 disabled:shadow-none"
        >
          发送
        </button>
      </div>
    </form>
  );
}
