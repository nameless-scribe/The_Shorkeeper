import { useEffect } from 'react';
import type { PermissionRequestPayload } from '@/shared/types';

const TOOL_LABELS: Record<string, string> = {
  write_file: '写入文件',
  gen_markdown: '生成 Markdown',
  convert_to_markdown: '转换为 Markdown',
  gen_docx: '生成 Word',
  gen_xlsx: '生成 Excel',
  gen_pdf: '生成 PDF',
  travel_plan: '生成旅行规划',
};

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
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/70">
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
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-keeper-ice/40">
              目标路径
            </div>
            <div className="rounded-xl border border-keeper-cyan/20 bg-keeper-cyan/8 px-3 py-2 font-mono text-xs text-keeper-cyan">
              {path}
            </div>
          </div>
        )}
        {content && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-keeper-ice/40">
              内容预览
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/70">
              {truncate(content)}
            </pre>
          </div>
        )}
        {Object.keys(args).filter((k) => k !== 'path' && k !== 'content').length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-keeper-ice/40">
              其他参数
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/60">
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
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/70">
      {formatFallbackArgs(args)}
    </pre>
  );
}

interface PermissionDialogProps {
  request: PermissionRequestPayload | null;
  onRespond: (approved: boolean) => void;
}

export function PermissionDialog({ request, onRespond }: PermissionDialogProps) {
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRespond(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, onRespond]);

  if (!request) return null;

  const label = TOOL_LABELS[request.toolName] ?? request.toolName;

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-keeper-navyDeep/80 backdrop-blur-sm"
        onClick={() => onRespond(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-keeper-cyan/25 bg-keeper-glass shadow-glass backdrop-blur-xl"
      >
        <header className="flex items-center gap-3 border-b border-keeper-cyan/12 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-keeper-cyan/12 text-lg">
            🔐
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="permission-dialog-title"
              className="text-base font-semibold text-keeper-ice"
            >
              工具权限确认
            </h2>
            <p className="mt-0.5 text-xs text-keeper-ice/45">Agent 请求执行以下操作</p>
          </div>
          <button
            type="button"
            onClick={() => onRespond(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-keeper-silver/15 text-keeper-ice/50 transition hover:border-keeper-cyan/30 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
            title="拒绝"
          >
            ✕
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-keeper-cyan/25 bg-keeper-cyan/10 px-2.5 py-1 text-xs font-medium text-keeper-cyan">
              {label}
            </span>
            <span className="truncate font-mono text-[11px] text-keeper-ice/40">
              {request.toolName}
            </span>
          </div>

          <ArgPreview args={request.args} />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-keeper-cyan/12 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond(false)}
            className="rounded-xl border border-keeper-silver/20 px-4 py-2 text-sm text-keeper-ice/70 transition hover:border-keeper-ice/30 hover:bg-white/5 hover:text-keeper-ice"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onRespond(true)}
            className="rounded-xl bg-keeper-cyan px-5 py-2 text-sm font-medium text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim hover:shadow-cyan"
          >
            允许
          </button>
        </footer>
      </div>
    </div>
  );
}
