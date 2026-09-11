import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { getEmbeddingModelName } from '../models/embedding-config';
import { CHUNK_OVERLAP, CHUNK_SIZE, splitIntoChunks } from './chunker';
import { embedText, embedTexts } from './embedding';
import { retryEmbeddingOperation } from './embedding-retry';
import {
  computeContentHash,
  findDocumentByContentHash,
  getDocument,
  getDocumentVersionPlan,
  insertDocumentWithChunks,
  replaceDocumentChunks,
  updateDocumentMeta,
  type DocumentInfo,
} from './documents';
import { generateDocumentSummary } from './summary';
import { serializeEmbedding } from './vector';
import {
  assertPathWithinKnowledge,
  getKnowledgeDir,
  sanitizeKnowledgeFilename,
} from './knowledge-path';
import {
  deriveDocumentTitle,
  normalizeDocumentSourcePath,
  normalizeDocumentTitle,
} from './document-identity';

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'retrying'; done: number; total: number; attempt: number; maxAttempts: number; error: string }
  | { phase: 'done'; document: DocumentInfo }
  | { phase: 'skipped'; document: DocumentInfo; reason: string };

export interface ImportTextOptions {
  skipHashDedup?: boolean;
  signal?: AbortSignal;
  sourcePath?: string;
  title?: string;
}

let importQueue: Promise<void> = Promise.resolve();

export function importTextAsKnowledge(
  text: string,
  filename: string,
  onProgress?: (p: ImportProgress) => void,
  options?: ImportTextOptions,
): Promise<DocumentInfo> {
  const run = importQueue.then(() =>
    importTextAsKnowledgeUnlocked(text, filename, onProgress, options),
  );
  importQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function importTextAsKnowledgeUnlocked(
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

  const textChunks = splitIntoChunks(normalized, filename);
  if (!textChunks.length) throw new Error('内容为空');

  onProgress?.({ phase: 'chunking', chunkCount: textChunks.length });

  const { summary, outline } = generateDocumentSummary(normalized, filename);

  await fs.mkdir(getKnowledgeDir(), { recursive: true });
  const safeName = sanitizeKnowledgeFilename(filename);
  const title = deriveDocumentTitle(normalized, safeName, options?.title);
  const titleKey = normalizeDocumentTitle(title);
  const sourcePath = options?.sourcePath
    ? normalizeDocumentSourcePath(options.sourcePath)
    : null;
  const versionPlan = getDocumentVersionPlan({ sourcePath, titleKey });
  const destPath = path.join(getKnowledgeDir(), `${Date.now()}_${randomUUID()}_${safeName}`);
  assertPathWithinKnowledge(destPath);
  await fs.writeFile(destPath, normalized, 'utf8');

  const relativePath = path.relative(getWorkspaceDir(), destPath).replace(/\\/g, '/');
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = ext === '.md' ? 'text/markdown' : 'text/plain';
  let pendingDocument: DocumentInfo;
  try {
    pendingDocument = insertDocumentWithChunks({
      filename: safeName,
      filepath: relativePath,
      mimeType,
      chunks: [],
      contentHash,
      status: 'importing',
      sourcePath,
      title,
      titleKey,
      version: versionPlan.version,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
  } catch (error) {
    try {
      await fs.unlink(destPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AggregateError(
          [error, cleanupError],
          `文档登记失败，且知识文件无法清理: ${destPath}`,
        );
      }
    }
    throw error;
  }

  let importedDocument: DocumentInfo;
  try {
    const docEmbedInput = `${safeName}\n${summary}`;
    const reportRetry = ({ attempt, maxAttempts, error }: {
      attempt: number;
      maxAttempts: number;
      error: string;
    }) => {
      onProgress?.({
        phase: 'retrying',
        done: 0,
        total: textChunks.length,
        attempt,
        maxAttempts,
        error,
      });
    };
    const docVec = await retryEmbeddingOperation(
      () => embedText(docEmbedInput, options?.signal),
      { signal: options?.signal, onRetry: reportRetry },
    );
    const docEmbedding = serializeEmbedding(docVec);

    const BATCH = 10;
    const embeddedChunks: Array<{
      content: string;
      embedding: Uint8Array;
      ftsText: string;
    }> = [];
    let embeddingDim = 0;

    for (let i = 0; i < textChunks.length; i += BATCH) {
      const batch = textChunks.slice(i, i + BATCH);
      const vectors = await retryEmbeddingOperation(
        () => embedTexts(batch.map((c) => c.embedText), { signal: options?.signal }),
        {
          signal: options?.signal,
          onRetry: ({ attempt, maxAttempts, error }) => {
            onProgress?.({
              phase: 'retrying',
              done: i,
              total: textChunks.length,
              attempt,
              maxAttempts,
              error,
            });
          },
        },
      );
      for (let j = 0; j < batch.length; j++) {
        embeddingDim = vectors[j].length;
        embeddedChunks.push({
          content: batch[j].content,
          ftsText: batch[j].embedText,
          embedding: serializeEmbedding(vectors[j]),
        });
      }
      onProgress?.({
        phase: 'embedding',
        done: Math.min(i + batch.length, textChunks.length),
        total: textChunks.length,
      });
    }

    replaceDocumentChunks(pendingDocument.id, embeddedChunks, {
      embeddingModel: getEmbeddingModelName(),
      embeddingDim,
      summary,
      outline,
      docEmbedding,
      supersedeDocumentIds: versionPlan.previousDocumentIds,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
    importedDocument = getDocument(pendingDocument.id)!;
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      updateDocumentMeta(pendingDocument.id, {
        status: 'index_failed',
        statusError: message.slice(0, 500),
      });
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        `文档索引失败，且失败状态无法保存: ${destPath}`,
      );
    }
    throw error;
  }

  onProgress?.({ phase: 'done', document: importedDocument });
  return importedDocument;
}
