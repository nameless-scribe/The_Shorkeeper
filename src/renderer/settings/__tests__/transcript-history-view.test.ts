import { describe, expect, it } from 'vitest';
import type { AudioTranscriptInfo } from '@/shared/types';
import {
  canOpenTranscript,
  countTranscriptsByStatus,
  formatFileSize,
  formatTranscriptDuration,
  formatTranscriptIssue,
  formatTranscriptMeta,
  formatTranscriptTime,
  transcriptStatusView,
} from '../transcript-history-view';

const now = Date.parse('2026-09-14 15:30');

function transcript(overrides: Partial<AudioTranscriptInfo> = {}): AudioTranscriptInfo {
  return {
    id: 't1',
    sourcePath: 'audio/周会.m4a',
    sourceHash: 'a'.repeat(64),
    sizeBytes: 9_971_240,
    durationMs: 612_137,
    provider: 'tencent-flash',
    engineType: '16k_zh',
    diarization: true,
    status: 'succeeded',
    transcriptPath: 'audio/周会.transcript.md',
    sentenceCount: 95,
    speakerCount: 5,
    error: null,
    providerCode: null,
    providerRequestId: null,
    sensitivity: 'sensitive',
    createdAt: now - 30_000,
    updatedAt: now,
    completedAt: now,
    ...overrides,
  };
}

describe('transcript status view', () => {
  it('gives each status its own label', () => {
    expect(transcriptStatusView('running')).toEqual({ label: '转写中', tone: 'running' });
    expect(transcriptStatusView('succeeded')).toEqual({ label: '已完成', tone: 'success' });
    expect(transcriptStatusView('failed')).toEqual({ label: '失败', tone: 'error' });
  });

  it('does not colour a user cancellation as an error', () => {
    // 主动取消不是故障，用报错配色会让人以为出了问题
    expect(transcriptStatusView('cancelled')).toEqual({ label: '已取消', tone: 'muted' });
  });
});

describe('formatting', () => {
  it('formats sizes, switching to KB for small files', () => {
    expect(formatFileSize(9_971_240)).toBe('9.51 MB');
    expect(formatFileSize(52_428_800)).toBe('50.0 MB');
    expect(formatFileSize(40_960)).toBe('40 KB');
    expect(formatFileSize(0)).toBe('0 MB');
    expect(formatFileSize(Number.NaN)).toBe('0 MB');
  });

  it('formats durations and shows a dash when unknown', () => {
    expect(formatTranscriptDuration(612_137)).toBe('10 分 12 秒');
    expect(formatTranscriptDuration(3_900_000)).toBe('1 小时 5 分');
    expect(formatTranscriptDuration(9_000)).toBe('9 秒');
    // 转写中还没有时长，不该显示 0 秒
    expect(formatTranscriptDuration(null)).toBe('—');
    expect(formatTranscriptDuration(0)).toBe('—');
  });

  it('formats timestamps and tolerates a missing one', () => {
    expect(formatTranscriptTime(now)).toBe('09-14 15:30');
    expect(formatTranscriptTime(null)).toBe('—');
  });
});

describe('list meta line', () => {
  it('shows scale and speaker count for a finished transcript', () => {
    expect(formatTranscriptMeta(transcript())).toBe('9.51 MB · 10 分 12 秒 · 95 句 · 5 位说话人 · 09-14 15:30');
  });

  it('says so plainly when diarization was off', () => {
    expect(formatTranscriptMeta(transcript({ diarization: false, speakerCount: 0 }))).toContain('未分离');
  });

  it('omits result details while still running', () => {
    const meta = formatTranscriptMeta(
      transcript({ status: 'running', durationMs: null, sentenceCount: null, speakerCount: null }),
    );
    expect(meta).toBe('9.51 MB · 09-14 15:30');
    expect(meta).not.toContain('句');
  });
});

describe('failure detail', () => {
  it('keeps the provider code and request id after the message, not inside it', () => {
    // 码值对用户没意义，但提工单时需要
    const issue = formatTranscriptIssue(
      transcript({ status: 'failed', error: '腾讯云语音识别服务未开通', providerCode: 4003, providerRequestId: 'req-1' }),
    );
    expect(issue).toBe('腾讯云语音识别服务未开通\n错误码 4003 · 请求 ID req-1');
  });

  it('returns null for anything that is not a failure', () => {
    expect(formatTranscriptIssue(transcript())).toBeNull();
    expect(formatTranscriptIssue(transcript({ status: 'cancelled', error: '转写已取消' }))).toBeNull();
    expect(formatTranscriptIssue(transcript({ status: 'failed', error: null }))).toBeNull();
  });
});

describe('opening the transcript', () => {
  it('only allows opening a finished transcript that has an artifact', () => {
    expect(canOpenTranscript(transcript())).toBe(true);
    expect(canOpenTranscript(transcript({ status: 'running', transcriptPath: null }))).toBe(false);
    expect(canOpenTranscript(transcript({ status: 'failed' }))).toBe(false);
    // 成功但没有产物路径是异常状态，不该给出一个打不开的入口
    expect(canOpenTranscript(transcript({ transcriptPath: null }))).toBe(false);
  });
});

describe('status counts', () => {
  it('counts every status and keeps zeros visible', () => {
    const counts = countTranscriptsByStatus([
      transcript(),
      transcript({ id: 't2', status: 'failed' }),
      transcript({ id: 't3', status: 'failed' }),
    ]);
    expect(counts).toEqual({ running: 0, succeeded: 1, failed: 2, cancelled: 0 });
  });

  it('returns all zeros for an empty list', () => {
    expect(countTranscriptsByStatus([])).toEqual({ running: 0, succeeded: 0, failed: 0, cancelled: 0 });
  });
});
