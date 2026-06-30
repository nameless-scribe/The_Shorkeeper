import { useEffect, useState, type MouseEvent } from 'react';
import type { WorkspaceAttachment } from '@/shared/types';
import { fileTypeVisual, formatFileSize } from './file-attachment-utils';

interface FileAttachmentCardProps {
  file: WorkspaceAttachment;
  align?: 'left' | 'right';
}

export function FileAttachmentCard({ file, align = 'left' }: FileAttachmentCardProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayFile, setDisplayFile] = useState(file);
  const visual = fileTypeVisual(displayFile.originalName);

  useEffect(() => {
    setDisplayFile(file);
    if (file.size > 0) return;
    void window.shorekeeper.workspace.getFileInfo(file.relativePath).then((info) => {
      if (info) setDisplayFile(info);
    });
  }, [file.relativePath, file.size, file.originalName]);

  const openFile = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const result = await window.shorekeeper.workspace.openRelative(displayFile.relativePath);
      if (!result.ok) {
        setError(
          result.error?.includes('No handler registered')
            ? '请完全重启应用（Ctrl+C 后重新 pnpm dev）以加载文件打开功能'
            : (result.error ?? '无法打开文件'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('No handler registered')
          ? '请完全重启应用（Ctrl+C 后重新 pnpm dev）以加载文件打开功能'
          : '无法打开文件',
      );
    } finally {
      setOpening(false);
    }
  };

  const revealInFolder = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await window.shorekeeper.workspace.showRelative(displayFile.relativePath);
    } catch {
      setError('请完全重启应用后再试');
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        onClick={() => void openFile()}
        disabled={opening}
        title="点击用系统默认程序打开"
        className={`keeper-dialog-btn group flex w-full max-w-[280px] items-center gap-2.5 rounded-xl border border-keeper-silver/20 bg-keeper-navy/55 px-2.5 py-2 text-left shadow-sm backdrop-blur-sm transition hover:border-keeper-cyan/40 hover:bg-keeper-navy/75 disabled:opacity-60 ${
          align === 'right' ? 'flex-row-reverse text-right' : ''
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm ${visual.accent}`}
        >
          {visual.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-keeper-ice">{displayFile.originalName}</p>
          <p className="mt-0.5 text-[10px] text-keeper-ice/45">
            {opening ? '打开中…' : formatFileSize(displayFile.size)}
          </p>
        </div>
        <span className="shrink-0 text-keeper-cyan/50 transition group-hover:text-keeper-cyan" aria-hidden>
          ↗
        </span>
      </button>
      <button
        type="button"
        onClick={revealInFolder}
        className={`keeper-dialog-btn text-[10px] text-keeper-ice/35 transition hover:text-keeper-cyan/80 ${
          align === 'right' ? 'pr-1' : 'pl-1'
        }`}
      >
        在文件夹中显示
      </button>
      {error && (
        <p className={`max-w-[300px] text-[10px] leading-relaxed text-red-300/90 ${align === 'right' ? 'text-right' : ''}`}>
          {error}
        </p>
      )}
    </div>
  );
}
