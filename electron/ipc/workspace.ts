import { dialog, ipcMain } from 'electron';
import { importFileToWorkspace, type WorkspaceImportResult } from '../../src/workspace/import';

export function registerWorkspaceIpc() {
  ipcMain.handle('workspace:pickAndImport', async (): Promise<WorkspaceImportResult | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '文本文件', extensions: ['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return importFileToWorkspace(result.filePaths[0]);
  });

  ipcMain.handle(
    'workspace:importPaths',
    async (_event, paths: string[]): Promise<WorkspaceImportResult[]> => {
      if (!Array.isArray(paths) || !paths.length) return [];
      const imported: WorkspaceImportResult[] = [];
      for (const p of paths) {
        if (typeof p !== 'string' || !p.trim()) continue;
        try {
          imported.push(await importFileToWorkspace(p));
        } catch (err) {
          console.error('[workspace] 导入失败:', p, err);
        }
      }
      return imported;
    },
  );
}
