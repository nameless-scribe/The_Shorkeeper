/**
 * 供应商返回 → 内部表示的纯映射。不发请求、不读配置。
 *
 * **重要**：百炼录音文件识别的结果 JSON 结构来自官方文档描述（句子含
 * `begin_time` / `end_time` / `text` / `words`，开启分离时含 `speaker_id`），
 * 但**尚未用真实响应验证过嵌套层级**。因此这里对多种可能的外层结构都做兼容，
 * 并且对缺字段一律降级而不是抛错。P4.2 开工时必须拿真实响应复核一次，
 * 复核后可以收紧这里的兼容分支。
 */
import type { AsrTaskStatus, TranscriptResult, TranscriptSentence } from './asr-contract';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 供应商可能给字符串数字；非有限值一律当作缺失。 */
function asMs(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num >= 0 ? num : null;
}

/** 说话人标识可能是数字或字符串；统一成字符串，空值视为未分离。 */
function asSpeakerId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/** PENDING / RUNNING / SUCCEEDED / FAILED → 内部状态。未知值按失败处理，不静默当成功。 */
export function mapTaskStatus(raw: unknown): AsrTaskStatus {
  const value = asText(raw).trim().toUpperCase();
  switch (value) {
    case 'PENDING':
      return 'pending';
    case 'RUNNING':
      return 'running';
    case 'SUCCEEDED':
    case 'SUCCESS':
      return 'succeeded';
    default:
      // CANCELED / UNKNOWN / FAILED / 空值都归为失败：宁可让用户看到失败，
      // 也不要把未知状态当成还在跑而无限轮询。
      return 'failed';
  }
}

export interface AsrSubmitResult {
  taskId: string;
  status: AsrTaskStatus;
}

/** 提交任务的响应。拿不到 task_id 视为提交失败。 */
export function mapSubmitResponse(raw: unknown): AsrSubmitResult | null {
  const root = asRecord(raw);
  const output = asRecord(root?.output) ?? root;
  const taskId = asText(output?.task_id).trim();
  if (!taskId) return null;
  return { taskId, status: mapTaskStatus(output?.task_status) };
}

export interface AsrPollResult {
  status: AsrTaskStatus;
  /** 成功时的结果下载地址；有效期 24 小时 */
  transcriptionUrl: string | null;
  /** 失败原因，已限长 */
  errorMessage: string | null;
}

const MAX_ERROR_CHARS = 300;

function readErrorMessage(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const text = asText(candidate).trim();
    if (text) return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
  }
  return null;
}

/**
 * 轮询响应。成功但拿不到下载地址时判为失败——没有结果的"成功"对调用方毫无意义，
 * 让它继续往下走只会在读取阶段炸得更难定位。
 */
export function mapPollResponse(raw: unknown): AsrPollResult {
  const root = asRecord(raw);
  const output = asRecord(root?.output) ?? root;
  const status = mapTaskStatus(output?.task_status);
  const error = readErrorMessage(output?.message, output?.code, root?.message, root?.code);

  if (status !== 'succeeded') {
    return { status, transcriptionUrl: null, errorMessage: status === 'failed' ? error ?? '转写任务失败' : null };
  }

  // 结果地址可能直接挂在 output 上，也可能在 results[] 的第一项里。
  const direct = asText(output?.transcription_url).trim();
  const fromResults = asArray(output?.results)
    .map((item) => asText(asRecord(item)?.transcription_url).trim())
    .find(Boolean);
  const url = direct || fromResults || '';
  if (!url) {
    return { status: 'failed', transcriptionUrl: null, errorMessage: '转写完成但没有返回结果地址' };
  }
  return { status: 'succeeded', transcriptionUrl: url, errorMessage: null };
}

function mapSentence(raw: unknown): TranscriptSentence | null {
  const item = asRecord(raw);
  if (!item) return null;
  const text = asText(item.text).trim();
  if (!text) return null;
  const beginMs = asMs(item.begin_time) ?? 0;
  const endMs = asMs(item.end_time) ?? beginMs;
  return {
    beginMs,
    // 供应商偶发 end < begin 时按零长句处理，不让负数流进格式化层。
    endMs: Math.max(beginMs, endMs),
    text,
    ...(asSpeakerId(item.speaker_id) ? { speakerId: asSpeakerId(item.speaker_id)! } : {}),
  };
}

/** 从多种可能的外层结构里取出句子数组。 */
function collectSentences(raw: unknown): unknown[] {
  const root = asRecord(raw);
  if (!root) return [];
  // 形态一：{ transcripts: [ { sentences: [...] } ] }，多声道时每个声道一项。
  const fromTranscripts = asArray(root.transcripts).flatMap((entry) =>
    asArray(asRecord(entry)?.sentences),
  );
  if (fromTranscripts.length) return fromTranscripts;
  // 形态二：{ sentences: [...] }
  const direct = asArray(root.sentences);
  if (direct.length) return direct;
  // 形态三：整个响应就是句子数组
  return asArray(raw);
}

/**
 * 结果 JSON → 内部表示。句子按开始时间排序：多声道合并后顺序不保证。
 * 空结果（全静音）是合法输入，返回零句而不是报错。
 */
export function mapTranscriptionPayload(raw: unknown): TranscriptResult {
  const sentences = collectSentences(raw)
    .map(mapSentence)
    .filter((item): item is TranscriptSentence => item !== null)
    .sort((a, b) => a.beginMs - b.beginMs || a.endMs - b.endMs);

  const speakers = new Set<string>();
  let durationMs = 0;
  for (const sentence of sentences) {
    if (sentence.speakerId) speakers.add(sentence.speakerId);
    if (sentence.endMs > durationMs) durationMs = sentence.endMs;
  }

  return { sentences, durationMs, speakerCount: speakers.size };
}
