import { describe, expect, it } from 'vitest';
import { stripMarkdownForSpeech, truncateForSpeech } from '../text-for-speech';

describe('stripMarkdownForSpeech', () => {
  it('removes code blocks and keeps plain text', () => {
    const input = '你好\n```js\nconsole.log(1)\n```\n世界';
    expect(stripMarkdownForSpeech(input)).toBe('你好 世界');
  });

  it('unwraps links', () => {
    expect(stripMarkdownForSpeech('[百度](https://example.com)')).toBe('百度');
  });
});

describe('truncateForSpeech', () => {
  it('truncates long text', () => {
    expect(truncateForSpeech('abcdef', 4)).toBe('abcd…');
  });
});
