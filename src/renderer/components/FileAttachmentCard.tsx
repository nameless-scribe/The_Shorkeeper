import { useState, type MouseEvent } from 'react';
import type { WorkspaceAttachment } from '@/shared/types';
import { fileTypeVisual, formatFileSize } from './file-attachment-utils';

interface FileAttachmentCardProps {
  file: WorkspaceAttachment;
  align?: 'left' | 'right';
}

export function FileAttachmentCard({ file, align = 'left' }: FileAttachmentCardProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visual = fileTypeVisual(file.originalName);
  const isLetterIcon = visual.icon.length === 1;

  const openFile = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const result = await window.shorekeeper.workspace.openRelative(file.relativePath);
      if (!result.ok) {
        setError(result.error ?? '无法打开文件');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开文件');
    } finally {
      setOpening(false);
    }
  };

  const revealInFolder = async (e: MouseEvent) => {
    e.stopPropagation();
    await window.shorekeeper.workspace.showRelative(file.relativePath);
  };

  return (
    <div className={`flex flex-col gap-0.5 ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        onClick={() => void openFile()}
        disabled={opening}
        title="点击打开文件"
        className={`group flex max-w-[280px] items-center gap-3 rounded-xl border border-keeper-silver/15 bg-white/95 px-3 py-2.5 text-left shadow-sm transition hover:border-keeper-cyan/35 hover:shadow-md disabled:opacity-60 ${
          align === 'right' ? 'flex-row-reverse text-right' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{file.originalName}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{formatFileSize(file.size)}</p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm ${visual.accent}`}
        >
          {isLetterIcon ? visual.icon : <span className="text-base">{visual.icon}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={revealInFolder}
        className={`text-[10px] text-keeper-ice/40 transition hover:text-keeper-cyan ${
          align === 'right' ? 'pr-1' : 'pl-1'
        }`}
      >
        在文件夹中显示
      </button>
      {error && (
        <p className={`text-[10px] text-red-300/90 ${align === 'right' ? 'text-right' : ''}`}>{error}</p>
      )}
    </div>
  );
}
