import { dialog, ipcMain } from 'electron';
import {
  deleteDocument,
  checkKnowledgeIndexCompatibility,
  listDocuments,
  recoverInterruptedDocumentImports,
} from '../../src/rag/documents';
import { importDocumentFromPath } from '../../src/rag/importer';
import { reindexAllDocuments, reindexDocument } from '../../src/rag/reindex';
import { testEmbeddingConnection } from '../../src/rag/embedding';
import { getEmbeddingModelName } from '../../src/models/embedding-config';

export function registerDocumentsIpc() {
  const recovered = recoverInterruptedDocumentImports();
  if (recovered > 0) {
    console.warn(`[rag] 已将 ${recovered} 个中断的导入标记为需要重建。`);
  }

  ipcMain.handle('documents:list', () => listDocuments());

  ipcMain.handle('documents:delete', async (_event, id: string) => {
    const ok = await deleteDocument(id);
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
    const result = await reindexAllDocuments((progress) => {
      sender.send('documents:reindexProgress', progress);
    });
    return { ok: result.failed === 0, ...result };
  });

  ipcMain.handle('documents:reindexOne', async (_event, id: string) => {
    return reindexDocument(id);
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
    return importDocumentFromPath(result.filePaths[0], (progress) => {
      sender.send('documents:importProgress', progress);
    });
  });
}
