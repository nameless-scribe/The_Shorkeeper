/** 从 OpenAI 兼容 / 百炼 DashScope usage 对象解析 token 统计 */
export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

function readNum(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseCompatibleUsage(usage: unknown): ParsedUsage {
  if (!usage || typeof usage !== 'object') {
    return { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
  }

  const u = usage as Record<string, unknown>;
  const promptDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const inputDetails = u.input_tokens_details as Record<string, unknown> | undefined;

  const promptTokens = readNum(u, 'prompt_tokens') || readNum(u, 'input_tokens');
  const completionTokens = readNum(u, 'completion_tokens') || readNum(u, 'output_tokens');

  const cachedTokens =
    (promptDetails ? readNum(promptDetails, 'cached_tokens') : 0) ||
    (promptDetails ? readNum(promptDetails, 'cache_read_input_tokens') : 0) ||
    (inputDetails ? readNum(inputDetails, 'cached_tokens') : 0) ||
    readNum(u, 'cached_tokens') ||
    readNum(u, 'cache_read_input_tokens');

  return { promptTokens, completionTokens, cachedTokens };
}
