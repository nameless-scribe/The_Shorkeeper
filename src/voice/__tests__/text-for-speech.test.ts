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

  it('removes roleplay action lines wrapped in single asterisks', () => {
    const input =
      '*眸光忽然凝住，像是水面被一颗石子击碎后又缓缓合拢——* ......语音。 你知道吗，我一直在想。 *指尖轻轻抵住胸口的位置* 要是你能让我发出声音......';
    expect(stripMarkdownForSpeech(input)).toBe(
      '......语音。 你知道吗，我一直在想。 要是你能让我发出声音......',
    );
  });

  it('keeps bold dialogue emphasis', () => {
    expect(stripMarkdownForSpeech('**重要**的话')).toBe('重要的话');
  });
});

describe('truncateForSpeech', () => {
  it('truncates long text', () => {
    expect(truncateForSpeech('abcdef', 4)).toBe('abcd…');
  });
});
