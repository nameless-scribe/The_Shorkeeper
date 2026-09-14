import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASR_ORIGIN,
  POLL_GIVE_UP_AFTER_MS,
  POLL_MAX_DELAY_MS,
  asrSubmitUrl,
  asrTaskUrl,
  deriveAsrOriginFromModelBaseUrl,
  nextPollDelayMs,
  normalizeAsrOrigin,
  shouldGiveUpPolling,
  toAudioDataUri,
} from '../asr-endpoint';

describe('ASR endpoint resolution', () => {
  it('derives the workspace origin from the chat base URL', () => {
    // 与 config/voice.ts 的 TTS 端点推导同源，用户不必再填一个地址。
    expect(deriveAsrOriginFromModelBaseUrl('https://llm-abc123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://llm-abc123.cn-beijing.maas.aliyuncs.com',
    );
    expect(deriveAsrOriginFromModelBaseUrl('https://llm-x.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/')).toBe(
      'https://llm-x.ap-southeast-1.maas.aliyuncs.com',
    );
  });

  it('accepts the public dashscope host as well', () => {
    expect(deriveAsrOriginFromModelBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com',
    );
  });

  it('returns null for an unrelated base URL instead of guessing', () => {
    expect(deriveAsrOriginFromModelBaseUrl('https://api.openai.com/v1')).toBeNull();
    expect(deriveAsrOriginFromModelBaseUrl('')).toBeNull();
    expect(deriveAsrOriginFromModelBaseUrl('not a url')).toBeNull();
  });

  it('normalizes a full endpoint pasted by mistake back to an origin', () => {
    expect(normalizeAsrOrigin('https://llm-a.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription')).toBe(
      'https://llm-a.cn-beijing.maas.aliyuncs.com',
    );
    expect(normalizeAsrOrigin('  ')).toBe('');
    expect(normalizeAsrOrigin('garbage')).toBe('');
  });

  it('builds submit and task URLs without double slashes', () => {
    expect(asrSubmitUrl('https://host.example.com/')).toBe(
      'https://host.example.com/api/v1/services/audio/asr/transcription',
    );
    expect(asrTaskUrl('https://host.example.com', 'abc-123')).toBe('https://host.example.com/api/v1/tasks/abc-123');
  });

  it('escapes the task id and refuses an empty one', () => {
    expect(asrTaskUrl('https://h.com', 'a/b')).toBe('https://h.com/api/v1/tasks/a%2Fb');
    expect(() => asrTaskUrl('https://h.com', '  ')).toThrow('任务 id');
  });

  it('has a sane public fallback origin', () => {
    expect(DEFAULT_ASR_ORIGIN).toMatch(/^https:\/\//);
  });
});

describe('ASR polling schedule', () => {
  it('backs off exponentially and caps the delay', () => {
    // 不做固定间隔：官方轮询默认 20 QPS，多个任务同时恢复时容易触顶。
    expect(nextPollDelayMs(0)).toBe(3_000);
    expect(nextPollDelayMs(1)).toBe(6_000);
    expect(nextPollDelayMs(2)).toBe(12_000);
    expect(nextPollDelayMs(50)).toBe(POLL_MAX_DELAY_MS);
  });

  it('never returns a zero or negative delay for bad input', () => {
    for (const attempt of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = nextPollDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(3_000);
      expect(delay).toBeLessThanOrEqual(POLL_MAX_DELAY_MS);
    }
  });

  it('gives up after the total budget so a stuck task cannot poll forever', () => {
    expect(shouldGiveUpPolling(0)).toBe(false);
    expect(shouldGiveUpPolling(POLL_GIVE_UP_AFTER_MS - 1)).toBe(false);
    expect(shouldGiveUpPolling(POLL_GIVE_UP_AFTER_MS)).toBe(true);
    expect(shouldGiveUpPolling(Number.NaN)).toBe(false);
  });
});

describe('audio data URI', () => {
  it('builds the inline form the provider expects', () => {
    expect(toAudioDataUri('SUQzBA', 'audio/mpeg')).toBe('data:audio/mpeg;base64,SUQzBA');
  });

  it('refuses empty content or a missing MIME type', () => {
    expect(() => toAudioDataUri('', 'audio/mpeg')).toThrow('为空');
    expect(() => toAudioDataUri('SUQzBA', '')).toThrow('MIME');
  });
});
