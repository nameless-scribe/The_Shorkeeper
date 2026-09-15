import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { WorkspaceAttachment } from '@/shared/types';
import { ModelQuickSwitcher } from './ModelQuickSwitcher';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { describeMicButton, levelToPercent, mergeTranscript, shouldAutoSend } from './voice-input-controls';

interface InputBarProps {
  disabled?: boolean;
  onSend: (text: string, attachments: WorkspaceAttachment[]) => void;
  onModelChange?: () => void;
  /** 外部预填的草稿（例如收件箱回链）：只填入输入框，不自动发送 */
  draft?: { text: string; nonce: number } | null;
  /** 变化时重新读取语音设置；设置抽屉关闭后由 ChatPage 递增 */
  voiceSettingsNonce?: number;
}

export function InputBar({ disabled, onSend, onModelChange, draft, voiceSettingsNonce }: InputBarProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [voice, setVoice] = useState({ sttEnabled: false, pushToTalk: true, sttAutoSend: false });
  const { status: voiceStatus, error: voiceError, level, start, stopAndTranscribe, cancel } = useVoiceInput();

  // 输入框正文的唯一写入口：ref 先落值再 setState，语音识别回调能同步读到最新草稿，
  // 也不必在 setState 的 updater 里做副作用（见 P3 计划 §9.6）。
  const textRef = useRef('');
  const applyText = useCallback((next: string | ((prev: string) => string)) => {
    const value = typeof next === 'function' ? next(textRef.current) : next;
    textRef.current = value;
    setText(value);
  }, []);

  useEffect(() => {
    if (!draft?.text) return;
    // 不覆盖用户已输入的内容：有草稿时追加到末尾。
    applyText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${draft.text}` : draft.text));
  }, [draft, applyText]);

  useEffect(() => {
    let cancelled = false;
    window.shorekeeper.voice
      .getSettings()
      .then((value) => {
        if (cancelled) return;
        setVoice({
          sttEnabled: value.sttEnabled,
          pushToTalk: value.pushToTalk,
          sttAutoSend: value.sttAutoSend,
        });
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [voiceSettingsNonce]);

  const addAttachments = useCallback((items: WorkspaceAttachment[]) => {
    if (!items.length) return;
    setAttachments((prev) => [...prev, ...items]);
    setImportError(null);
  }, []);

  const submitWith = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if ((!value && !attachments.length) || disabled) return;
      onSend(value, attachments);
      applyText('');
      setAttachments([]);
      setImportError(null);
    },
    [applyText, attachments, disabled, onSend],
  );

  const submit = () => submitWith(textRef.current);

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

  const handlePickFile = async () => {
    try {
      const result = await window.shorekeeper.workspace.pickAndImport();
      if (result) addAttachments([result]);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '导入失败');
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    try {
      const paths = [...e.dataTransfer.files].map((file) =>
        window.shorekeeper.workspace.getPathForFile(file),
      );
      const imported = await window.shorekeeper.workspace.importPaths(paths);
      addAttachments(imported);
      if (paths.length && !imported.length) {
        setImportError('未能导入所拖入的文件');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '导入失败');
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const mic = describeMicButton({
    sttEnabled: voice.sttEnabled,
    disabled: Boolean(disabled),
    pushToTalk: voice.pushToTalk,
    status: voiceStatus,
  });

  const beginRecording = useCallback(async () => {
    if (voiceStatus !== 'idle') return;
    setImportError(null);
    await start();
  }, [start, voiceStatus]);

  const finishRecording = useCallback(async () => {
    if (voiceStatus !== 'recording') return;
    // 识别失败时 stopAndTranscribe 返回空串并自行设置 error，这里按"没说话"处理，
    // 既不清空草稿也不发送。
    const transcript = await stopAndTranscribe();
    if (shouldAutoSend({ autoSend: voice.sttAutoSend, transcript, disabled: Boolean(disabled) })) {
      submitWith(mergeTranscript(textRef.current, transcript));
      return;
    }
    applyText((prev) => mergeTranscript(prev, transcript));
  }, [applyText, disabled, stopAndTranscribe, submitWith, voice.sttAutoSend, voiceStatus]);

  // InputBar 与应用同生命周期，不会卸载，useVoiceInput 的卸载清理在正常使用中不会触发，
  // 录音的结束完全依赖这里的显式调用。时长兜底已由 record-pcm 的 5 分钟硬上限负责
  // （到点 teardown 并报错），这里只补"人已经走了但录音还开着"：失焦或页面隐藏即取消。
  useEffect(() => {
    if (voiceStatus !== 'recording') return;
    const abort = () => cancel();
    const onVisibilityChange = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', abort);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', abort);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cancel, voiceStatus]);

  const toggleRecording = () => {
    if (voiceStatus === 'recording') void finishRecording();
    else void beginRecording();
  };

  // 按住说话：指针移出按钮或窗口失焦都按"取消"处理，避免麦克风一直开着。
  const pushToTalkHandlers = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      void beginRecording();
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      void finishRecording();
    },
    onPointerLeave: () => {
      if (voiceStatus === 'recording') cancel();
    },
  };

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="keeper-glass-panel shrink-0 border-t border-keeper-cyan/10 p-3 no-drag"
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((file, index) => (
            <span
              key={`${file.relativePath}-${index}`}
              className="inline-flex items-center gap-1 rounded-lg border border-keeper-cyan/25 bg-keeper-cyan/10 px-2 py-1 text-[10px] text-keeper-ice"
            >
              {file.kind === 'audio' ? '🎙' : file.kind === 'image' ? '🖼' : '📎'} {file.originalName}
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                className="text-keeper-ice/50 hover:text-red-300"
                title="移除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {(importError || voiceError) && (
        <p className="mb-2 text-[10px] text-red-300/90">{importError ?? voiceError}</p>
      )}

      {mic.recording && (
        <div className="mb-2 flex items-center gap-2" data-testid="voice-level">
          <span className="text-[10px] text-keeper-cyan">录音中…</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-keeper-navy">
            <div
              className="h-full rounded-full bg-keeper-cyan transition-[width] duration-100"
              style={{ width: `${levelToPercent(level)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-keeper-silver/20 bg-keeper-navyDeep/50 p-2">
        <button
          type="button"
          disabled={disabled}
          onClick={handlePickFile}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan disabled:opacity-40"
          title="上传文件到工作区（文本、Word、Excel 等）"
        >
          📎
        </button>

        <button
          type="button"
          data-testid="voice-input-button"
          disabled={!mic.enabled}
          title={mic.title}
          aria-label={mic.title}
          aria-pressed={mic.recording}
          {...(voice.pushToTalk && mic.enabled ? pushToTalkHandlers : { onClick: toggleRecording })}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40 ${
            mic.recording
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan'
          }`}
        >
          {mic.icon}
        </button>

        <ModelQuickSwitcher disabled={disabled} onModelChange={onModelChange} />

        <textarea
          value={text}
          onChange={(e) => applyText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="输入消息，Enter 发送；可拖入文本、Word、Excel 等文件…"
          className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-keeper-ice placeholder:text-keeper-ice/35 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || (!text.trim() && !attachments.length)}
          className="rounded-xl bg-keeper-cyan px-4 py-2 text-sm font-medium text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim hover:shadow-cyan disabled:cursor-not-allowed disabled:bg-keeper-navy disabled:text-keeper-ice/30 disabled:shadow-none"
        >
          发送
        </button>
      </div>
    </form>
  );
}
