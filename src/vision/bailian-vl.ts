/**
 * 百炼视觉模型客户端（P8.0，计划 §2.2）：OpenAI 兼容 chat/completions，图片以 data URL 放在 content[] 里，
 * 关闭思考模式，不流式，一次拿完；30 秒超时，取消传播；请求 ID 与 usage 一并返回。
 * fetch 可注入，测试用假服务器。
 */
import { awaitWithAbort, createLinkedTimeoutSignal } from '../agent/abort';
import { buildVisionPrompt, DEFAULT_MAX_TOKENS, READ_TEXT_MAX_TOKENS, VISION_TIMEOUT_MS, type VisionMode } from './contract';

export interface VisionEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VisionRequest {
  images: Array<{ name: string; dataUrl: string }>;
  question: string;
  mode: VisionMode;
  endpoint: VisionEndpoint;
  maxTokens?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface VisionResponse {
  answer: string;
  requestId: string | null;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export class VisionRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'timeout' | 'cancelled' | 'malformed' | 'network',
    readonly status?: number,
    readonly requestId?: string | null,
  ) {
    super(message);
    this.name = 'VisionRequestError';
  }
}

export function buildVisionRequestBody(request: Pick<VisionRequest, 'images' | 'question' | 'mode' | 'maxTokens'> & { model: string }): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: buildVisionPrompt(request.mode, request.question) }];
  for (const image of request.images) content.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  return {
    model: request.model,
    messages: [{ role: 'user', content }],
    stream: false,
    max_tokens: request.maxTokens ?? (request.mode === 'read_text' ? READ_TEXT_MAX_TOKENS : DEFAULT_MAX_TOKENS),
    // 看图回答不需要长推理；思考 token 按输出计费（§2.2）。兼容模式若不接受该参数，探针会发现
    enable_thinking: false,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

interface ChatCompletionLike {
  id?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { message?: unknown; code?: unknown };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('');
  }
  return '';
}

export async function askVisionModel(request: VisionRequest): Promise<VisionResponse> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeout = createLinkedTimeoutSignal(request.signal, request.timeoutMs ?? VISION_TIMEOUT_MS);
  const url = `${normalizeBaseUrl(request.endpoint.baseUrl)}/chat/completions`;
  let response: Response;
  try {
    response = await awaitWithAbort(
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.endpoint.apiKey}` },
        body: JSON.stringify(buildVisionRequestBody({ ...request, model: request.endpoint.model })),
        signal: timeout.signal,
      }),
      timeout.signal,
    );
  } catch (error) {
    timeout.dispose();
    if (timeout.didTimeout()) throw new VisionRequestError(`视觉模型 ${Math.round((request.timeoutMs ?? VISION_TIMEOUT_MS) / 1000)} 秒没有回应`, 'timeout');
    if (request.signal?.aborted) throw new VisionRequestError('已取消', 'cancelled');
    throw new VisionRequestError(`连不上视觉模型：${error instanceof Error ? error.message : String(error)}`, 'network');
  }
  try {
    const requestId = response.headers?.get?.('x-request-id') ?? null;
    const text = await awaitWithAbort(response.text(), timeout.signal);
    let data: ChatCompletionLike = {};
    try {
      data = JSON.parse(text) as ChatCompletionLike;
    } catch {
      if (response.ok) throw new VisionRequestError('视觉模型返回的不是 JSON', 'malformed', response.status, requestId);
    }
    const bodyId = typeof data.id === 'string' ? data.id : null;
    if (!response.ok) {
      const message = typeof data.error?.message === 'string' ? data.error.message : text.slice(0, 200);
      const code = typeof data.error?.code === 'string' ? `（${data.error.code}）` : '';
      throw new VisionRequestError(`视觉模型返回 ${response.status}${code}：${message}`, 'http', response.status, requestId ?? bodyId);
    }
    const answer = textFromContent(data.choices?.[0]?.message?.content).trim();
    if (!answer) throw new VisionRequestError('视觉模型没有返回文字', 'malformed', response.status, requestId ?? bodyId);
    const prompt = Number(data.usage?.prompt_tokens);
    const completion = Number(data.usage?.completion_tokens);
    return {
      answer,
      requestId: requestId ?? bodyId,
      model: request.endpoint.model,
      promptTokens: Number.isFinite(prompt) ? prompt : null,
      completionTokens: Number.isFinite(completion) ? completion : null,
    };
  } catch (error) {
    if (error instanceof VisionRequestError) throw error;
    if (timeout.didTimeout()) throw new VisionRequestError('读取视觉模型响应超时', 'timeout');
    if (request.signal?.aborted) throw new VisionRequestError('已取消', 'cancelled');
    throw new VisionRequestError(`读取视觉模型响应失败：${error instanceof Error ? error.message : String(error)}`, 'network');
  } finally {
    timeout.dispose();
  }
}
