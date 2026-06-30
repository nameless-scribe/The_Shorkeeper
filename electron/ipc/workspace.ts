import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspaceDir } from '../../src/agent/permissions';
import { resolveWorkspacePath } from '../../src/tools/file/workspace-path';
import { importFileToWorkspace, type WorkspaceImportResult } from '../../src/workspace/import';
import { WORKSPACE_PICK_DIALOG_FILTERS } from '../../src/workspace/allowed-extensions';

export function registerWorkspaceIpc() {
  ipcMain.handle('workspace:pickAndImport', async (): Promise<WorkspaceImportResult | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: WORKSPACE_PICK_DIALOG_FILTERS,
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

  ipcMain.handle('workspace:openRelative', async (_event, relativePath: string) => {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      return { ok: false, error: '无效路径' };
    }
    try {
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      const err = await shell.openPath(absolute);
      return err ? { ok: false, error: err } : { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('workspace:showRelative', async (_event, relativePath: string) => {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      return { ok: false, error: '无效路径' };
    }
    try {
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      shell.showItemInFolder(absolute);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('workspace:getFileInfo', async (_event, relativePath: string) => {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      return null;
    }
    try {
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      const stat = await fs.stat(absolute);
      return {
        relativePath: relativePath.replace(/\\/g, '/'),
        originalName: path.basename(relativePath),
        size: stat.size,
      };
    } catch {
      return null;
    }
  });
}
