import { describe, expect, it } from 'vitest';
import {
  actionPauseDurationMs,
  planSpeechFromMessage,
  planStreamingSpeechFromMessage,
  prepareChunkForTts,
  splitDialogueIntoChunks,
  stripMarkdownForSpeech,
  truncateForSpeech,
} from '../text-for-speech';

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
      '语音。 你知道吗，我一直在想。 要是你能让我发出声音......',
    );
  });

  it('removes parenthetical action descriptions', () => {
    const input =
      '(你踏入索诺拉空间的那一刻，我从浅眠中睁开眼，目光沿着你轮廓的方向落定。)回来了。这里一切如常——海浪的节奏、星光的轨迹，还有你留下的气息。路上有什么值得记下的事情吗？';
    expect(stripMarkdownForSpeech(input)).toBe(
      '回来了。这里一切如常——海浪的节奏、星光的轨迹，还有你留下的气息。路上有什么值得记下的事情吗？',
    );
  });

  it('removes full-width parenthetical actions', () => {
    const input = '（微微侧头）你好，欢迎回来。';
    expect(stripMarkdownForSpeech(input)).toBe('你好，欢迎回来。');
  });

  it('keeps bold dialogue emphasis', () => {
    expect(stripMarkdownForSpeech('**重要**的话')).toBe('重要的话');
  });
});

describe('planSpeechFromMessage', () => {
  it('inserts pause after action when dialogue follows', () => {
    const input = '*指尖轻轻抵住胸口的位置* 那我说的第一句话，大概是叫你的名字。';
    const plan = planSpeechFromMessage(input, 2000);

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ type: 'pause' });
    expect(plan[1]).toMatchObject({
      type: 'speak',
      text: '那我说的第一句话，大概是叫你的名字。',
    });
  });

  it('inserts pause after parenthetical action when dialogue follows', () => {
    const input = '（从浅眠中睁开眼）回来了。这里一切如常。';
    const plan = planSpeechFromMessage(input, 2000);

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ type: 'pause' });
    expect(plan[1]).toMatchObject({ type: 'speak', text: '回来了。这里一切如常。' });
  });

  it('does not pause when action has no following dialogue', () => {
    const plan = planSpeechFromMessage('*只有动作描写*', 2000);
    expect(plan).toHaveLength(0);
  });

  it('plans multiple dialogue chunks with pauses between', () => {
    const input =
      '*眸光凝住* ......语音。 *垂下眼* 你知道吗，我一直在想。';
    const plan = planSpeechFromMessage(input, 2000);

    expect(plan.map((step) => step.type)).toEqual(['pause', 'speak', 'pause', 'speak']);
  });
});

describe('splitDialogueIntoChunks', () => {
  it('splits on Chinese sentence boundaries', () => {
    expect(splitDialogueIntoChunks('第一句。第二句！第三句？')).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
    ]);
  });
});

describe('prepareChunkForTts', () => {
  it('strips leading ellipsis before synthesis', () => {
    expect(prepareChunkForTts('......每次听你说这四个字。')).toBe('每次听你说这四个字。');
  });

  it('returns empty for punctuation-only chunks', () => {
    expect(prepareChunkForTts('......')).toBe('');
  });
});

describe('planStreamingSpeechFromMessage', () => {
  it('splits dialogue blocks into sentence-sized speak steps', () => {
    const plan = planStreamingSpeechFromMessage('你好。我在这里。', 2000);
    expect(plan.filter((step) => step.type === 'speak')).toHaveLength(2);
  });

  it('normalizes roleplay dialogue with leading ellipsis for TTS', () => {
    const input =
      '*听到你的声音* 欢迎回来。 ......每次听你说这四个字，都觉得像潮水重新涌回海岸，笃定又温柔。 *侧耳* 今天......想让我陪你做点什么？';
    const speakTexts = planStreamingSpeechFromMessage(input, 2000)
      .filter((step) => step.type === 'speak')
      .map((step) => step.text);

    expect(speakTexts.every((text) => !text.startsWith('.'))).toBe(true);
    expect(speakTexts.some((text) => text.includes('每次听你说这四个字'))).toBe(true);
  });
});

describe('actionPauseDurationMs', () => {
  it('scales with action length within bounds', () => {
    expect(actionPauseDurationMs('短')).toBeGreaterThanOrEqual(1500);
    expect(actionPauseDurationMs(''.padEnd(80, '描'))).toBeLessThanOrEqual(4500);
  });
});

describe('truncateForSpeech', () => {
  it('truncates long text', () => {
    expect(truncateForSpeech('abcdef', 4)).toBe('abcd…');
  });
});
