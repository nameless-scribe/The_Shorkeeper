import {
  getEmbeddingModelName,
  loadEmbeddingConfig,
  type EmbeddingApiConfig,
} from '../models/embedding-config';
import { awaitWithAbort, createLinkedTimeoutSignal } from '../agent/abort';

/** 本地 ONNX embedding（如 bge-small-zh-v1.5）需与 chunk 向量同一模型族；见 docs/RAG-OPTIMIZATION.md §4.8 */

export function getEmbeddingModel(): string {
  return getEmbeddingModelName();
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
}

function validateVectors(vectors: unknown, expectedCount: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error('Embeddings API 返回数量异常');
  }
  let dimension: number | null = null;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Embeddings API 返回空向量');
    }
    if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('Embeddings API 返回非法向量数值');
    }
    if (dimension == null) dimension = vector.length;
    if (vector.length !== dimension) {
      throw new Error('Embeddings API 返回向量维度不一致');
    }
  }
  return vectors as number[][];
}

/** 百炼 DashScope embedding 单次 input 上限为 10 条 */
const MAX_EMBEDDING_BATCH = 10;
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const MAX_EMBEDDING_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_EMBEDDING_ERROR_BYTES = 64 * 1024;

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Embeddings API 响应超过大小上限');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('Embeddings API 响应超过大小上限');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Embeddings API 响应超过大小上限');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function requestEmbeddings(
  input: string[],
  options: { signal?: AbortSignal; config: EmbeddingApiConfig },
): Promise<number[][]> {
  const { config } = options;
  const timeout = createLinkedTimeoutSignal(options?.signal, DEFAULT_EMBEDDING_TIMEOUT_MS);
  try {
    const response = await awaitWithAbort(fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input,
      }),
      signal: timeout.signal,
    }), timeout.signal);

    if (!response.ok) {
      const text = await readResponseTextBounded(response, MAX_EMBEDDING_ERROR_BYTES);
      throw new Error(formatEmbeddingApiError(response.status, text));
    }

    const data = response.body || typeof response.text === 'function'
      ? JSON.parse(await readResponseTextBounded(response, MAX_EMBEDDING_RESPONSE_BYTES)) as EmbeddingsResponse
      : await response.json() as EmbeddingsResponse;
    return validateVectors(data.data?.map((item) => item.embedding), input.length);
  } catch (error) {
    if (timeout.didTimeout()) throw new Error('Embedding 请求超时');
    if (options?.signal?.aborted) throw new Error('已取消');
    throw error;
  } finally {
    timeout.dispose();
  }
}

export async function embedTexts(
  texts: string[],
  options?: { signal?: AbortSignal; config?: EmbeddingApiConfig },
): Promise<number[][]> {
  const trimmed = texts.map((t) => t.trim()).filter(Boolean);
  if (!trimmed.length) return [];

  // One logical embedding operation must not mix endpoints, credentials or models
  // when settings are changed while its batches are still in flight.
  const config = options?.config ?? loadEmbeddingConfig();
  const results: number[][] = [];
  let expectedDimension: number | null = null;
  for (let i = 0; i < trimmed.length; i += MAX_EMBEDDING_BATCH) {
    const batch = trimmed.slice(i, i + MAX_EMBEDDING_BATCH);
    const vectors = await requestEmbeddings(batch, { signal: options?.signal, config });
    const batchDimension = vectors[0].length;
    if (expectedDimension != null && batchDimension !== expectedDimension) {
      throw new Error('Embeddings API 分批返回的向量维度不一致');
    }
    expectedDimension = batchDimension;
    results.push(...vectors);
  }
  return results;
}

export async function embedText(
  text: string,
  signal?: AbortSignal,
  config?: EmbeddingApiConfig,
): Promise<number[]> {
  const [vec] = await embedTexts([text], { signal, config });
  return vec;
}

export function formatEmbeddingApiError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (lower.includes('batch size is invalid') || lower.includes('should not be larger than 10')) {
    return `Embeddings API ${status}：单次最多向量化 10 段文本，请重试导入（应用已自动分批，若仍报错请重启后再试）`;
  }
  if (
    status === 403 ||
    lower.includes('forbidden') ||
    lower.includes('无权') ||
    lower.includes('business space')
  ) {
    return (
      `Embeddings API ${status}：百炼业务空间无权访问。` +
      ' 请检查 Base URL 是否为「你的」接入地址（勿用文档里的 llm-xxxx 占位符），' +
      '且 API Key 与该业务空间一致。也可尝试 https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  }
  return `Embeddings API ${status}：请求失败`;
}

export async function testEmbeddingConnection(): Promise<{
  ok: boolean;
  message: string;
  dimensions?: number;
}> {
  try {
    const vectors = await embedTexts(['连接测试']);
    const dimensions = vectors[0]?.length ?? 0;
    if (!dimensions) {
      return { ok: false, message: 'Embedding 返回为空' };
    }
    return { ok: true, message: `连接成功，向量维度 ${dimensions}`, dimensions };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
