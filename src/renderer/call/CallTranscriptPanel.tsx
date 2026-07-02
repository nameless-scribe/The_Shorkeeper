export interface TranscriptLine {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

interface CallTranscriptPanelProps {
  lines: TranscriptLine[];
}

export function CallTranscriptPanel({ lines }: CallTranscriptPanelProps) {
  if (lines.length === 0) {
    return (
      <div className="mx-4 flex min-h-0 flex-1 flex-col justify-end rounded-xl border border-keeper-cyan/10 bg-keeper-navy/20 px-3 py-2">
        <p className="text-center text-[11px] text-keeper-ice/35">转写将显示在这里</p>
      </div>
    );
  }

  return (
    <div className="no-drag mx-4 flex min-h-0 max-h-36 flex-1 flex-col overflow-y-auto rounded-xl border border-keeper-cyan/10 bg-keeper-navy/20 px-3 py-2">
      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <div
            key={line.id}
            className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed ${
                line.role === 'user'
                  ? 'bg-keeper-cyan/15 text-keeper-ice'
                  : 'bg-white/[0.06] text-keeper-ice/90'
              } ${!line.final ? 'opacity-70' : ''}`}
            >
              <span className="mr-1 text-[10px] text-keeper-ice/45">
                {line.role === 'user' ? '你' : '守岸人'}
              </span>
              {line.text}
              {!line.final && <span className="ml-0.5 animate-pulse">…</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Merge streaming/final transcript events into display lines. */
export function applyTranscriptEvent(
  lines: TranscriptLine[],
  role: 'user' | 'assistant',
  text: string,
  final: boolean,
): TranscriptLine[] {
  const next = [...lines];
  let lastPartialIdx = -1;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].role === role && !next[i].final) {
      lastPartialIdx = i;
      break;
    }
  }

  if (!final && lastPartialIdx >= 0) {
    next[lastPartialIdx] = { ...next[lastPartialIdx], text };
    return next;
  }

  if (final && lastPartialIdx >= 0) {
    next[lastPartialIdx] = { ...next[lastPartialIdx], text, final: true };
    return next;
  }

  next.push({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    text,
    final,
  });
  return next;
}
