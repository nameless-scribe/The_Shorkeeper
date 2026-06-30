import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { splitTextIntoChunks } from './chunker';
import { embedTexts } from './embedding';
import { insertDocumentWithChunks, type DocumentInfo } from './documents';
import { serializeEmbedding } from './vector';

const KNOWLEDGE_DIR = () => path.join(getWorkspaceDir(), 'knowledge');

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'done'; document: DocumentInfo };

export async function importTextAsKnowledge(
  text: string,
  filename: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<DocumentInfo> {
  const normalized = text.trim();
  if (!normalized) throw new Error('内容为空');

  onProgress?.({ phase: 'reading' });

  const chunks = splitTextIntoChunks(normalized);
  if (!chunks.length) throw new Error('内容为空');

  onProgress?.({ phase: 'chunking', chunkCount: chunks.length });

  await fs.mkdir(KNOWLEDGE_DIR(), { recursive: true });
  const safeName = filename.replace(/[<>:"|?*\\]/g, '_').trim() || 'knowledge.md';
  const destPath = path.join(KNOWLEDGE_DIR(), `${Date.now()}_${safeName}`);
  await fs.writeFile(destPath, normalized, 'utf8');

  const relativePath = path.relative(getWorkspaceDir(), destPath).replace(/\\/g, '/');
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = ext === '.md' ? 'text/markdown' : 'text/plain';

  const BATCH = 10;
  const embeddedChunks: Array<{ content: string; embedding: Uint8Array }> = [];

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedTexts(batch);
    for (let j = 0; j < batch.length; j++) {
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
  });

  onProgress?.({ phase: 'done', document: doc });
  return doc;
}
