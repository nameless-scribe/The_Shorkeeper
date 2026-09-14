/**
 * 内部表示 → 逐字稿 Markdown。纯函数，不读文件、不访问配置。
 *
 * 产出的文件是 `transcribe_audio` 的完成证据，也是会议纪要技能的输入。
 * 因此格式要同时满足两件事：人能读，模型能引用到具体时间点。
 */
import {
  TRANSCRIPT_GAP_MARK_MS,
  TRANSCRIPT_MERGE_MAX_GAP_MS,
  type TranscriptResult,
  type TranscriptSentence,
} from './asr-contract';

export interface TranscriptMeta {
  /** 音频在工作区里的相对路径或原始文件名 */
  sourceName: string;
  model: string;
  /** 转写完成时间 */
  completedAt: number;
  /** 实际是否开启了说话人分离 */
  diarization: boolean;
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  // 一小时以内不显示小时位，读起来更短
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export interface TranscriptBlock {
  beginMs: number;
  endMs: number;
  speakerId?: string;
  text: string;
  /** 与上一段之间的静默时长，超过阈值才有值 */
  gapBeforeMs?: number;
}

/**
 * 合并连续发言：同一说话人、且间隔不超过阈值的相邻句子并成一段。
 * 未开启分离时按"间隔"单独分段——否则整篇会挤成一个巨大段落。
 */
export function buildTranscriptBlocks(sentences: readonly TranscriptSentence[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const sentence of sentences) {
    const previous = blocks[blocks.length - 1];
    const gap = previous ? sentence.beginMs - previous.endMs : 0;
    const sameSpeaker = previous?.speakerId === sentence.speakerId;
    if (previous && sameSpeaker && gap <= TRANSCRIPT_MERGE_MAX_GAP_MS) {
      previous.text = `${previous.text}${sentence.text}`;
      previous.endMs = Math.max(previous.endMs, sentence.endMs);
      continue;
    }
    blocks.push({
      beginMs: sentence.beginMs,
      endMs: sentence.endMs,
      ...(sentence.speakerId ? { speakerId: sentence.speakerId } : {}),
      text: sentence.text,
      ...(previous && gap >= TRANSCRIPT_GAP_MARK_MS ? { gapBeforeMs: gap } : {}),
    });
  }
  return blocks;
}

/** 说话人显示名。供应商给的是匿名 id，这里只做稳定的中文标签，不猜真实姓名。 */
export function formatSpeakerLabel(speakerId: string | undefined, order: readonly string[]): string {
  if (!speakerId) return '';
  const index = order.indexOf(speakerId);
  return index >= 0 ? `说话人 ${index + 1}` : `说话人 ${speakerId}`;
}

function escapeMarkdown(text: string): string {
  // 逐字稿正文可能以 # - > 等开头，原样写入会被渲染成标题或列表。
  return text.replace(/^([#>\-*+]|\d+\.)/, '\\$1');
}

export function formatTranscriptMarkdown(result: TranscriptResult, meta: TranscriptMeta): string {
  const completed = new Date(meta.completedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const completedText =
    `${completed.getFullYear()}-${pad(completed.getMonth() + 1)}-${pad(completed.getDate())} ` +
    `${pad(completed.getHours())}:${pad(completed.getMinutes())}`;

  const lines: string[] = [
    `# 录音逐字稿：${meta.sourceName}`,
    '',
    `- 时长：${formatDuration(result.durationMs)}`,
    `- 转写模型：${meta.model}`,
    `- 说话人分离：${meta.diarization ? (result.speakerCount > 0 ? `已开启，识别到 ${result.speakerCount} 位` : '已开启，但未识别出多位说话人') : '未开启'}`,
    `- 完成时间：${completedText}`,
    '',
    '> 本文由自动转写生成，可能存在识别错误；引用前请对照原始录音核实。',
    '',
    '---',
    '',
  ];

  if (!result.sentences.length) {
    lines.push('（未识别到任何语音内容。音频可能是纯静音，或音量过低。）', '');
    return lines.join('\n');
  }

  // 说话人按首次出现顺序编号，保证"说话人 1"始终是最先开口的那位。
  const order: string[] = [];
  for (const sentence of result.sentences) {
    if (sentence.speakerId && !order.includes(sentence.speakerId)) order.push(sentence.speakerId);
  }

  for (const block of buildTranscriptBlocks(result.sentences)) {
    if (block.gapBeforeMs != null) {
      lines.push(`*（静默 ${formatDuration(block.gapBeforeMs)}）*`, '');
    }
    const speaker = formatSpeakerLabel(block.speakerId, order);
    const head = speaker ? `**[${formatTimestamp(block.beginMs)}] ${speaker}**` : `**[${formatTimestamp(block.beginMs)}]**`;
    lines.push(`${head}　${escapeMarkdown(block.text)}`, '');
  }

  return lines.join('\n');
}
