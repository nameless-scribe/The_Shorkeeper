import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import type { PermissionRequestPayload } from '@/shared/types';
import { toolDisplayName } from './tool-labels';

function truncate(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`;
}

function formatFallbackArgs(args: unknown): string {
  if (args == null) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ArgPreview({ args }: { args: unknown }) {
  if (!isRecord(args)) {
    return (
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
        {formatFallbackArgs(args)}
      </pre>
    );
  }

  const path = typeof args.path === 'string' ? args.path : null;
  const content = typeof args.content === 'string' ? args.content : null;

  if (path || content) {
    return (
      <div className="space-y-3">
        {path && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
              目标路径
            </div>
            <div className="rounded-xl border border-keeper-cyan/25 bg-keeper-cyan/10 px-3 py-2.5 font-mono text-sm text-keeper-cyan">
              {path}
            </div>
          </div>
        )}
        {content && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
              内容预览
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
              {truncate(content)}
            </pre>
          </div>
        )}
        {Object.keys(args).filter((k) => k !== 'path' && k !== 'content').length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
              其他参数
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/60">
              {formatFallbackArgs(
                Object.fromEntries(
                  Object.entries(args).filter(([k]) => k !== 'path' && k !== 'content'),
                ),
              )}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
      {formatFallbackArgs(args)}
    </pre>
  );
}

interface PermissionDialogProps {
  request: PermissionRequestPayload | null;
  onRespond: (approved: boolean) => void;
}

const dialogButtonClass =
  'outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-keeper-cyan/45';

export function PermissionDialog({ request, onRespond }: PermissionDialogProps) {
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRespond(false);
      if (e.key === 'Enter') onRespond(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, onRespond]);

  if (!request) return null;

  const label = toolDisplayName(request.toolName);

  return createPortal(
    <div className="no-drag fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-[#050a18]/88 backdrop-blur-md"
        onClick={() => onRespond(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-keeper-cyan/30 bg-[#0d1630] shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
      >
        <header className="flex items-center gap-3 border-b border-keeper-cyan/15 bg-[#111d3a] px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-xl">
            🔐
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="permission-dialog-title" className="text-base font-semibold text-keeper-ice">
              允许执行：{label}？
            </h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-keeper-ice/40">
              {request.toolName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRespond(false)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-keeper-silver/20 text-keeper-ice/50 transition hover:border-keeper-cyan/35 hover:bg-keeper-cyan/10 hover:text-keeper-cyan ${dialogButtonClass}`}
            title="拒绝"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[min(52vh,420px)] overflow-y-auto px-5 py-4">
          <ArgPreview args={request.args} />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-keeper-cyan/15 bg-[#111d3a] px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond(false)}
            className={`rounded-xl border border-keeper-silver/25 bg-[#0d1630] px-4 py-2.5 text-sm text-keeper-ice/75 transition hover:border-keeper-ice/35 hover:bg-white/5 hover:text-keeper-ice ${dialogButtonClass}`}
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onRespond(true)}
            className={`rounded-xl bg-keeper-cyan px-5 py-2.5 text-sm font-semibold text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim ${dialogButtonClass}`}
          >
            允许
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
