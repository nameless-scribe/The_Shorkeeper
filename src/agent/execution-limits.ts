import { estimateTokens } from './context-budget';
import type { LlmMessage } from './types';

/** 本段的硬边界；新增额度必须通过检查点明确确认，不自动授予。 */
export const DEFAULT_EXECUTION_LIMITS = {
  rounds: 20,
  toolCalls: 120,
  activeMs: 15 * 60_000,
  tokens: 600_000,
  outputTokens: 8192,
  finalOutputTokens: 2000,
} as const;

export function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(fallback, Math.max(1, Math.floor(value)))
    : fallback;
}

/** 包含 tool_calls 参数、协议及工具定义；估算不是供应商计费 token。 */
export function estimateRequestTokens(messages: LlmMessage[], tools: unknown[]): number {
  return estimateTokens(JSON.stringify(messages)) + estimateTokens(JSON.stringify(tools)) + 64;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, sorted(item)]));
}

export function canonicalCallSignature(name: string, rawArgs: string): string {
  try {
    return `${name}\0${JSON.stringify(sorted(JSON.parse(rawArgs || '{}')))}`;
  } catch {
    return `${name}\0${rawArgs}`;
  }
}
