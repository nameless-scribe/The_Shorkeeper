import { dialog, shell } from 'electron';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspaceDir } from '../../src/agent/permissions';
import { resolveWorkspacePath } from '../../src/tools/file/workspace-path';
import {
  importFileToWorkspace,
  recoverWorkspaceImportTemps,
  type WorkspaceImportResult,
} from '../../src/workspace/import';
import { classifyWorkspaceFile, WORKSPACE_PICK_DIALOG_FILTERS } from '../../src/workspace/allowed-extensions';
import { requireString } from '../../src/shared/ipc-validation';

export async function registerWorkspaceIpc() {
  const recovery = await recoverWorkspaceImportTemps();
  if (recovery.cleaned || recovery.retained) {
    console.warn('[workspace] 导入临时文件恢复结果:', recovery);
  }
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
    async (event, paths: string[]): Promise<WorkspaceImportResult[]> => {
      if (!Array.isArray(paths)) throw new TypeError('导入路径必须是数组');
      if (!paths.length) return [];

      const normalized = [...new Set(paths.map((p, index) =>
        requireString(p, `导入路径[${index}]`, { maxLength: 32_767 }).trim(),
      ))];
      if (normalized.length > 100) {
        throw new Error('单次最多导入 100 个文件');
      }
      const preview = normalized.slice(0, 5).join('\n');
      const confirm = await dialog.showMessageBox({
        type: 'question',
        buttons: ['导入', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '确认导入到工作区',
        message: `将 ${normalized.length} 个文件导入 Agent 工作区？`,
        detail: preview + (normalized.length > 5 ? '\n…' : ''),
      });
      if (confirm.response !== 0) return [];

      const imported: WorkspaceImportResult[] = [];
      for (const p of normalized) {
        try {
          imported.push(await importFileToWorkspace(p));
        } catch (err) {
          console.error('[workspace] 导入失败:', p, err);
        }
      }
      return imported;
    },
  );

  ipcMain.handle('workspace:openRelative', async (_event, rawPath: unknown) => {
    try {
      const relativePath = requireString(rawPath, '工作区路径', { maxLength: 4_096 });
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      const err = await shell.openPath(absolute);
      return err ? { ok: false, error: err } : { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('workspace:showRelative', async (_event, rawPath: unknown) => {
    try {
      const relativePath = requireString(rawPath, '工作区路径', { maxLength: 4_096 });
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      shell.showItemInFolder(absolute);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('workspace:getFileInfo', async (_event, rawPath: unknown) => {
    try {
      const relativePath = requireString(rawPath, '工作区路径', { maxLength: 4_096 });
      const root = ensureWorkspaceDir();
      const absolute = resolveWorkspacePath(root, relativePath);
      const stat = await fs.stat(absolute);
      return {
        relativePath: relativePath.replace(/\\/g, '/'),
        originalName: path.basename(relativePath),
        size: stat.size,
        kind: classifyWorkspaceFile(path.extname(relativePath)),
      };
    } catch {
      return null;
    }
  });
}
