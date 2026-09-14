/**
 * P4 录音转写契约：内部统一表示、固定常量与幂等键。
 *
 * 这一层之上（工具、技能、UI）不应出现任何供应商概念——签名、`flash_result`、
 * `engine_type` 等一律封在 `tencent-*.ts` 内部。
 *
 * 常量与上限取自 2026-09-13 对腾讯云「录音文件识别极速版」的真实调用，
 * 不是照文档抄的，见 P4 计划 10.4。
 *
 * 不依赖 Electron、数据库与网络。
 */

/** 引擎类型。中文会议用 16k_zh；电话线路录音用 8k_zh；中英混说用 16k_zh_en。 */
export const ASR_ENGINE_TYPES = ['16k_zh', '16k_zh_en', '8k_zh'] as const;
export type AsrEngineType = (typeof ASR_ENGINE_TYPES)[number];
export const DEFAULT_ASR_ENGINE: AsrEngineType = '16k_zh';

/** 极速版硬上限。与"本项目自设上限"是同一个值，因此没有第二道阈值。 */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * 扩展名 → 接口要求的 `voice_format` 取值。
 * 这是**本项目的白名单**：宁可少收几种，也不要把不确定能转的文件放进来再失败。
 */
export const VOICE_FORMAT_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.wav': 'wav',
  '.mp3': 'mp3',
  '.m4a': 'm4a',
  '.aac': 'aac',
  '.amr': 'amr',
  '.flac': 'flac',
  '.ogg': 'ogg-opus',
  '.opus': 'ogg-opus',
  '.silk': 'silk',
  '.pcm': 'pcm',
};

export const AUDIO_EXTENSIONS: readonly string[] = Object.keys(VOICE_FORMAT_BY_EXTENSION);

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
  /** 音频总时长。极速版在顶层直接给出，不需要从最后一句推导 */
  durationMs: number;
  /** 去重后的说话人数；未开启分离时为 0 */
  speakerCount: number;
}

export interface AudioSourceInfo {
  /** 小写扩展名，含点 */
  extension: string;
  sizeBytes: number;
  /** 已知时才传；提交前通常未知 */
  durationMs?: number;
}

export type AudioValidation =
  | { ok: true; voiceFormat: string; warnings: string[] }
  | { ok: false; reason: string };

/**
 * 提交前校验。失败原因面向用户，不暴露供应商术语。
 * 能继续但有代价的情况走 `warnings`，不阻断。
 */
export function validateAudioSource(input: AudioSourceInfo): AudioValidation {
  const extension = input.extension.trim().toLowerCase();
  const voiceFormat = VOICE_FORMAT_BY_EXTENSION[extension];
  if (!voiceFormat) {
    return {
      ok: false,
      reason: `不支持的音频格式 ${extension || '(缺少扩展名)'}；支持 ${AUDIO_EXTENSIONS.join(' / ')}`,
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: '音频文件为空' };
  }
  if (input.sizeBytes > MAX_AUDIO_BYTES) {
    const limitMb = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);
    const actualMb = Math.round(input.sizeBytes / 1024 / 1024);
    return { ok: false, reason: `音频 ${actualMb} MB，超过单次 ${limitMb} MB 上限；请先分段` };
  }
  if (input.durationMs != null && input.durationMs > MAX_AUDIO_DURATION_MS) {
    return { ok: false, reason: '音频超过 2 小时上限；请先分段' };
  }
  return { ok: true, voiceFormat, warnings: [] };
}

/**
 * 幂等键。带上引擎与是否分离：同一个文件在不同设置下的转写结果不同，
 * 不能互相复用，否则用户打开分离后拿到的还是旧的无分离结果。
 */
export const asrIdempotencyKeys = {
  transcript: (sourceHash: string, engineType: string, diarization: boolean) =>
    `asr:${sourceHash}:${engineType}:${diarization ? 'diar' : 'plain'}`,
} as const;
