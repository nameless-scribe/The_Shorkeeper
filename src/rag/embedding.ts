import {
  getEmbeddingModelName,
  loadEmbeddingConfig,
} from '../models/embedding-config';

export function getEmbeddingModel(): string {
  return getEmbeddingModelName();
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
}

/** 百炼 DashScope embedding 单次 input 上限为 10 条 */
const MAX_EMBEDDING_BATCH = 10;

async function requestEmbeddings(
  input: string[],
  options?: { signal?: AbortSignal },
): Promise<number[][]> {
  const config = loadEmbeddingConfig();
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatEmbeddingApiError(response.status, text));
  }

  const data = (await response.json()) as EmbeddingsResponse;
  const vectors = data.data?.map((d) => d.embedding).filter(Boolean) as number[][];
  if (!vectors?.length || vectors.length !== input.length) {
    throw new Error('Embeddings API 返回格式异常');
  }
  return vectors;
}

export async function embedTexts(
  texts: string[],
  options?: { signal?: AbortSignal },
): Promise<number[][]> {
  const trimmed = texts.map((t) => t.trim()).filter(Boolean);
  if (!trimmed.length) return [];

  const results: number[][] = [];
  for (let i = 0; i < trimmed.length; i += MAX_EMBEDDING_BATCH) {
    const batch = trimmed.slice(i, i + MAX_EMBEDDING_BATCH);
    const vectors = await requestEmbeddings(batch, options);
    results.push(...vectors);
  }
  return results;
}

export async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const [vec] = await embedTexts([text], { signal });
  return vec;
}

export function formatEmbeddingApiError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (lower.includes('batch size is invalid') || lower.includes('should not be larger than 10')) {
    return `Embeddings API ${status}：单次最多向量化 10 段文本，请重试导入（应用已自动分批，若仍报错请重启后再试）`;
  }
    return (
      `Embeddings API ${status}：百炼业务空间无权访问。` +
      ' 请检查 Base URL 是否为「你的」接入地址（勿用文档里的 llm-xxxx 占位符），' +
      '且 API Key 与该业务空间一致。也可尝试 https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  }
  return `Embeddings API ${status}: ${body}`;
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
