import { useState } from 'react';
import type { ToolResult } from '@/shared/types';

export interface UiToolCall {
  callId: string;
  name: string;
  args: unknown;
  status: 'running' | 'done' | 'error';
  result?: ToolResult;
}

const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  list_dir: '列出目录',
  web_search: '网络搜索',
};

function formatArgs(args: unknown): string {
  if (args == null) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function truncate(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断）`;
}

interface ToolCallCardProps {
  toolCall: UiToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;
  const isRunning = toolCall.status === 'running';
  const isError = toolCall.status === 'error';

  const resultText = toolCall.result
    ? toolCall.result.success
      ? toolCall.result.output
      : toolCall.result.error ?? '执行失败'
    : '';

  return (
    <div className="overflow-hidden rounded-xl border border-keeper-cyan/20 bg-keeper-navy/40 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${
            isRunning
              ? 'text-keeper-cyan'
              : isError
                ? 'text-red-400'
                : 'text-emerald-400'
          }`}
        >
          {isRunning ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-keeper-cyan/30 border-t-keeper-cyan" />
          ) : isError ? (
            '✕'
          ) : (
            '✓'
          )}
        </span>

        <span className="min-w-0 flex-1 truncate font-medium text-keeper-ice/90">
          {label}
          {isRunning && (
            <span className="ml-1.5 font-normal text-keeper-ice/50">执行中…</span>
          )}
        </span>

        <span
          className={`shrink-0 text-keeper-ice/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-keeper-ice/10 px-3 py-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-keeper-ice/40">
              参数
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/25 p-2 font-mono text-[11px] leading-relaxed text-keeper-ice/70">
              {formatArgs(toolCall.args)}
            </pre>
          </div>

          {!isRunning && resultText && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-keeper-ice/40">
                {isError ? '错误' : '结果'}
              </div>
              <pre
                className={`max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2 font-mono text-[11px] leading-relaxed ${
                  isError
                    ? 'bg-red-950/40 text-red-200'
                    : 'bg-black/25 text-keeper-ice/70'
                }`}
              >
                {truncate(resultText)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
