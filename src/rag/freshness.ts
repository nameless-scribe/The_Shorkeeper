import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getDocument,
  listDocuments,
  updateDocumentMeta,
  type DocumentInfo,
} from './documents';
import { importDocumentFromPath, type ImportProgress } from './importer';
import type { DocumentSyncPolicy } from '../shared/types';
import { AbortSignalError } from '../agent/abort';

export const AUTO_DOCUMENT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_AUTO_DOCUMENTS_PER_PASS = 20;
const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.md', '.txt', '.docx', '.doc', '.pdf']);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function sourceStatChanged(document: DocumentInfo, modifiedAt: number, size: number): boolean {
  return document.sourceModifiedAt !== modifiedAt || document.sourceSize !== size;
}

export async function checkDocumentFreshness(
  documentId: string,
  options?: { signal?: AbortSignal },
): Promise<DocumentInfo> {
  if (options?.signal?.aborted) throw new AbortSignalError();
  const document = getDocument(documentId);
  if (!document) throw new Error('文档不存在或已被新版本替代');
  if (document.sourceKind !== 'local_file' || !document.sourcePath) {
    updateDocumentMeta(documentId, {
      freshnessStatus: 'snapshot',
      staleReason: null,
      lastCheckedAt: Date.now(),
    });
    return getDocument(documentId)!;
  }

  const checkedAt = Date.now();
  try {
    const stat = await fs.stat(document.sourcePath);
    if (options?.signal?.aborted) throw new AbortSignalError();
    if (!stat.isFile()) {
      updateDocumentMeta(documentId, {
        freshnessStatus: 'missing',
        staleReason: '来源路径不再是文件，请重新定位或保留当前快照',
        lastCheckedAt: checkedAt,
      });
      return getDocument(documentId)!;
    }
    const modifiedAt = Math.floor(stat.mtimeMs);
    const size = stat.size;
    const hasBaseline = document.sourceModifiedAt != null && document.sourceSize != null;
    const changed = hasBaseline && sourceStatChanged(document, modifiedAt, size);
    updateDocumentMeta(documentId, {
      ...(hasBaseline ? {} : { sourceModifiedAt: modifiedAt, sourceSize: size }),
      freshnessStatus: changed ? 'changed' : 'current',
      staleReason: changed ? '来源文件已变化，当前仍使用上一次成功索引的快照' : null,
      lastCheckedAt: checkedAt,
    });
    return getDocument(documentId)!;
  } catch (error) {
    if (options?.signal?.aborted || error instanceof AbortSignalError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      updateDocumentMeta(documentId, {
        freshnessStatus: 'missing',
        staleReason: '来源文件已移动或删除，当前保留上一次成功索引的快照',
        lastCheckedAt: checkedAt,
      });
      return getDocument(documentId)!;
    }
    const message = error instanceof Error ? error.message : String(error);
    updateDocumentMeta(documentId, {
      freshnessStatus: 'unknown',
      staleReason: `检查来源失败：${message}`.slice(0, 500),
      lastCheckedAt: checkedAt,
    });
    throw error;
  }
}

export function setDocumentSyncPolicy(
  documentId: string,
  policy: DocumentSyncPolicy,
): DocumentInfo {
  const document = getDocument(documentId);
  if (!document) throw new Error('文档不存在或已被新版本替代');
  if (policy === 'auto' && (document.sourceKind !== 'local_file' || !document.sourcePath)) {
    throw new Error('快照文档没有本地来源，不能开启自动同步');
  }
  updateDocumentMeta(documentId, { syncPolicy: policy });
  return getDocument(documentId)!;
}

export async function relinkDocumentSource(
  documentId: string,
  sourcePath: string,
): Promise<DocumentInfo> {
  const document = getDocument(documentId);
  if (!document) throw new Error('文档不存在或已被新版本替代');
  const resolved = await fs.realpath(path.resolve(sourcePath));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('选择的来源不是有效文件');
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(resolved).toLocaleLowerCase())) {
    throw new Error('仅支持 .md / .txt / .docx / .doc / .pdf');
  }
  if (stat.size > MAX_SOURCE_BYTES) throw new Error('文件超过 10MB');
  updateDocumentMeta(documentId, {
    sourcePath: resolved,
    sourceKind: 'local_file',
    sourceModifiedAt: Math.floor(stat.mtimeMs),
    sourceSize: stat.size,
    lastCheckedAt: Date.now(),
    freshnessStatus: 'changed',
    staleReason: '已重新定位来源，当前仍使用旧快照；请同步生成新版本',
    syncPolicy: 'manual',
  });
  return getDocument(documentId)!;
}

export async function syncDocumentSource(
  documentId: string,
  onProgress?: (progress: ImportProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<DocumentInfo> {
  const beforeCheck = getDocument(documentId);
  if (!beforeCheck) throw new Error('文档不存在或已被新版本替代');
  const explicitlyStale = beforeCheck.freshnessStatus === 'changed';
  const document = await checkDocumentFreshness(documentId, options);
  if (!document.sourcePath || document.sourceKind !== 'local_file') {
    throw new Error('该文档是独立快照，没有可同步的本地来源');
  }
  if (document.freshnessStatus === 'missing') {
    throw new Error('来源文件已移动或删除，请恢复文件后再同步');
  }
  if (document.freshnessStatus === 'current' && !explicitlyStale) return document;
  if (options?.signal?.aborted) throw new AbortSignalError();
  return importDocumentFromPath(document.sourcePath, onProgress, {
    signal: options?.signal,
    syncPolicy: document.syncPolicy,
    skipHashDedup: true,
  });
}

export interface AutoDocumentSyncResult {
  checked: number;
  synced: number;
  missing: number;
  failed: number;
}

export async function runAutomaticDocumentSync(
  options?: { signal?: AbortSignal; now?: number },
): Promise<AutoDocumentSyncResult> {
  const result: AutoDocumentSyncResult = { checked: 0, synced: 0, missing: 0, failed: 0 };
  const now = options?.now ?? Date.now();
  const documents = listDocuments()
    .filter((document) => document.syncPolicy === 'auto' && document.sourceKind === 'local_file')
    .filter((document) => document.lastCheckedAt == null || now - document.lastCheckedAt >= AUTO_DOCUMENT_CHECK_INTERVAL_MS)
    .slice(0, MAX_AUTO_DOCUMENTS_PER_PASS);

  for (const document of documents) {
    if (options?.signal?.aborted) throw new AbortSignalError();
    try {
      const checked = await checkDocumentFreshness(document.id, options);
      result.checked += 1;
      if (checked.freshnessStatus === 'missing') {
        result.missing += 1;
      } else if (checked.freshnessStatus === 'changed') {
        await syncDocumentSource(document.id, undefined, options);
        result.synced += 1;
      }
    } catch (error) {
      if (options?.signal?.aborted || error instanceof AbortSignalError) throw error;
      result.failed += 1;
    }
  }
  return result;
}
