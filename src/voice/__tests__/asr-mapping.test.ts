import { describe, expect, it } from 'vitest';
import { mapFlashResult, readAsrFailure, readFlashPlainText } from '../asr-mapping';

/**
 * 固定样本按 2026-09-13 真实调用的结构构造（见 P4 计划 10.4）。
 * 字段名一律以实测为准：flash_result / sentence_list / start_time / 数字 speaker_id。
 */
function flashResponse(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'req-0123456789abcdef0123',
    code: 0,
    message: '',
    audio_duration: 12000,
    flash_result: [
      {
        text: '我们先过一下进度。方案已经发出去了。',
        channel_id: 0,
        sentence_list: [
          {
            text: '我们先过一下进度。',
            start_time: 470,
            end_time: 4350,
            speaker_id: 0,
            emotional_energy: 0,
            speech_speed: 0,
            lang_type: '',
          },
          {
            text: '方案已经发出去了。',
            start_time: 5110,
            end_time: 10100,
            speaker_id: 1,
            emotional_energy: 0,
            speech_speed: 0,
            lang_type: '',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('flash ASR failure envelope', () => {
  it('treats code 0 as success', () => {
    expect(readAsrFailure(flashResponse())).toBeNull();
  });

  it('reads the top-level code, because HTTP 200 can still carry a failure', () => {
    // 实测：服务未开通时 HTTP 是 200，错误只体现在顶层 code
    const failure = readAsrFailure({
      request_id: 'req-1',
      code: 4003,
      message: 'service not opened||innererr=service not opened [appid: 1]',
      audio_duration: 0,
    });
    expect(failure).toMatchObject({ code: 4003, requestId: 'req-1' });
    expect(failure?.message).toContain('service not opened');
  });

  it('truncates an overlong provider message', () => {
    const failure = readAsrFailure({ code: 1, message: 'x'.repeat(1000) });
    expect(failure!.message.length).toBeLessThanOrEqual(300);
    expect(failure!.message.endsWith('…')).toBe(true);
  });

  it('supplies a fallback when the provider fails without a message', () => {
    expect(readAsrFailure({ code: 500, message: '' })?.message).toBe('转写失败，供应商未给出原因');
  });

  it('rejects a non-object response instead of pretending it succeeded', () => {
    expect(readAsrFailure(null)).toMatchObject({ code: -1 });
    expect(readAsrFailure('boom')).toMatchObject({ code: -1 });
  });
});

describe('flash ASR result mapping', () => {
  it('maps sentences with speakers and uses the reported duration', () => {
    const result = mapFlashResult(flashResponse());
    expect(result.sentences).toHaveLength(2);
    expect(result.speakerCount).toBe(2);
    // 顶层 audio_duration 优先于"最后一句结束时间"：结尾静音时两者能差好几秒
    expect(result.durationMs).toBe(12000);
    // 成功响应也带 request_id，提工单时要用
    expect(result.requestId).toBe('req-0123456789abcdef0123');
    expect(result.sentences[0]).toEqual({
      beginMs: 470,
      endMs: 4350,
      text: '我们先过一下进度。',
      speakerId: '0',
    });
  });

  it('converts numeric speaker ids to strings and counts them', () => {
    const result = mapFlashResult(
      flashResponse({
        flash_result: [
          {
            channel_id: 0,
            text: '',
            sentence_list: [0, 1, 2, 3, 4].map((id, index) => ({
              text: `第 ${id} 位发言`,
              start_time: index * 1000,
              end_time: index * 1000 + 900,
              speaker_id: id,
            })),
          },
        ],
      }),
    );
    // 实测极速版能分出 5 个说话人，不存在标准版那种"仅双人"限制
    expect(result.speakerCount).toBe(5);
    expect(result.sentences.map((s) => s.speakerId)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('omits speakerId entirely when diarization was off', () => {
    const result = mapFlashResult(
      flashResponse({
        flash_result: [
          { channel_id: 0, text: '一段独白', sentence_list: [{ text: '一段独白', start_time: 0, end_time: 900 }] },
        ],
      }),
    );
    expect(result.sentences[0].speakerId).toBeUndefined();
    expect(result.speakerCount).toBe(0);
  });

  it('merges multiple channels back into chronological order', () => {
    const result = mapFlashResult(
      flashResponse({
        flash_result: [
          { channel_id: 0, text: '', sentence_list: [{ text: '后说的', start_time: 4000, end_time: 5000 }] },
          { channel_id: 1, text: '', sentence_list: [{ text: '先说的', start_time: 1000, end_time: 2000 }] },
        ],
      }),
    );
    expect(result.sentences.map((s) => s.text)).toEqual(['先说的', '后说的']);
  });

  it('falls back to the last sentence end when duration is missing', () => {
    const result = mapFlashResult(flashResponse({ audio_duration: undefined }));
    expect(result.durationMs).toBe(10100);
  });

  it('returns an empty result for silent audio instead of throwing', () => {
    expect(mapFlashResult(flashResponse({ flash_result: [{ channel_id: 0, text: '', sentence_list: [] }] }))).toEqual({
      sentences: [],
      durationMs: 12000,
      speakerCount: 0,
      requestId: 'req-0123456789abcdef0123',
    });
  });

  it('drops blank sentences and clamps an inverted time range', () => {
    const result = mapFlashResult(
      flashResponse({
        flash_result: [
          {
            channel_id: 0,
            text: '',
            sentence_list: [
              { text: '   ', start_time: 0, end_time: 1000 },
              { text: '倒挂', start_time: 5000, end_time: 1000 },
            ],
          },
        ],
      }),
    );
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]).toMatchObject({ beginMs: 5000, endMs: 5000 });
  });

  it('survives a malformed payload without throwing', () => {
    expect(mapFlashResult(null)).toMatchObject({ sentences: [], durationMs: 0 });
    expect(mapFlashResult({ flash_result: 'nope' })).toMatchObject({ sentences: [] });
    expect(mapFlashResult({ flash_result: [{ sentence_list: 'nope' }] })).toMatchObject({ sentences: [] });
  });
});

describe('flash ASR plain text', () => {
  it('joins the per-channel full text', () => {
    expect(readFlashPlainText(flashResponse())).toBe('我们先过一下进度。方案已经发出去了。');
  });

  it('returns an empty string when nothing was recognized', () => {
    expect(readFlashPlainText(flashResponse({ flash_result: [{ channel_id: 0, text: '', sentence_list: [] }] }))).toBe('');
    expect(readFlashPlainText(null)).toBe('');
  });
});
