import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { UserQuestionRequestPayload, UserQuestionResponse } from '@/shared/types';

interface QuestionDialogProps {
  request: UserQuestionRequestPayload | null;
  onRespond: (response: Omit<UserQuestionResponse, 'requestId'>) => void;
}

const dialogButtonClass =
  'outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-keeper-cyan/45';

/**
 * ask_user 的弹窗（P6.1）。选项是按钮，点一下即回答；自由文本走输入框，Enter 提交；
 * Esc、背景与右上角 ✕ 都是"稍后再答"——工具收到 abort，运行停在这一步。
 * 与 PermissionDialog 共用门户、层级与键盘约定，由 usePromptRequests 保证不会同时弹两个。
 */
export function QuestionDialog({ request, onRespond }: QuestionDialogProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText('');
    if (!request) return;
    // 有选项时焦点给第一个选项（键盘可直接 Tab/Enter）；只有输入框时直接聚焦输入框
    if (!request.options.length) inputRef.current?.focus();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape') onRespond({ dismissed: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, onRespond]);

  if (!request) return null;

  const trimmed = text.trim();
  const submitText = () => {
    if (!trimmed) return;
    onRespond({ answer: trimmed });
  };

  return createPortal(
    <div className="no-drag fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="稍后再答"
        className="absolute inset-0 bg-keeper-navyDeep/88 backdrop-blur-md"
        onClick={() => onRespond({ dismissed: true })}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-dialog-title"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-keeper-cyan/30 bg-keeper-navyDeep shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
      >
        <header className="flex items-start gap-3 border-b border-keeper-cyan/15 bg-keeper-navy/25 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-keeper-cyan/15 text-xl">
            ?
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-keeper-ice/45">
              守岸人需要你确认一件事
            </p>
            <h2
              id="question-dialog-title"
              className="mt-0.5 whitespace-pre-wrap break-words text-base font-semibold leading-snug text-keeper-ice"
            >
              {request.question}
            </h2>
            {request.why ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-keeper-ice/60">
                {request.why}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRespond({ dismissed: true })}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-keeper-silver/20 text-keeper-ice/50 transition hover:border-keeper-cyan/35 hover:bg-keeper-cyan/10 hover:text-keeper-cyan ${dialogButtonClass}`}
            title="稍后再答"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[min(52vh,420px)] overflow-y-auto px-5 py-4">
          {request.options.length ? (
            <ul className="space-y-2" aria-label="选项">
              {request.options.map((option, index) => (
                <li key={option.id}>
                  <button
                    type="button"
                    autoFocus={index === 0}
                    onClick={() => onRespond({ optionId: option.id })}
                    className={`flex w-full flex-col items-start rounded-xl border border-keeper-cyan/20 bg-keeper-navy/40 px-4 py-2.5 text-left transition hover:border-keeper-cyan/50 hover:bg-keeper-cyan/10 ${dialogButtonClass}`}
                  >
                    <span className="text-sm text-keeper-ice">{option.label}</span>
                    {option.hint ? (
                      <span className="mt-0.5 text-xs text-keeper-ice/55">{option.hint}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {request.allowFreeText ? (
            <div className={request.options.length ? 'mt-4' : ''}>
              <label className="mb-1.5 block text-xs text-keeper-ice/55" htmlFor="question-dialog-input">
                {request.options.length ? '其他（自己填）' : '你的回答'}
              </label>
              <textarea
                id="question-dialog-input"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitText();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="输入后按 Enter 提交，Shift+Enter 换行"
                className={`w-full resize-none rounded-xl border border-keeper-cyan/20 bg-keeper-navy/40 px-3 py-2 text-sm text-keeper-ice placeholder:text-keeper-ice/30 focus:border-keeper-cyan/50 ${dialogButtonClass}`}
              />
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-keeper-cyan/15 bg-keeper-navy/25 px-5 py-4">
          <p className="text-[11px] text-keeper-ice/40">Esc 稍后再答，运行会停在这一步</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRespond({ dismissed: true })}
              className={`rounded-xl border border-keeper-silver/25 bg-keeper-navyDeep px-4 py-2.5 text-sm text-keeper-ice/75 transition hover:border-keeper-ice/35 hover:bg-white/5 hover:text-keeper-ice ${dialogButtonClass}`}
            >
              稍后再答
            </button>
            {request.allowFreeText ? (
              <button
                type="button"
                onClick={submitText}
                disabled={!trimmed}
                className={`rounded-xl bg-keeper-cyan px-5 py-2.5 text-sm font-semibold text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim disabled:cursor-not-allowed disabled:opacity-40 ${dialogButtonClass}`}
              >
                回答
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
