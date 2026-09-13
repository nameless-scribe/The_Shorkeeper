import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getPluginSettings,
  savePluginSettings,
  type FilesystemMode,
  type PluginSettings,
} from '../../src/config/plugins';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';
import { listEnabledMcpServers } from '../../src/db/mcp-servers';
import type { PluginSettingsInfo } from '../../src/shared/types';
import { requireBoolean, requireEnum, requireRecord } from '../../src/shared/ipc-validation';

function toInfo(settings: PluginSettings): PluginSettingsInfo {
  const mcpEnabledCount = listEnabledMcpServers().length;
  return {
    ...settings,
    mcpEnabledCount,
  };
}

export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:get', (): PluginSettingsInfo => toInfo(getPluginSettings()));

  ipcMain.handle(
    'plugins:set',
    (_event, patch: Partial<PluginSettingsInfo>): PluginSettingsInfo => {
      const input = requireRecord(patch, '插件设置');
      const booleanKeys = ['webSearch', 'fetchUrl', 'docGen', 'bookkeeping', 'lifeTools'] as const;
      const rest: Partial<PluginSettings> = {};
      for (const key of booleanKeys) {
        if (input[key] !== undefined) rest[key] = requireBoolean(input[key], key);
      }
      if (input.filesystemMode !== undefined) {
        rest.filesystemMode = requireEnum(
          input.filesystemMode,
          '文件权限模式',
          ['readonly', 'confirm', 'full'] as const,
        );
      }
      const saved = savePluginSettings(rest);
      invalidateAgentRegistry();
      return toInfo(saved);
    },
  );

  ipcMain.handle(
    'plugins:setFilesystemMode',
    (_event, mode: FilesystemMode): PluginSettingsInfo => {
      const saved = savePluginSettings({
        filesystemMode: requireEnum(mode, '文件权限模式', ['readonly', 'confirm', 'full'] as const),
      });
      invalidateAgentRegistry();
      return toInfo(saved);
    },
  );
}
