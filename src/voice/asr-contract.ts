/**
 * P4.0 录音转写契约：内部统一表示、固定常量与幂等键。
 *
 * 这一层之上（工具、技能、UI）不应出现任何供应商概念——`task_id`、`file_urls`、
 * `X-DashScope-Async`、轮询等一律封在 `bailian-file-asr.ts` 内部。
 * 理由见 P4 计划第 3 节：同步与异步本就是两条不同路径，上层不该知道走的是哪条。
 *
 * 不依赖 Electron、数据库与网络。
 */

/** 选定模型，依据见 P4 计划 2.4：覆盖 5 秒到 12 小时，支持说话人分离，且单价最低。 */
export const ASR_FILE_MODEL = 'paraformer-v2';

/** 供应商上限（异步文件转写）。 */
export const PROVIDER_MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
export const PROVIDER_MAX_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * 本项目自设上限，**明显低于供应商上限**。
 * base64 内联会把请求体放大约 4/3：100 MB 音频对应约 133 MB 请求体，已经偏大。
 * 按 64 kbps 的 m4a 估算，100 MB 约等于 3.5 小时录音，对个人会议场景足够。
 */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** 开启说话人分离时官方建议不超过 2 小时；超过只告警，不阻止。 */
export const DIARIZATION_RECOMMENDED_MAX_MS = 2 * 60 * 60 * 1000;

/**
 * 允许上传的音频扩展名。这是**本项目的白名单**，不等于供应商支持的全集——
 * 宁可少收几种，也不要把不确定能转的文件放进来再失败。
 */
export const AUDIO_EXTENSION_MIME: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

export const AUDIO_EXTENSIONS: readonly string[] = Object.keys(AUDIO_EXTENSION_MIME);

/** 逐字稿里超过这个间隔才标注停顿；低于它的自然停顿不值得打断阅读。 */
export const TRANSCRIPT_GAP_MARK_MS = 60 * 1000;

/** 同一说话人连续发言合并时，间隔超过这个值就断开成新段落。 */
export const TRANSCRIPT_MERGE_MAX_GAP_MS = 10 * 1000;

/** 一句话的内部表示。时间一律毫秒，与供应商字段名解耦。 */
export interface TranscriptSentence {
  beginMs: number;
  endMs: number;
  text: string;
  /** 仅在开启说话人分离且供应商确实返回时存在 */
  speakerId?: string;
}

export interface TranscriptResult {
  sentences: TranscriptSentence[];
  /** 由最后一句的 endMs 推导：供应商不保证给出总时长 */
  durationMs: number;
  /** 去重后的说话人数；未开启分离时为 0 */
  speakerCount: number;
}

export type AsrTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** 任务尚未收口，需要继续轮询。 */
export function isAsrTaskPending(status: AsrTaskStatus): boolean {
  return status === 'pending' || status === 'running';
}

export interface AudioSourceInfo {
  /** 小写扩展名，含点 */
  extension: string;
  sizeBytes: number;
  /** 已知时才传；提交前通常未知 */
  durationMs?: number;
  /** 已知时才传；分离仅支持单声道 */
  channels?: number;
}

export type AudioValidation =
  | { ok: true; mime: string; warnings: string[] }
  | { ok: false; reason: string };

/**
 * 提交前校验。失败原因面向用户，不暴露供应商术语。
 * 能继续但有代价的情况走 `warnings`，不阻断。
 */
export function validateAudioSource(
  input: AudioSourceInfo,
  options: { diarization?: boolean } = {},
): AudioValidation {
  const extension = input.extension.trim().toLowerCase();
  const mime = AUDIO_EXTENSION_MIME[extension];
  if (!mime) {
    return { ok: false, reason: `不支持的音频格式 ${extension || '(缺少扩展名)'}；支持 ${AUDIO_EXTENSIONS.join(' / ')}` };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: '音频文件为空' };
  }
  if (input.sizeBytes > MAX_AUDIO_BYTES) {
    const limitMb = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);
    const actualMb = Math.round(input.sizeBytes / 1024 / 1024);
    return { ok: false, reason: `音频 ${actualMb} MB，超过单次 ${limitMb} MB 上限；请先分段` };
  }
  if (input.durationMs != null && input.durationMs > PROVIDER_MAX_DURATION_MS) {
    return { ok: false, reason: '音频超过 12 小时上限；请先分段' };
  }

  const warnings: string[] = [];
  if (options.diarization) {
    if (input.channels != null && input.channels > 1) {
      warnings.push('说话人分离只支持单声道，本次将不做分离');
    }
    if (input.durationMs != null && input.durationMs > DIARIZATION_RECOMMENDED_MAX_MS) {
      warnings.push('超过 2 小时的录音开启说话人分离时准确率可能下降');
    }
  }
  return { ok: true, mime, warnings };
}

/** 分离只在确定是单声道时才真正开启：声道未知时保守关闭，避免拿到不可用的结果。 */
export function shouldEnableDiarization(requested: boolean, channels?: number): boolean {
  if (!requested) return false;
  return channels === 1;
}

/**
 * 幂等键。带上模型与是否分离：同一个文件在不同设置下的转写结果不同，
 * 不能互相复用，否则用户打开分离后拿到的还是旧的无分离结果。
 */
export const asrIdempotencyKeys = {
  transcript: (sourceHash: string, model: string, diarization: boolean) =>
    `asr:${sourceHash}:${model}:${diarization ? 'diar' : 'plain'}`,
} as const;
