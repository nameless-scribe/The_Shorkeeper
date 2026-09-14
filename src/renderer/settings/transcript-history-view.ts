/**
 * 录音转写记录的展示逻辑。纯函数，不碰 React、IPC 与 window。
 *
 * 与 `run-history-view.ts` 同一模式：把格式化与状态推导抽出来单独测，
 * 组件里只留渲染。
 */
import type { AudioTranscriptInfo } from '@/shared/types';

export type TranscriptTone = 'running' | 'success' | 'error' | 'muted';

export interface TranscriptStatusView {
  label: string;
  tone: TranscriptTone;
}

export function transcriptStatusView(status: AudioTranscriptInfo['status']): TranscriptStatusView {
  switch (status) {
    case 'running':
      return { label: '转写中', tone: 'running' };
    case 'succeeded':
      return { label: '已完成', tone: 'success' };
    case 'cancelled':
      // 用户主动取消不是故障，不该用报错的配色
      return { label: '已取消', tone: 'muted' };
    default:
      return { label: '失败', tone: 'error' };
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

export function formatTranscriptDuration(durationMs: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return '—';
  const total = Math.round(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export function formatTranscriptTime(timestamp: number | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 列表副标题：一眼看清规模与是否分离，不需要展开。 */
export function formatTranscriptMeta(item: AudioTranscriptInfo): string {
  const parts = [formatFileSize(item.sizeBytes)];
  if (item.status === 'succeeded') {
    parts.push(formatTranscriptDuration(item.durationMs));
    if (item.sentenceCount != null) parts.push(`${item.sentenceCount} 句`);
    parts.push(item.diarization && item.speakerCount ? `${item.speakerCount} 位说话人` : '未分离');
  }
  parts.push(formatTranscriptTime(item.updatedAt));
  return parts.join(' · ');
}

/**
 * 失败说明。供应商错误码对用户没意义，但**提工单时需要**，
 * 因此码值与 request id 放在正文之后，而不是塞进主消息里。
 */
export function formatTranscriptIssue(item: AudioTranscriptInfo): string | null {
  if (item.status !== 'failed' || !item.error) return null;
  const trailer = [
    item.providerCode ? `错误码 ${item.providerCode}` : '',
    item.providerRequestId ? `请求 ID ${item.providerRequestId}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return trailer ? `${item.error}\n${trailer}` : item.error;
}

/** 逐字稿可打开的前提：成功且产物路径还在记录里。 */
export function canOpenTranscript(item: AudioTranscriptInfo): boolean {
  return item.status === 'succeeded' && Boolean(item.transcriptPath);
}

export function countTranscriptsByStatus(items: readonly AudioTranscriptInfo[]): Record<string, number> {
  const counts: Record<string, number> = { running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}
