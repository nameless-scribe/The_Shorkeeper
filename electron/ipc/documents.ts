import { dialog } from 'electron';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  deleteDocument,
  checkKnowledgeIndexCompatibility,
  listDocuments,
  recoverInterruptedDocumentImports,
  recoverKnowledgeTrash,
} from '../../src/rag/documents';
import { importDocumentFromPath } from '../../src/rag/importer';
import { reindexAllDocuments, reindexDocument } from '../../src/rag/reindex';
import { testEmbeddingConnection } from '../../src/rag/embedding';
import { getEmbeddingModelName } from '../../src/models/embedding-config';
import { trackRagOperation, shutdownRagOperations } from '../../src/rag/operation-runtime';
import type { WebContents } from 'electron';
import { safeSendToWebContents } from '../windows/web-contents';
import { requireString } from '../../src/shared/ipc-validation';
import { requireEnum } from '../../src/shared/ipc-validation';
import {
  checkDocumentFreshness,
  runAutomaticDocumentSync,
  setDocumentSyncPolicy,
  relinkDocumentSource,
  syncDocumentSource,
  type AutoDocumentSyncResult,
} from '../../src/rag/freshness';

let automaticSyncPromise: Promise<AutoDocumentSyncResult> | null = null;

export function scheduleAutomaticDocumentSync(): Promise<AutoDocumentSyncResult> {
  if (automaticSyncPromise) return automaticSyncPromise;
  const task = trackRagOperation((signal) => runAutomaticDocumentSync({ signal }));
  automaticSyncPromise = task;
  void task.finally(() => {
    if (automaticSyncPromise === task) automaticSyncPromise = null;
  }).catch(() => undefined);
  return task;
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  safeSendToWebContents(sender, channel, payload);
}

function runForSender<T>(
  sender: WebContents,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  sender.once('destroyed', abort);
  return trackRagOperation(work, controller.signal).finally(() => {
    sender.removeListener('destroyed', abort);
  });
}

export function shutdownDocumentsRuntime(timeoutMs = 5000): Promise<boolean> {
  return shutdownRagOperations(timeoutMs);
}

export async function registerDocumentsIpc() {
  const trashRecovery = await recoverKnowledgeTrash();
  if (trashRecovery.restored || trashRecovery.cleaned || trashRecovery.retained) {
    console.warn('[rag] 知识文件隔离区恢复结果:', trashRecovery);
  }
  const recovered = recoverInterruptedDocumentImports();
  if (recovered > 0) {
    console.warn(`[rag] 已将 ${recovered} 个中断的导入标记为需要重建。`);
  }

  ipcMain.handle('documents:list', () => listDocuments());

  ipcMain.handle('documents:delete', async (_event, id: unknown) => {
    const ok = await deleteDocument(requireString(id, '文档 ID', { maxLength: 200 }));
    return { ok };
  });

  ipcMain.handle('documents:embeddingMismatch', async () => {
    let currentDim: number | null = null;
    try {
      const test = await testEmbeddingConnection();
      if (test.ok && test.dimensions) {
        currentDim = test.dimensions;
      }
    } catch {
      /* 无 embedding 配置时仅报告 stored 多维度 */
    }
    return checkKnowledgeIndexCompatibility(getEmbeddingModelName(), currentDim);
  });

  ipcMain.handle('documents:reindex', async (event) => {
    const sender = event.sender;
    const result = await runForSender(sender, (signal) => reindexAllDocuments((progress) => {
      safeSend(sender, 'documents:reindexProgress', progress);
    }, { signal }));
    return { ok: result.failed === 0, ...result };
  });

  ipcMain.handle('documents:reindexOne', async (event, id: unknown) => {
    const documentId = requireString(id, '文档 ID', { maxLength: 200 });
    return runForSender(event.sender, (signal) => reindexDocument(documentId, { signal }));
  });

  ipcMain.handle('documents:checkFreshness', async (_event, id: unknown) =>
    checkDocumentFreshness(requireString(id, '文档 ID', { maxLength: 200 })),
  );

  ipcMain.handle('documents:syncSource', async (event, id: unknown) => {
    const documentId = requireString(id, '文档 ID', { maxLength: 200 });
    const sender = event.sender;
    return runForSender(sender, (signal) => syncDocumentSource(documentId, (progress) => {
      safeSend(sender, 'documents:importProgress', progress);
    }, { signal }));
  });

  ipcMain.handle('documents:setSyncPolicy', (_event, id: unknown, policy: unknown) =>
    setDocumentSyncPolicy(
      requireString(id, '文档 ID', { maxLength: 200 }),
      requireEnum(policy, '同步策略', ['manual', 'auto'] as const),
    ),
  );

  ipcMain.handle('documents:relinkSource', async (_event, id: unknown) => {
    const documentId = requireString(id, '文档 ID', { maxLength: 200 });
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '文档', extensions: ['md', 'txt', 'docx', 'doc', 'pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return relinkDocumentSource(documentId, result.filePaths[0]);
  });

  ipcMain.handle('documents:import', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '文档', extensions: ['md', 'txt', 'docx', 'doc', 'pdf'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const sender = event.sender;
    return runForSender(sender, (signal) => importDocumentFromPath(
      result.filePaths[0],
      (progress) => safeSend(sender, 'documents:importProgress', progress),
      { signal },
    ));
  });

  void scheduleAutomaticDocumentSync().catch((error) => {
    console.warn('[rag] 自动来源检查失败:', error instanceof Error ? error.message : error);
  });
}
