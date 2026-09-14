/**
 * 录音转写的端点推导与轮询节奏。纯函数，不读设置、不发请求。
 *
 * 端点与 chat base URL 同源（`{workspace}.cn-beijing.maas.aliyuncs.com`），
 * 沿用 `config/voice.ts` 里 `deriveTtsEndpointFromModelBaseUrl` 的同款推导，
 * 不要求用户再填一个地址。
 */

const SUBMIT_PATH = '/api/v1/services/audio/asr/transcription';
const TASK_PATH = '/api/v1/tasks';

/** 官方公共域名；工作空间专属域名推导失败时的兜底。 */
export const DEFAULT_ASR_ORIGIN = 'https://dashscope.aliyuncs.com';

/** 从 OpenAI 兼容的 chat base URL 推导工作空间 origin。推导不出返回 null。 */
export function deriveAsrOriginFromModelBaseUrl(baseUrl: string): string | null {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  const workspaceMatch = normalized.match(
    /^(https:\/\/[^/]+\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com)/,
  );
  if (workspaceMatch) return workspaceMatch[1];
  const dashscopeMatch = normalized.match(/^(https:\/\/dashscope[^/]*\.aliyuncs\.com)/i);
  if (dashscopeMatch) return dashscopeMatch[1];
  return null;
}

/** 用户可能把提交地址整条粘进来；统一归一成 origin。 */
export function normalizeAsrOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  const origin = trimmed.match(/^(https?:\/\/[^/]+)/i)?.[1];
  return origin ?? '';
}

export function asrSubmitUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}${SUBMIT_PATH}`;
}

export function asrTaskUrl(origin: string, taskId: string): string {
  const id = encodeURIComponent(taskId.trim());
  if (!id) throw new Error('缺少转写任务 id');
  return `${origin.replace(/\/$/, '')}${TASK_PATH}/${id}`;
}

/** 首次轮询前的等待：再快的任务也要几秒，立刻查一次只是浪费一次请求。 */
export const POLL_INITIAL_DELAY_MS = 3_000;
export const POLL_MAX_DELAY_MS = 30_000;
/** 总时长上限：12 小时音频的转写远快于此；到点仍未收口按失败处理并保留 task_id。 */
export const POLL_GIVE_UP_AFTER_MS = 60 * 60 * 1000;

/**
 * 指数退避，封顶 30 秒。
 * 不做成固定间隔：短音频几秒就好，长音频不该每秒骚扰一次接口
 * （官方轮询默认 20 QPS，多个任务同时恢复时容易触顶）。
 */
export function nextPollDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const delay = POLL_INITIAL_DELAY_MS * 2 ** Math.min(safeAttempt, 10);
  return Math.min(delay, POLL_MAX_DELAY_MS);
}

export function shouldGiveUpPolling(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= POLL_GIVE_UP_AFTER_MS;
}

/** base64 data URI。分离出来是为了让请求体构造可测，不必真的造一个上百 MB 的串。 */
export function toAudioDataUri(base64: string, mime: string): string {
  if (!base64) throw new Error('音频内容为空');
  if (!mime) throw new Error('缺少音频 MIME 类型');
  return `data:${mime};base64,${base64}`;
}
