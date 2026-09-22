import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { PermissionRequestPayload, ToolPreviewInfo } from '@/shared/types';
import { toolDisplayName } from './tool-labels';

function truncate(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`;
}

function normalizeArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as unknown;
    } catch {
      return args;
    }
  }
  return args;
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
  const [showContent, setShowContent] = useState(false);
  const normalized = normalizeArgs(args);

  if (!isRecord(normalized)) {
    return (
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
        {formatFallbackArgs(normalized)}
      </pre>
    );
  }

  const pathKeys = ['path', 'output_path', 'source_path', 'file_path', 'sourceFile', 'relativePath'] as const;
  const paths = pathKeys
    .map((key) => ({ key, value: normalized[key] }))
    .filter((item): item is { key: (typeof pathKeys)[number]; value: string } =>
      typeof item.value === 'string' && item.value.trim().length > 0,
    );
  const content = typeof normalized.content === 'string' ? normalized.content : null;
  const contentLong = (content?.length ?? 0) > 600;

  if (paths.length > 0 || content) {
    return (
      <div className="space-y-3">
        {paths.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
              文件路径
            </div>
            <div className="space-y-1.5">
              {paths.map(({ key, value }) => (
                <div key={`${key}-${value}`} className="rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/10 px-3 py-2.5 font-mono text-sm text-keeper-cyan">
                  {key === 'output_path' ? '输出：' : key === 'source_path' ? '来源：' : ''}{value}
                </div>
              ))}
            </div>
          </div>
        )}
        {content && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
                写入内容
              </span>
              {contentLong && (
                <button
                  type="button"
                  onClick={() => setShowContent((v) => !v)}
                  className="keeper-dialog-btn text-[10px] text-keeper-cyan hover:underline"
                >
                  {showContent ? '收起' : `展开预览（${content.length} 字符）`}
                </button>
              )}
            </div>
            {(!contentLong || showContent) && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
                {truncate(content)}
              </pre>
            )}
            {contentLong && !showContent && (
              <p className="rounded-xl border border-keeper-ice/10 bg-black/20 px-3 py-2 text-xs text-keeper-ice/50">
                将覆盖写入完整文件（{content.length} 字符），默认不展开全文。
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
      {formatFallbackArgs(normalized)}
    </pre>
  );
}

function PreviewTextPane({
  label,
  content,
  truncated,
}: {
  label: string;
  content: string;
  truncated?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
        {label}{truncated ? '（已截断）' : ''}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-keeper-ice/10 bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/75">
        {content || '（空）'}
      </pre>
    </div>
  );
}

function ToolPreviewPanel({ preview }: { preview: ToolPreviewInfo }) {
  const visibleChanges = preview.changes?.slice(0, 100) ?? [];
  const [showTechnical, setShowTechnical] = useState(false);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-keeper-cyan/25 bg-keeper-cyan/8 px-3 py-2.5">
        <p className="text-sm font-medium text-keeper-ice">{preview.summary}</p>
        <p className="mt-1 break-all font-mono text-[11px] text-keeper-cyan/80">
          {preview.target}
        </p>
        {preview.details?.map((detail) => (
          <p key={detail} className="mt-1 text-[11px] text-keeper-ice/50">{detail}</p>
        ))}
      </div>

      {preview.kind === 'text-diff' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewTextPane
            label="修改前"
            content={preview.before ?? ''}
            truncated={preview.beforeTruncated}
          />
          <PreviewTextPane
            label="修改后"
            content={preview.after ?? ''}
            truncated={preview.afterTruncated}
          />
        </div>
      )}

      {preview.kind === 'query-plan' && preview.technicalDetails && (
        <div className="rounded-xl border border-keeper-ice/10 bg-black/20">
          <button
            type="button"
            onClick={() => setShowTechnical((value) => !value)}
            className="keeper-dialog-btn w-full px-3 py-2 text-left text-[11px] text-keeper-ice/55 hover:text-keeper-cyan"
          >
            {showTechnical ? '收起执行详情' : '查看执行详情（SQL）'}
          </button>
          {showTechnical && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-keeper-ice/10 p-3 font-mono text-[11px] leading-relaxed text-keeper-ice/70">
              {preview.technicalDetails}
            </pre>
          )}
        </div>
      )}

      {preview.kind === 'cell-changes' && (
        <div className="overflow-hidden rounded-xl border border-keeper-ice/10">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-2 bg-keeper-navy/30 px-3 py-2 text-[10px] font-medium text-keeper-ice/45">
            <span>单元格</span><span>修改前</span><span>修改后</span>
          </div>
          <div className="max-h-56 divide-y divide-keeper-ice/8 overflow-y-auto">
            {visibleChanges.map((change, index) => (
              <div
                key={`${change.label}-${index}`}
                className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-3 py-2 text-[11px]"
              >
                <span className="font-mono text-keeper-cyan">{change.label}</span>
                <span className="break-words text-keeper-ice/55">{change.before}</span>
                <span className="break-words text-keeper-ice/85">{change.after}</span>
              </div>
            ))}
          </div>
          {(preview.changes?.length ?? 0) > visibleChanges.length && (
            <p className="border-t border-keeper-ice/10 px-3 py-2 text-[10px] text-keeper-ice/40">
              仅展示前 {visibleChanges.length} 项，共 {preview.changes?.length} 项
            </p>
          )}
        </div>
      )}

      {preview.kind === 'erp-work-report' && preview.erpWorkReport && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['报工账号', preview.erpWorkReport.accountName],
              ['日期', preview.erpWorkReport.workDate],
              ['当天已报', `${preview.erpWorkReport.existingMinutes / 60} 小时`],
              ['提交后合计', `${preview.erpWorkReport.totalMinutes / 60} 小时`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl border border-keeper-ice/10 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-keeper-ice/45">{label}</p>
                <p className="mt-1 break-words text-xs font-medium text-keeper-ice">{value}</p>
              </div>
            ))}
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {preview.erpWorkReport.items.map((item) => (
              <article key={item.itemId} className="rounded-xl border border-keeper-cyan/20 bg-keeper-navy/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {item.projectName && <p className="truncate text-[10px] text-keeper-cyan/70">{item.projectName}</p>}
                    <p className="break-words text-sm font-medium text-keeper-ice">{item.taskName}</p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-keeper-cyan/12 px-2 py-1 text-xs font-semibold text-keeper-cyan">
                    {item.workMinutes / 60} 小时
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-keeper-ice/65">
                  {item.workContent}
                </p>
              </article>
            ))}
          </div>
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/8 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
            确认后将逐条新增到 ERP；已成功提交的记录无法自动撤回。
          </p>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-keeper-ice/45">
        当前仅为预览，尚未写入。确认后会再次校验目标版本；内容已变化时将拒绝执行。
      </p>
    </div>
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
      if (e.repeat) return;
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
        className="absolute inset-0 bg-keeper-navyDeep/88 backdrop-blur-md"
        onClick={() => onRespond(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-keeper-cyan/30 bg-keeper-navyDeep shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
      >
        <header className="flex items-center gap-3 border-b border-keeper-cyan/15 bg-keeper-navy/25 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-xl">
            🔐
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="permission-dialog-title" className="text-base font-semibold text-keeper-ice">
              {request.preview ? `确认并执行：${label}？` : `允许执行：${label}？`}
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
          {request.preview ? <ToolPreviewPanel preview={request.preview} /> : <ArgPreview args={request.args} />}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-keeper-cyan/15 bg-keeper-navy/25 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond(false)}
            className={`rounded-xl border border-keeper-silver/25 bg-keeper-navyDeep px-4 py-2.5 text-sm text-keeper-ice/75 transition hover:border-keeper-ice/35 hover:bg-white/5 hover:text-keeper-ice ${dialogButtonClass}`}
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onRespond(true)}
            className={`rounded-xl bg-keeper-cyan px-5 py-2.5 text-sm font-semibold text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim ${dialogButtonClass}`}
          >
            {request.preview ? '确认并执行' : '允许'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
