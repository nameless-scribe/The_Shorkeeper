import { getPluginSettings, needsNetwork, type PluginSettings } from '../config/plugins';
import { listEnabledMcpServers } from '../db/mcp-servers';
import { ensureWorkspaceDir } from './permissions';
import type { PermissionPolicy } from './types';

export function buildPermissionPolicy(settings: PluginSettings = getPluginSettings()): PermissionPolicy {
  const mode = settings.filesystemMode;
  return {
    filesystem: {
      allowedRoots: [ensureWorkspaceDir()],
      writeAllowed: mode !== 'readonly',
      requireConfirmOnWrite: mode === 'confirm',
    },
    network: needsNetwork(settings),
    mcp: listEnabledMcpServers().length > 0,
  };
}
