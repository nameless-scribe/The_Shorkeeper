import { describe, expect, it } from 'vitest';
import {
  AUDIO_EXTENSIONS,
  DEFAULT_ASR_ENGINE,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  VOICE_FORMAT_BY_EXTENSION,
  asrIdempotencyKeys,
  validateAudioSource,
} from '../asr-contract';

const MB = 1024 * 1024;

describe('ASR contract', () => {
  it('pins the default engine so a silent swap shows up in review', () => {
    expect(DEFAULT_ASR_ENGINE).toBe('16k_zh');
  });

  it('keeps the limits aligned with the provider hard limits', () => {
    // 极速版实测上限：100 MB / 2 小时。设得比供应商高只会让用户在上传完成后才收到失败。
    expect(MAX_AUDIO_BYTES).toBe(100 * MB);
    expect(MAX_AUDIO_DURATION_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('maps every allowed extension to a provider voice_format', () => {
    expect(AUDIO_EXTENSIONS.length).toBeGreaterThan(0);
    for (const extension of AUDIO_EXTENSIONS) {
      const result = validateAudioSource({ extension, sizeBytes: MB });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.voiceFormat).toBe(VOICE_FORMAT_BY_EXTENSION[extension]);
    }
  });

  it('normalizes case and maps ogg/opus to the same provider format', () => {
    const m4a = validateAudioSource({ extension: '.M4A', sizeBytes: MB });
    expect(m4a).toMatchObject({ ok: true, voiceFormat: 'm4a' });
    // 供应商只认 ogg-opus 这一个取值，两种扩展名都要落到它
    expect(validateAudioSource({ extension: '.ogg', sizeBytes: MB })).toMatchObject({ voiceFormat: 'ogg-opus' });
    expect(validateAudioSource({ extension: '.opus', sizeBytes: MB })).toMatchObject({ voiceFormat: 'ogg-opus' });
  });

  it('names the alternatives when rejecting a format, without leaking vendor terms', () => {
    const rejected = validateAudioSource({ extension: '.mp4', sizeBytes: MB });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toContain('.mp3');
      expect(rejected.reason).not.toMatch(/tencent|flash_result|engine_type|appid/i);
    }
  });

  it('rejects an empty file and a missing extension with a readable reason', () => {
    expect(validateAudioSource({ extension: '.mp3', sizeBytes: 0 })).toMatchObject({ ok: false });
    const noExt = validateAudioSource({ extension: '', sizeBytes: MB });
    expect(noExt.ok).toBe(false);
    if (!noExt.ok) expect(noExt.reason).toContain('缺少扩展名');
  });

  it('rejects oversized audio and says how big it actually was', () => {
    const result = validateAudioSource({ extension: '.wav', sizeBytes: MAX_AUDIO_BYTES + MB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('101 MB');
      expect(result.reason).toContain('分段');
    }
  });

  it('rejects audio past the two hour limit when duration is known', () => {
    expect(validateAudioSource({ extension: '.mp3', sizeBytes: MB, durationMs: MAX_AUDIO_DURATION_MS + 1 })).toMatchObject({
      ok: false,
    });
    expect(validateAudioSource({ extension: '.mp3', sizeBytes: MB, durationMs: MAX_AUDIO_DURATION_MS })).toMatchObject({
      ok: true,
    });
  });

  it('separates cached transcripts by engine and diarization setting', () => {
    const plain = asrIdempotencyKeys.transcript('abc', DEFAULT_ASR_ENGINE, false);
    const diarized = asrIdempotencyKeys.transcript('abc', DEFAULT_ASR_ENGINE, true);
    expect(plain).not.toBe(diarized);
    expect(asrIdempotencyKeys.transcript('abc', '8k_zh', false)).not.toBe(plain);
    // 同一输入必须稳定，否则跨重启会重复计费
    expect(asrIdempotencyKeys.transcript('abc', DEFAULT_ASR_ENGINE, false)).toBe(plain);
  });
});
