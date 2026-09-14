/**
 * 腾讯云「录音文件识别极速版」响应 → 内部表示的纯映射。不发请求、不读配置。
 *
 * **结构来自 2026-09-13 的一次真实调用**，不是照文档猜的，因此这里
 * **只按实测结构解析，不预设兼容分支**——多形态兼容只会把结构变化
 * 掩盖成"转写出空结果"这种最难查的症状。真实响应形如：
 *
 * ```
 * { request_id, code: 0, message: "", audio_duration: 612137,
 *   flash_result: [ { text, channel_id: 0, sentence_list: [
 *     { text, start_time, end_time, speaker_id, emotional_energy, speech_speed, lang_type } ] } ] }
 * ```
 *
 * 注意与百炼的差异（P4.0 曾按百炼文档写过一版）：数组叫 `flash_result` 不是
 * `transcripts`，句子数组叫 `sentence_list` 不是 `sentences`，起始时间叫
 * `start_time` 不是 `begin_time`，`speaker_id` 是数字，总时长顶层直接给。
 */
import type { TranscriptResult, TranscriptSentence } from './asr-contract';

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

function asMs(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num >= 0 ? num : null;
}

/** 分离关闭时该字段不出现；开启时是从 0 开始的数字。统一成字符串。 */
function asSpeakerId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

const MAX_ERROR_CHARS = 300;

function truncateError(text: string): string {
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

export interface AsrFailure {
  /** 供应商错误码；0 表示成功 */
  code: number;
  message: string;
  requestId: string | null;
}

/**
 * 读取业务错误。极速版把 `code` 放在**顶层**（不像标准云 API 包在 `Response` 里），
 * HTTP 200 也可能带着非零 code——因此不能只看 HTTP 状态。
 * 返回 null 表示成功。
 */
export function readAsrFailure(raw: unknown): AsrFailure | null {
  const root = asRecord(raw);
  if (!root) return { code: -1, message: '响应不是合法的 JSON 对象', requestId: null };
  const requestId = asText(root.request_id).trim() || null;
  const code = asMs(root.code);
  if (code === 0) return null;
  const message = asText(root.message).trim();
  return {
    code: code ?? -1,
    // 供应商的 message 形如 "service not opened||innererr=..."，原样给出去太难懂，
    // 但也不能吞掉——调用方负责翻译成人话，这里只保证限长。
    message: truncateError(message || '转写失败，供应商未给出原因'),
    requestId,
  };
}

function mapSentence(raw: unknown): TranscriptSentence | null {
  const item = asRecord(raw);
  if (!item) return null;
  const text = asText(item.text).trim();
  if (!text) return null;
  const beginMs = asMs(item.start_time) ?? 0;
  const endMs = asMs(item.end_time) ?? beginMs;
  const speakerId = asSpeakerId(item.speaker_id);
  return {
    beginMs,
    // 供应商偶发 end < begin 时按零长句处理，不让负数流进格式化层
    endMs: Math.max(beginMs, endMs),
    text,
    ...(speakerId !== undefined ? { speakerId } : {}),
  };
}

/**
 * 成功响应 → 内部表示。
 *
 * `flash_result` 是按声道分的数组：开启 `first_channel_only` 时只有一项，
 * 多声道时会有多项，合并后按开始时间重排——否则第二声道的内容会整段排在末尾。
 *
 * 空结果（全静音）是合法输入，返回零句而不是报错。
 */
export function mapFlashResult(raw: unknown): TranscriptResult {
  const root = asRecord(raw);
  const sentences = asArray(root?.flash_result)
    .flatMap((channel) => asArray(asRecord(channel)?.sentence_list))
    .map(mapSentence)
    .filter((item): item is TranscriptSentence => item !== null)
    .sort((a, b) => a.beginMs - b.beginMs || a.endMs - b.endMs);

  const speakers = new Set<string>();
  let lastEndMs = 0;
  for (const sentence of sentences) {
    if (sentence.speakerId !== undefined) speakers.add(sentence.speakerId);
    if (sentence.endMs > lastEndMs) lastEndMs = sentence.endMs;
  }

  // 顶层 audio_duration 是音频真实长度，比"最后一句的结束时间"更准
  // （结尾若是静音，两者能差出好几秒）；缺失时才退回推导值。
  const reported = asMs(root?.audio_duration);
  return {
    sentences,
    durationMs: reported ?? lastEndMs,
    speakerCount: speakers.size,
    requestId: asText(root?.request_id).trim() || null,
  };
}

/** 整通音频的纯文本，取各声道的 `text` 拼接。供"前 200 字预览"之类的场景用。 */
export function readFlashPlainText(raw: unknown): string {
  return asArray(asRecord(raw)?.flash_result)
    .map((channel) => asText(asRecord(channel)?.text).trim())
    .filter(Boolean)
    .join('\n');
}
