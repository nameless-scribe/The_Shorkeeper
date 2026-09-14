import { describe, expect, it } from 'vitest';
import { mapPollResponse, mapSubmitResponse, mapTaskStatus, mapTranscriptionPayload } from '../asr-mapping';

/** 固定样本：单声道双人对话。 */
const twoSpeakerPayload = {
  transcripts: [
    {
      channel_id: 0,
      sentences: [
        { begin_time: 0, end_time: 2500, text: '我们先过一下上周的进度。', speaker_id: 0 },
        { begin_time: 2600, end_time: 5000, text: '方案已经发出去了，', speaker_id: 1 },
        { begin_time: 5000, end_time: 7200, text: '等对方周三之前回复。', speaker_id: 1 },
        { begin_time: 7500, end_time: 9000, text: '好，那我周四跟进。', speaker_id: 0 },
      ],
    },
  ],
};

describe('ASR response mapping', () => {
  describe('task status', () => {
    it('maps the documented states case-insensitively', () => {
      expect(mapTaskStatus('PENDING')).toBe('pending');
      expect(mapTaskStatus('running')).toBe('running');
      expect(mapTaskStatus('SUCCEEDED')).toBe('succeeded');
      expect(mapTaskStatus('FAILED')).toBe('failed');
    });

    it('treats unknown or missing status as failed rather than still running', () => {
      // 未知状态若当成"还在跑"，会导致无限轮询。
      expect(mapTaskStatus('CANCELED')).toBe('failed');
      expect(mapTaskStatus(undefined)).toBe('failed');
      expect(mapTaskStatus(42)).toBe('failed');
    });
  });

  describe('submit response', () => {
    it('reads task id from the output envelope', () => {
      expect(mapSubmitResponse({ output: { task_id: 'c2e5', task_status: 'PENDING' } })).toEqual({
        taskId: 'c2e5',
        status: 'pending',
      });
    });

    it('accepts a flat envelope too', () => {
      expect(mapSubmitResponse({ task_id: 'c2e5', task_status: 'PENDING' })?.taskId).toBe('c2e5');
    });

    it('returns null when there is no task id to poll', () => {
      expect(mapSubmitResponse({ output: { task_status: 'PENDING' } })).toBeNull();
      expect(mapSubmitResponse(null)).toBeNull();
      expect(mapSubmitResponse('boom')).toBeNull();
    });
  });

  describe('poll response', () => {
    it('returns the transcription url on success', () => {
      const result = mapPollResponse({
        output: { task_status: 'SUCCEEDED', transcription_url: 'https://example.com/r.json' },
      });
      expect(result).toEqual({ status: 'succeeded', transcriptionUrl: 'https://example.com/r.json', errorMessage: null });
    });

    it('also reads the url out of a results array', () => {
      const result = mapPollResponse({
        output: { task_status: 'SUCCEEDED', results: [{ transcription_url: 'https://example.com/a.json' }] },
      });
      expect(result.transcriptionUrl).toBe('https://example.com/a.json');
    });

    it('downgrades a success with no result url to a failure', () => {
      // 没有结果的"成功"对调用方毫无意义，放行只会在读取阶段炸得更难定位。
      const result = mapPollResponse({ output: { task_status: 'SUCCEEDED' } });
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('没有返回结果地址');
    });

    it('carries a failure message through, truncated', () => {
      const result = mapPollResponse({ output: { task_status: 'FAILED', message: '音频解码失败' } });
      expect(result).toMatchObject({ status: 'failed', errorMessage: '音频解码失败' });

      const long = mapPollResponse({ output: { task_status: 'FAILED', message: 'x'.repeat(1000) } });
      expect(long.errorMessage!.length).toBeLessThanOrEqual(300);
      expect(long.errorMessage!.endsWith('…')).toBe(true);
    });

    it('supplies a fallback message when the provider fails silently', () => {
      expect(mapPollResponse({ output: { task_status: 'FAILED' } }).errorMessage).toBe('转写任务失败');
    });

    it('reports no error while the task is still pending', () => {
      expect(mapPollResponse({ output: { task_status: 'RUNNING' } })).toEqual({
        status: 'running',
        transcriptionUrl: null,
        errorMessage: null,
      });
    });
  });

  describe('transcription payload', () => {
    it('maps a two-speaker conversation with speakers and duration', () => {
      const result = mapTranscriptionPayload(twoSpeakerPayload);
      expect(result.sentences).toHaveLength(4);
      expect(result.speakerCount).toBe(2);
      expect(result.durationMs).toBe(9000);
      expect(result.sentences[0]).toEqual({ beginMs: 0, endMs: 2500, text: '我们先过一下上周的进度。', speakerId: '0' });
    });

    it('returns an empty result for silent audio instead of throwing', () => {
      expect(mapTranscriptionPayload({ transcripts: [{ sentences: [] }] })).toEqual({
        sentences: [],
        durationMs: 0,
        speakerCount: 0,
      });
    });

    it('handles a single very short utterance', () => {
      const result = mapTranscriptionPayload({ sentences: [{ begin_time: 120, end_time: 480, text: '嗯。' }] });
      expect(result.sentences).toHaveLength(1);
      expect(result.durationMs).toBe(480);
      expect(result.speakerCount).toBe(0);
      expect(result.sentences[0].speakerId).toBeUndefined();
    });

    it('drops blank sentences and tolerates string timestamps', () => {
      const result = mapTranscriptionPayload({
        sentences: [
          { begin_time: '0', end_time: '1000', text: '有内容' },
          { begin_time: 1000, end_time: 2000, text: '   ' },
          { begin_time: 2000, end_time: 3000 },
        ],
      });
      expect(result.sentences).toHaveLength(1);
      expect(result.sentences[0]).toMatchObject({ beginMs: 0, endMs: 1000 });
    });

    it('clamps an end time that precedes its begin time', () => {
      const result = mapTranscriptionPayload({ sentences: [{ begin_time: 5000, end_time: 1000, text: '倒挂' }] });
      expect(result.sentences[0]).toMatchObject({ beginMs: 5000, endMs: 5000 });
    });

    it('sorts merged channels back into chronological order', () => {
      const result = mapTranscriptionPayload({
        transcripts: [
          { channel_id: 0, sentences: [{ begin_time: 4000, end_time: 5000, text: '后说的' }] },
          { channel_id: 1, sentences: [{ begin_time: 1000, end_time: 2000, text: '先说的' }] },
        ],
      });
      expect(result.sentences.map((s) => s.text)).toEqual(['先说的', '后说的']);
    });

    it('survives a malformed payload without throwing', () => {
      expect(mapTranscriptionPayload(null)).toMatchObject({ sentences: [], durationMs: 0 });
      expect(mapTranscriptionPayload('boom')).toMatchObject({ sentences: [] });
      expect(mapTranscriptionPayload({ transcripts: 'nope' })).toMatchObject({ sentences: [] });
    });
  });
});
