/**
 * 腾讯云「录音文件识别极速版」客户端。
 *
 * **供应商概念只到这里为止**：签名、`flash_result`、`engine_type`、错误码
 * 一律不外泄，对上只暴露"给一段音频，拿回句子数组"。
 *
 * 同步接口：一次 POST 直接拿结果，没有任务 id、没有轮询、没有跨重启恢复。
 * 唯一需要外部配合的是取消——请求可能持续几十秒，`AbortSignal` 必须贯穿到底。
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_ASR_ENGINE,
  validateAudioSource,
  type AsrEngineType,
  type TranscriptResult,
} from './asr-contract';
import { mapFlashResult, readAsrFailure, readFlashPlainText } from './asr-mapping';
import { signFlashRequest } from './tencent-flash-signature';

/** 固定用独立的 ArrayBuffer：请求体要交给 fetch，SharedArrayBuffer 视图不被 BodyInit 接受。 */
export type AudioBytes = Uint8Array<ArrayBuffer>;

export interface TencentAsrCredentials {
  secretId: string;
  secretKey: string;
  /** 纯数字，拼在请求路径里；不是 SecretId，也不是账号ID */
  appId: string;
}

/** 便于测试注入；生产用全局 fetch。 */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: AudioBytes;
  signal?: AbortSignal;
}) => Promise<{ status: number; text: () => Promise<string> }>;

export interface TranscribeAudioInput {
  audio: AudioBytes;
  /** 小写扩展名，含点，用于推导 voice_format */
  extension: string;
  engineType?: AsrEngineType;
  /** 默认开启；关闭时结果不含说话人 */
  diarization?: boolean;
  credentials: TencentAsrCredentials;
  signal?: AbortSignal;
  now?: () => number;
  fetchImpl?: FetchLike;
  /**
   * 诊断钩子：拿到未解析的原始报文。用于排查供应商结构变化——
   * 那类问题的症状是"转写出空结果"，没有原文根本无从查起。
   * **原文含录音正文**，调用方负责别把它写进仓库或日志。
   */
  onRawBody?: (body: string) => void;
}

export interface TranscribeAudioResult extends TranscriptResult {
  /** 整通音频的纯文本，供预览用；逐字稿正文以 sentences 为准 */
  plainText: string;
  /** 音频内容 SHA-256，作幂等键 */
  sourceHash: string;
  engineType: string;
  diarization: boolean;
}

/** 取消时抛出它，调用方据此区分"用户取消"与"真失败"，不要记成错误。 */
export class TranscriptionCancelledError extends Error {
  constructor() {
    super('转写已取消');
    this.name = 'TranscriptionCancelledError';
  }
}

export class TranscriptionFailedError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly requestId: string | null,
    /** true 表示重试有意义（负载、抖动、超时一类） */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TranscriptionFailedError';
  }
}

/**
 * 供应商错误码 → 人话。原始 message 形如
 * `service not opened||innererr=...`，直接抛给用户没人看得懂。
 * 未知码保留码值与 requestId，便于用户提工单时有据可依。
 */
export function describeAsrError(code: number, requestId: string | null): { message: string; retryable: boolean } {
  const withId = (text: string) => (requestId ? `${text}（请求 ID ${requestId}）` : text);
  switch (code) {
    case 4001:
      return { message: withId('转写参数不合法，请确认音频格式与所选引擎匹配'), retryable: false };
    case 4002:
      return { message: withId('鉴权失败，请检查「设置 → 语音」里的 SecretId / SecretKey 是否正确'), retryable: false };
    case 4003:
      return {
        message: withId('腾讯云语音识别服务未开通。注意「录音文件识别」与「录音文件识别极速版」需要分别开通'),
        retryable: false,
      };
    case 4004:
      return { message: withId('转写额度已用尽，请在腾讯云控制台开通后付费或购买资源包'), retryable: false };
    case 4005:
      return { message: withId('腾讯云账户欠费已停服，请充值后重试'), retryable: false };
    case 4006:
      return { message: withId('并发超限，请稍后重试'), retryable: true };
    case 4007:
      return { message: withId('音频解码失败，文件可能已损坏，或扩展名与实际编码不符'), retryable: false };
    case 4008:
    case 4009:
      return { message: withId('音频上传中断，请检查网络后重试'), retryable: true };
    case 4011:
      return { message: withId('音频数据过大，请先分段'), retryable: false };
    case 4012:
      return { message: withId('音频数据为空'), retryable: false };
    case 5001:
    case 5002:
    case 5003:
      return { message: withId('识别服务暂时不可用，请稍后重试'), retryable: true };
    default:
      return { message: withId(`转写失败（错误码 ${code}）`), retryable: false };
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new TranscriptionCancelledError();
}

export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  const validation = validateAudioSource({
    extension: input.extension,
    sizeBytes: input.audio.byteLength,
  });
  if (!validation.ok) throw new TranscriptionFailedError(validation.reason, 0, null, false);

  throwIfAborted(input.signal);

  const engineType = input.engineType ?? DEFAULT_ASR_ENGINE;
  const diarization = input.diarization ?? true;
  const now = input.now?.() ?? Date.now();

  const signed = signFlashRequest({
    secretId: input.credentials.secretId,
    secretKey: input.credentials.secretKey,
    appId: input.credentials.appId,
    timestampSeconds: Math.floor(now / 1000),
    params: {
      engine_type: engineType,
      voice_format: validation.voiceFormat,
      speaker_diarization: diarization ? 1 : 0,
      // 多声道时只认第一条，与说话人分离的前提一致
      first_channel_only: 1,
      word_info: 0,
    },
  });

  const doFetch = input.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);

  let status: number;
  let raw: string;
  try {
    const response = await doFetch(signed.url, {
      method: 'POST',
      headers: {
        Authorization: signed.authorization,
        'Content-Type': 'application/octet-stream',
      },
      body: input.audio,
      signal: input.signal,
    });
    status = response.status;
    raw = await response.text();
    input.onRawBody?.(raw);
  } catch (error) {
    // fetch 在 abort 时抛 AbortError；也可能是断网。前者不是失败。
    if (input.signal?.aborted) throw new TranscriptionCancelledError();
    throw new TranscriptionFailedError(
      `无法连接语音识别服务：${error instanceof Error ? error.message : String(error)}`,
      0,
      null,
      true,
    );
  }

  throwIfAborted(input.signal);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 网关错误、限流页面等会返回非 JSON；带上 HTTP 状态才定位得了
    throw new TranscriptionFailedError(`语音识别服务返回了无法解析的内容（HTTP ${status}）`, 0, null, true);
  }

  // 实测：服务未开通时 HTTP 依然是 200，错误只在顶层 code。
  // 因此必须先看业务码，不能用 HTTP 状态判断成败。
  const failure = readAsrFailure(parsed);
  if (failure) {
    const described = describeAsrError(failure.code, failure.requestId);
    throw new TranscriptionFailedError(described.message, failure.code, failure.requestId, described.retryable);
  }

  const result = mapFlashResult(parsed);
  return {
    ...result,
    plainText: readFlashPlainText(parsed),
    sourceHash: createHash('sha256').update(input.audio).digest('hex'),
    engineType,
    diarization,
  };
}
