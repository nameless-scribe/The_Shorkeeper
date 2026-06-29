import { dialog, ipcMain } from 'electron';
import { deleteDocument, listDocuments } from '../../src/rag/documents';
import { importDocumentFromPath } from '../../src/rag/importer';

export function registerDocumentsIpc() {
  ipcMain.handle('documents:list', () => listDocuments());

  ipcMain.handle('documents:delete', (_event, id: string) => {
    const ok = deleteDocument(id);
    return { ok };
  });

  ipcMain.handle('documents:import', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '文档', extensions: ['md', 'txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const sender = event.sender;
    return importDocumentFromPath(result.filePaths[0], (progress) => {
      sender.send('documents:importProgress', progress);
    });
  });
}
