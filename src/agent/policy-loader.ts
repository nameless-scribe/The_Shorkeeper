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
    // Creating/deleting background automation changes future app behaviour,
    // so it always needs an explicit approval in the current desktop client.
    automation: {
      allowed: true,
      requireConfirm: true,
    },
    // No shell tool is currently exposed. Keep the policy deny-by-default so
    // a future tool cannot accidentally become executable by adding a flag.
    shell: {
      allowed: false,
      requireConfirm: true,
    },
  };
}
