import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { getEmbeddingModelName } from '../models/embedding-config';
import { splitIntoChunks } from './chunker';
import { embedTexts } from './embedding';
import {
  computeContentHash,
  findDocumentByContentHash,
  insertDocumentWithChunks,
  type DocumentInfo,
} from './documents';
import { serializeEmbedding } from './vector';
import {
  assertPathWithinKnowledge,
  getKnowledgeDir,
  sanitizeKnowledgeFilename,
} from './knowledge-path';

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'done'; document: DocumentInfo }
  | { phase: 'skipped'; document: DocumentInfo; reason: string };

export interface ImportTextOptions {
  skipHashDedup?: boolean;
}

export async function importTextAsKnowledge(
  text: string,
  filename: string,
  onProgress?: (p: ImportProgress) => void,
  options?: ImportTextOptions,
): Promise<DocumentInfo> {
  const normalized = text.trim();
  if (!normalized) throw new Error('内容为空');

  onProgress?.({ phase: 'reading' });

  const contentHash = computeContentHash(normalized);
  if (!options?.skipHashDedup) {
    const existing = findDocumentByContentHash(contentHash);
    if (existing) {
      onProgress?.({
        phase: 'skipped',
        document: existing,
        reason: '相同内容已导入',
      });
      return existing;
    }
  }

  const chunks = splitIntoChunks(normalized, filename);
  if (!chunks.length) throw new Error('内容为空');

  onProgress?.({ phase: 'chunking', chunkCount: chunks.length });

  await fs.mkdir(getKnowledgeDir(), { recursive: true });
  const safeName = sanitizeKnowledgeFilename(filename);
  const destPath = path.join(getKnowledgeDir(), `${Date.now()}_${safeName}`);
  assertPathWithinKnowledge(destPath);
  await fs.writeFile(destPath, normalized, 'utf8');

  const relativePath = path.relative(getWorkspaceDir(), destPath).replace(/\\/g, '/');
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = ext === '.md' ? 'text/markdown' : 'text/plain';

  const BATCH = 10;
  const embeddedChunks: Array<{ content: string; embedding: Uint8Array }> = [];
  let embeddingDim = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedTexts(batch);
    for (let j = 0; j < batch.length; j++) {
      embeddingDim = vectors[j].length;
      embeddedChunks.push({
        content: batch[j],
        embedding: serializeEmbedding(vectors[j]),
      });
    }
    onProgress?.({
      phase: 'embedding',
      done: Math.min(i + batch.length, chunks.length),
      total: chunks.length,
    });
  }

  const doc = insertDocumentWithChunks({
    filename: safeName,
    filepath: relativePath,
    mimeType,
    chunks: embeddedChunks,
    contentHash,
    embeddingModel: getEmbeddingModelName(),
    embeddingDim,
  });

  onProgress?.({ phase: 'done', document: doc });
  return doc;
}
