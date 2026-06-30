import { embedText } from './embedding';
import { listDocuments, loadAllChunkEmbeddings, type DocumentInfo } from './documents';
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

  let filtered = hits.filter((h) => h.score >= MIN_SCORE);
  if (!filtered.length && hits.length) {
    filtered = hits.slice(0, limit);
  }

  return filtered.map((h) => ({
      documentId: h.item.documentId,
      filename: h.item.filename,
      chunkIndex: h.item.chunkIndex,
      content: h.item.content,
      score: h.score,
    }));
}

export function formatDocumentCatalogForPrompt(documents: DocumentInfo[]): string | null {
  if (!documents.length) return null;

  const lines = documents.map(
    (d, i) =>
      `${i + 1}. ${d.filename}（${d.chunkCount} 个文本块，导入于 ${new Date(d.importedAt).toLocaleString('zh-CN')}）`,
  );

  return (
    '【已导入知识库】\n' +
    '以下文档可供 search_knowledge 检索；回答业务/需求问题时请依据检索结果，勿声称没有知识库：\n\n' +
    lines.join('\n')
  );
}

export function formatRagChunksForTool(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.filename}#${c.chunkIndex} (相关度 ${c.score.toFixed(2)})\n${c.content}`,
    )
    .join('\n\n');
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
