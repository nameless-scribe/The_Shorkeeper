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

export async function embedTexts(
  texts: string[],
  options?: { signal?: AbortSignal },
): Promise<number[][]> {
  const trimmed = texts.map((t) => t.trim()).filter(Boolean);
  if (!trimmed.length) return [];

  const config = loadEmbeddingConfig();
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: trimmed,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Embeddings API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as EmbeddingsResponse;
  const vectors = data.data?.map((d) => d.embedding).filter(Boolean) as number[][];
  if (!vectors?.length || vectors.length !== trimmed.length) {
    throw new Error('Embeddings API 返回格式异常');
  }
  return vectors;
}

export async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const [vec] = await embedTexts([text], { signal });
  return vec;
}
