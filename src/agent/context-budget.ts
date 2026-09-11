export interface ContextSection {
  id: string;
  text: string;
  priority: number;
  required?: boolean;
  group?: 'stable' | 'dynamic';
}

export interface ContextBudgetReport {
  maxTokens: number;
  estimatedTokens: number;
  includedSectionIds: string[];
  droppedSectionIds: string[];
  truncatedSectionIds: string[];
}

export interface BudgetedContextSections {
  sections: ContextSection[];
  report: ContextBudgetReport;
}

export interface BudgetedMessages<T> {
  messages: T[];
  estimatedTokens: number;
  trimmedCount: number;
  truncatedLatest: boolean;
}

export const DEFAULT_CONTEXT_MAX_INPUT_TOKENS = 24_000;

const TRUNCATION_MARKER = '\n[内容因上下文预算截断]';

/** 保守估算：中日韩字符按 1 token，其余字符约按 4 字符/token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk + (text.length - cjk) / 4));
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) return '';
  if (estimateTokens(text) <= maxTokens) return text;
  if (estimateTokens(TRUNCATION_MARKER) >= maxTokens) {
    return text.slice(0, Math.max(1, maxTokens));
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}${TRUNCATION_MARKER}`;
    if (estimateTokens(candidate) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}${TRUNCATION_MARKER}`;
}

export function applyContextSectionBudget(
  sections: ContextSection[],
  maxTokens: number,
): BudgetedContextSections {
  const limit = Math.max(1, Math.floor(maxTokens));
  const rankedAll = sections
    .map((section, index) => ({ ...section, index }))
    .sort((a, b) => {
    if (Boolean(a.required) !== Boolean(b.required)) return a.required ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.index - b.index;
  });
  const seen = new Set<string>();
  const ranked = rankedAll.filter((section) => {
    const normalized = section.text.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  let used = 0;
  const included: typeof ranked = [];
  const dropped: string[] = [];
  const truncated: string[] = [];

  for (const section of ranked) {
    const remaining = limit - used;
    if (remaining <= 0) {
      dropped.push(section.id);
      continue;
    }
    const tokens = estimateTokens(section.text);
    if (tokens <= remaining) {
      included.push(section);
      used += tokens;
      continue;
    }

    const clipped = truncateToTokenBudget(section.text, remaining);
    if (clipped && estimateTokens(clipped) <= remaining && remaining >= 32) {
      included.push({ ...section, text: clipped });
      used += estimateTokens(clipped);
      truncated.push(section.id);
    } else {
      dropped.push(section.id);
    }
  }

  included.sort((a, b) => a.index - b.index);
  return {
    sections: included.map(({ index: _index, ...section }) => section),
    report: {
      maxTokens: limit,
      estimatedTokens: used,
      includedSectionIds: included.map((section) => section.id),
      droppedSectionIds: dropped,
      truncatedSectionIds: truncated,
    },
  };
}

export function trimMessagesToTokenBudget<T extends { content: string }>(
  messages: T[],
  maxTokens: number,
): BudgetedMessages<T> {
  const limit = Math.max(1, Math.floor(maxTokens));
  const selected: T[] = [];
  let used = 0;
  let truncatedLatest = false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const tokens = estimateTokens(message.content) + 4;
    if (used + tokens <= limit) {
      selected.unshift(message);
      used += tokens;
      continue;
    }
    if (!selected.length) {
      const content = truncateToTokenBudget(message.content, Math.max(1, limit - 4));
      selected.unshift({ ...message, content });
      used = Math.min(limit, estimateTokens(content) + 4);
      truncatedLatest = true;
    }
    break;
  }

  return {
    messages: selected,
    estimatedTokens: used,
    trimmedCount: Math.max(0, messages.length - selected.length),
    truncatedLatest,
  };
}
