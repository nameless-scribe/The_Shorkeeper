import { embedText } from './embedding';
import { loadAllChunkEmbeddings } from './documents';
import { topKBySimilarity } from './vector';

export interface RetrievedChunk {
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
}

const MIN_SCORE = 0.35;

export async function retrieveRelevantChunks(
  query: string,
  limit = 5,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const stored = loadAllChunkEmbeddings();
  if (!stored.length) return [];

  const queryVec = new Float32Array(await embedText(trimmed));
  const hits = topKBySimilarity(
    queryVec,
    stored.map((s) => ({ data: s, embedding: s.embedding })),
    limit,
  );

  return hits
    .filter((h) => h.score >= MIN_SCORE)
    .map((h) => ({
      documentId: h.item.documentId,
      filename: h.item.filename,
      chunkIndex: h.item.chunkIndex,
      content: h.item.content,
      score: h.score,
    }));
}

export function formatRagForPrompt(chunks: RetrievedChunk[]): string | null {
  if (!chunks.length) return null;

  const body = chunks
    .map(
      (c, i) =>
        `<ref index="${i + 1}" source="${c.filename}" score="${c.score.toFixed(2)}">\n${c.content}\n</ref>`,
    )
    .join('\n\n');

  return `【参考文档】\n以下是从用户导入文档中检索到的相关片段，回答时请优先依据这些内容，并注明来源文件名：\n\n<reference>\n${body}\n</reference>`;
}
