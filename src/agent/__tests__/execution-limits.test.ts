import { describe, expect, it } from 'vitest';
import { canonicalCallSignature, estimateRequestTokens, positiveLimit } from '../execution-limits';

describe('execution limits', () => {
  it('normalizes JSON whitespace and key ordering for repeat detection', () => {
    expect(canonicalCallSignature('read', '{ "a": 1, "b": { "y": 2, "x": 3 } }'))
      .toBe(canonicalCallSignature('read', '{"b":{"x":3,"y":2},"a":1}'));
    expect(canonicalCallSignature('read', '{"page":1}')).not.toBe(canonicalCallSignature('read', '{"page":2}'));
  });
  it('rejects non-finite limits and clamps overrides to host maximum', () => {
    for (const value of [NaN, Infinity, 0, -1, undefined, 999]) expect(positiveLimit(value, 20)).toBe(20);
    expect(positiveLimit(2.8, 20)).toBe(2);
  });
  it('counts assistant tool call arguments and tool definitions, not only content', () => {
    const baseline = estimateRequestTokens([{ role: 'assistant', content: null }], []);
    const withArgs = estimateRequestTokens([{ role: 'assistant', content: null, tool_calls: [{
      id: 'a', type: 'function', function: { name: 'read', arguments: '字'.repeat(1000) },
    }] }], [{ description: '表'.repeat(1000) }]);
    expect(withArgs - baseline).toBeGreaterThan(2000);
  });
});
