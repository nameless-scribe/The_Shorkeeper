import { describe, expect, it } from 'vitest';
import {
  ASR_FILE_MODEL,
  AUDIO_EXTENSIONS,
  DIARIZATION_RECOMMENDED_MAX_MS,
  MAX_AUDIO_BYTES,
  PROVIDER_MAX_AUDIO_BYTES,
  asrIdempotencyKeys,
  isAsrTaskPending,
  shouldEnableDiarization,
  validateAudioSource,
} from '../asr-contract';

const MB = 1024 * 1024;

describe('ASR contract', () => {
  it('pins the selected model so a silent swap shows up in review', () => {
    // 选型依据见 P4 计划 2.4：唯一同时满足"支持说话人分离 + 单价已查证"的模型。
    expect(ASR_FILE_MODEL).toBe('paraformer-v2');
  });

  it('keeps our own size cap well below the provider limit', () => {
    // base64 内联把请求体放大约 4/3，不能贴着供应商的 2GB 上限走。
    expect(MAX_AUDIO_BYTES).toBeLessThan(PROVIDER_MAX_AUDIO_BYTES / 4);
  });

  it('accepts the supported containers and names the alternatives when rejecting', () => {
    expect(validateAudioSource({ extension: '.mp3', sizeBytes: MB })).toMatchObject({ ok: true, mime: 'audio/mpeg' });
    expect(validateAudioSource({ extension: '.M4A', sizeBytes: MB })).toMatchObject({ ok: true, mime: 'audio/mp4' });

    const rejected = validateAudioSource({ extension: '.mp4', sizeBytes: MB });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toContain('.mp3');
      // 报错不能出现供应商术语
      expect(rejected.reason).not.toMatch(/dashscope|paraformer|task_id/i);
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

  it('rejects audio beyond the 12 hour provider limit when duration is known', () => {
    const result = validateAudioSource({ extension: '.mp3', sizeBytes: MB, durationMs: 13 * 60 * 60 * 1000 });
    expect(result.ok).toBe(false);
  });

  it('warns instead of blocking when diarization conditions are imperfect', () => {
    const multiChannel = validateAudioSource({ extension: '.wav', sizeBytes: MB, channels: 2 }, { diarization: true });
    expect(multiChannel.ok).toBe(true);
    if (multiChannel.ok) expect(multiChannel.warnings.join()).toContain('单声道');

    const long = validateAudioSource(
      { extension: '.wav', sizeBytes: MB, channels: 1, durationMs: DIARIZATION_RECOMMENDED_MAX_MS + 1 },
      { diarization: true },
    );
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.warnings.join()).toContain('2 小时');

    const clean = validateAudioSource({ extension: '.wav', sizeBytes: MB, channels: 1 }, { diarization: true });
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(clean.warnings).toEqual([]);
  });

  it('only enables diarization when the audio is known to be mono', () => {
    expect(shouldEnableDiarization(true, 1)).toBe(true);
    expect(shouldEnableDiarization(true, 2)).toBe(false);
    // 声道未知时保守关闭：拿到一份不可用的分离结果比没有分离更糟
    expect(shouldEnableDiarization(true, undefined)).toBe(false);
    expect(shouldEnableDiarization(false, 1)).toBe(false);
  });

  it('separates cached transcripts by model and diarization setting', () => {
    const plain = asrIdempotencyKeys.transcript('abc', ASR_FILE_MODEL, false);
    const diarized = asrIdempotencyKeys.transcript('abc', ASR_FILE_MODEL, true);
    expect(plain).not.toBe(diarized);
    expect(asrIdempotencyKeys.transcript('abc', 'other-model', false)).not.toBe(plain);
    // 同一输入必须稳定，否则跨重启会重复计费
    expect(asrIdempotencyKeys.transcript('abc', ASR_FILE_MODEL, false)).toBe(plain);
  });

  it('treats only pending and running as "keep polling"', () => {
    expect(isAsrTaskPending('pending')).toBe(true);
    expect(isAsrTaskPending('running')).toBe(true);
    expect(isAsrTaskPending('succeeded')).toBe(false);
    expect(isAsrTaskPending('failed')).toBe(false);
  });

  it('exposes every allowed extension with a MIME type', () => {
    expect(AUDIO_EXTENSIONS.length).toBeGreaterThan(0);
    for (const extension of AUDIO_EXTENSIONS) {
      expect(validateAudioSource({ extension, sizeBytes: MB }).ok).toBe(true);
    }
  });
});
