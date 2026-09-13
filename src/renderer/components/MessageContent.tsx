import { useState } from 'react';
import type { ContextSourceDetailInfo } from '@/shared/types';

const CITATION_PATTERN = /〔((?:mem|goal|commitment):[A-Za-z0-9_-]{1,200}|doc:[A-Za-z0-9_-]{1,200}#chunk:\d{1,6})〕/g;

export type MessageContentPart =
  | { type: 'text'; value: string }
  | { type: 'citation'; ref: string };

export function parseMessageCitations(content: string): MessageContentPart[] {
  const parts: MessageContentPart[] = [];
  let offset = 0;
  for (const match of content.matchAll(CITATION_PATTERN)) {
    if (match.index > offset) parts.push({ type: 'text', value: content.slice(offset, match.index) });
    parts.push({ type: 'citation', ref: match[1] });
    offset = match.index + match[0].length;
  }
  if (offset < content.length) parts.push({ type: 'text', value: content.slice(offset) });
  return parts;
}

function sourceLabel(ref: string): string {
  if (ref.startsWith('mem:')) return '记忆来源';
  if (ref.startsWith('doc:')) return '文档来源';
  if (ref.startsWith('goal:')) return '目标来源';
  return '承诺来源';
}

export function MessageContent({ content }: { content: string }) {
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextSourceDetailInfo | null>(null);
  const [loadingRef, setLoadingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parts = parseMessageCitations(content);

  const openSource = async (ref: string) => {
    if (expandedRef === ref) {
      setExpandedRef(null);
      return;
    }
    setExpandedRef(ref);
    setDetail(null);
    setError(null);
    setLoadingRef(ref);
    try {
      setDetail(await window.shorekeeper.agent.sourceDetail(ref));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingRef(null);
    }
  };

  return (
    <div className="min-w-0 whitespace-pre-wrap break-words">
      {parts.map((part, index) => part.type === 'text' ? (
        <span key={`${index}-${part.value.slice(0, 8)}`}>{part.value}</span>
      ) : (
        <button
          key={`${index}-${part.ref}`}
          type="button"
          onClick={() => void openSource(part.ref)}
          title={part.ref}
          className="mx-0.5 inline-flex items-center rounded-full border border-keeper-cyan/25 bg-keeper-cyan/10 px-2 py-0.5 align-baseline text-[10px] font-medium text-keeper-cyan transition hover:border-keeper-cyan/50 hover:bg-keeper-cyan/15"
        >
          {sourceLabel(part.ref)}
        </button>
      ))}
      {expandedRef && (
        <div className="mt-2 rounded-xl border border-keeper-cyan/20 bg-keeper-navyDeep/45 px-3 py-2 text-xs leading-relaxed">
          {loadingRef === expandedRef && <p className="text-keeper-ice/50">正在读取来源…</p>}
          {error && <p className="text-red-300/80">来源读取失败：{error}</p>}
          {detail && (
            <>
              <div className="flex items-center justify-between gap-2">
                <strong className="min-w-0 truncate text-keeper-ice/90">{detail.title}</strong>
                <span className="shrink-0 font-mono text-[9px] text-keeper-cyan/60">{detail.sourceRef}</span>
              </div>
              {detail.content && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-keeper-ice/70">{detail.content}</p>}
              {detail.meta && <p className="mt-1 text-[10px] text-keeper-ice/45">{detail.meta}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
