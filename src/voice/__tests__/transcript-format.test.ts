import { describe, expect, it } from 'vitest';
import type { TranscriptResult } from '../asr-contract';
import {
  buildTranscriptBlocks,
  formatDuration,
  formatSpeakerLabel,
  formatTimestamp,
  formatTranscriptMarkdown,
} from '../transcript-format';

const meta = {
  sourceName: '周会录音.m4a',
  model: 'paraformer-v2',
  completedAt: Date.parse('2026-09-13T14:30:00'),
  diarization: true,
};

function result(sentences: TranscriptResult['sentences']): TranscriptResult {
  const speakers = new Set(sentences.map((s) => s.speakerId).filter(Boolean) as string[]);
  return {
    sentences,
    durationMs: sentences.length ? Math.max(...sentences.map((s) => s.endMs)) : 0,
    speakerCount: speakers.size,
    requestId: null,
  };
}

describe('transcript formatting', () => {
  it('formats timestamps, dropping the hour part under an hour', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_000)).toBe('01:05');
    expect(formatTimestamp(3_600_000)).toBe('1:00:00');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
    expect(formatTimestamp(-5)).toBe('00:00');
  });

  it('formats durations in readable units', () => {
    expect(formatDuration(9_000)).toBe('9 秒');
    expect(formatDuration(125_000)).toBe('2 分 5 秒');
    expect(formatDuration(3_900_000)).toBe('1 小时 5 分');
  });

  it('merges consecutive lines from the same speaker', () => {
    const blocks = buildTranscriptBlocks([
      { beginMs: 0, endMs: 2000, text: '方案发出去了，', speakerId: '1' },
      { beginMs: 2100, endMs: 4000, text: '等对方回复。', speakerId: '1' },
      { beginMs: 4200, endMs: 6000, text: '好的。', speakerId: '0' },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ text: '方案发出去了，等对方回复。', beginMs: 0, endMs: 4000, speakerId: '1' });
  });

  it('uses two separate thresholds: split at 10s, annotate the silence only past 60s', () => {
    // 中等停顿：分段，但不值得打断阅读去标注静默
    const medium = buildTranscriptBlocks([
      { beginMs: 0, endMs: 2000, text: '先说这些。', speakerId: '1' },
      { beginMs: 60_000, endMs: 62_000, text: '我再补充一点。', speakerId: '1' },
    ]);
    expect(medium).toHaveLength(2);
    expect(medium[1].gapBeforeMs).toBeUndefined();

    // 长停顿：分段并标注
    const long = buildTranscriptBlocks([
      { beginMs: 0, endMs: 2000, text: '先说这些。', speakerId: '1' },
      { beginMs: 200_000, endMs: 202_000, text: '休息回来继续。', speakerId: '1' },
    ]);
    expect(long).toHaveLength(2);
    expect(long[1].gapBeforeMs).toBe(198_000);
  });

  it('still splits by pause when there is no speaker information', () => {
    // 未开启分离时若不按间隔分段，整篇会挤成一个巨大段落。
    const blocks = buildTranscriptBlocks([
      { beginMs: 0, endMs: 2000, text: '第一句。' },
      { beginMs: 2100, endMs: 4000, text: '第二句。' },
      { beginMs: 40_000, endMs: 42_000, text: '很久之后的一句。' },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('第一句。第二句。');
  });

  it('numbers speakers by first appearance, not by provider id', () => {
    const order = ['3', '1'];
    expect(formatSpeakerLabel('3', order)).toBe('说话人 1');
    expect(formatSpeakerLabel('1', order)).toBe('说话人 2');
    expect(formatSpeakerLabel(undefined, order)).toBe('');
    expect(formatSpeakerLabel('9', order)).toBe('说话人 9');
  });

  it('renders a full transcript with header, warning and timestamps', () => {
    const markdown = formatTranscriptMarkdown(
      result([
        { beginMs: 0, endMs: 2500, text: '我们先过一下进度。', speakerId: '0' },
        { beginMs: 2600, endMs: 5000, text: '方案已经发出去了。', speakerId: '1' },
      ]),
      meta,
    );
    expect(markdown).toContain('# 录音逐字稿：周会录音.m4a');
    expect(markdown).toContain('- 时长：5 秒');
    expect(markdown).toContain('- 转写模型：paraformer-v2');
    expect(markdown).toContain('识别到 2 位');
    expect(markdown).toContain('2026-09-13 14:30');
    // 必须留有"可能识别错误"的告知，纪要引用时要能追溯
    expect(markdown).toContain('可能存在识别错误');
    expect(markdown).toContain('**[00:00] 说话人 1**');
    expect(markdown).toContain('**[00:02] 说话人 2**');
  });

  it('says so plainly when the audio had no speech', () => {
    const markdown = formatTranscriptMarkdown(result([]), meta);
    expect(markdown).toContain('未识别到任何语音内容');
    expect(markdown).toContain('- 时长：0 秒');
  });

  it('reports diarization that produced no separation honestly', () => {
    const markdown = formatTranscriptMarkdown(
      result([{ beginMs: 0, endMs: 1000, text: '只有一个人在说。' }]),
      meta,
    );
    expect(markdown).toContain('已开启，但未识别出多位说话人');
  });

  it('omits speaker labels entirely when diarization was off', () => {
    const markdown = formatTranscriptMarkdown(
      result([{ beginMs: 0, endMs: 1000, text: '一段独白。' }]),
      { ...meta, diarization: false },
    );
    expect(markdown).toContain('- 说话人分离：未开启');
    expect(markdown).toContain('**[00:00]**');
    expect(markdown).not.toContain('说话人 1');
  });

  it('marks long silences inline', () => {
    const markdown = formatTranscriptMarkdown(
      result([
        { beginMs: 0, endMs: 1000, text: '开始。', speakerId: '0' },
        { beginMs: 400_000, endMs: 402_000, text: '我们继续。', speakerId: '0' },
      ]),
      meta,
    );
    expect(markdown).toContain('*（静默 6 分 39 秒）*');
  });

  it('escapes text that would otherwise become markdown structure', () => {
    const markdown = formatTranscriptMarkdown(
      result([{ beginMs: 0, endMs: 1000, text: '# 这不是标题' }]),
      meta,
    );
    expect(markdown).toContain('\\# 这不是标题');
  });
});
