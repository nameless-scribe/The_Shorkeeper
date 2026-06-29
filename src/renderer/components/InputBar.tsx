import { useCallback, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { WorkspaceAttachment } from '@/shared/types';

interface InputBarProps {
  disabled?: boolean;
  onSend: (text: string, attachments: WorkspaceAttachment[]) => void;
}

export function InputBar({ disabled, onSend }: InputBarProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const addAttachments = useCallback((items: WorkspaceAttachment[]) => {
    if (!items.length) return;
    setAttachments((prev) => [...prev, ...items]);
    setImportError(null);
  }, []);

  const submit = () => {
    const value = text.trim();
    if ((!value && !attachments.length) || disabled) return;
    onSend(value, attachments);
    setText('');
    setAttachments([]);
    setImportError(null);
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
              📎 {file.originalName}
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

      {importError && (
        <p className="mb-2 text-[10px] text-red-300/90">{importError}</p>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-keeper-silver/20 bg-keeper-navyDeep/50 p-2">
        <button
          type="button"
          disabled={disabled}
          onClick={handlePickFile}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan disabled:opacity-40"
          title="上传文件到工作区"
        >
          📎
        </button>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="输入消息，Enter 发送；可拖入文本文件…"
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
