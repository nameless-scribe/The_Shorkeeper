import { dialog, ipcMain } from 'electron';
import {
  deleteDocument,
  checkEmbeddingDimensionMismatch,
  listDocuments,
} from '../../src/rag/documents';
import { importDocumentFromPath } from '../../src/rag/importer';
import { reindexAllDocuments } from '../../src/rag/reindex';
import { testEmbeddingConnection } from '../../src/rag/embedding';

export function registerDocumentsIpc() {
  ipcMain.handle('documents:list', () => listDocuments());

  ipcMain.handle('documents:delete', (_event, id: string) => {
    const ok = deleteDocument(id);
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
    return checkEmbeddingDimensionMismatch(currentDim);
  });

  ipcMain.handle('documents:reindex', async (event) => {
    const sender = event.sender;
    await reindexAllDocuments((progress) => {
      sender.send('documents:reindexProgress', progress);
    });
    return { ok: true };
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
