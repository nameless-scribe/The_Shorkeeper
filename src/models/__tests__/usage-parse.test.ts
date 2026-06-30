import { describe, expect, it } from 'vitest';
import { parseCompatibleUsage } from '../usage-parse';

describe('parseCompatibleUsage', () => {
  it('parses OpenAI prompt_tokens_details.cached_tokens', () => {
    const result = parseCompatibleUsage({
      prompt_tokens: 2000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 1500 },
    });
    expect(result).toEqual({
      promptTokens: 2000,
      completionTokens: 100,
      cachedTokens: 1500,
    });
  });

  it('parses DashScope input_tokens_details.cached_tokens', () => {
    const result = parseCompatibleUsage({
      input_tokens: 1800,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 1200 },
    });
    expect(result.cachedTokens).toBe(1200);
    expect(result.promptTokens).toBe(1800);
  });

  it('parses top-level cached_tokens', () => {
    const result = parseCompatibleUsage({
      prompt_tokens: 500,
      completion_tokens: 50,
      cached_tokens: 400,
    });
    expect(result.cachedTokens).toBe(400);
  });
});
