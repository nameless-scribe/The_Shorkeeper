import { ipcMain } from 'electron';
import {
  getPluginSettings,
  savePluginSettings,
  type FilesystemMode,
  type PluginSettings,
} from '../../src/config/plugins';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';
import { listEnabledMcpServers } from '../../src/db/mcp-servers';
import type { PluginSettingsInfo } from '../../src/shared/types';

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
      const { mcpEnabledCount: _ignored, ...rest } = patch;
      const saved = savePluginSettings(rest as Partial<PluginSettings>);
      invalidateAgentRegistry();
      return toInfo(saved);
    },
  );

  ipcMain.handle(
    'plugins:setFilesystemMode',
    (_event, mode: FilesystemMode): PluginSettingsInfo => {
      const saved = savePluginSettings({ filesystemMode: mode });
      invalidateAgentRegistry();
      return toInfo(saved);
    },
  );
}
