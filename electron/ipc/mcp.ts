import { ipcMain } from 'electron';
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from '../../src/db/mcp-servers';
import {
  ensureMcpLoaded,
  invalidateMcpLoad,
  reloadMcpConnections,
  testMcpServer,
} from '../../src/mcp/client';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';

function refreshMcp(): void {
  invalidateMcpLoad();
  invalidateAgentRegistry();
  void ensureMcpLoaded().catch((err) => {
    console.error('[mcp] 重载失败:', err);
  });
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:list', () => listMcpServers());

  ipcMain.handle(
    'mcp:create',
    (
      _event,
      input: {
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        enabled?: boolean;
      },
    ) => {
      const server = createMcpServer(input);
      refreshMcp();
      return server;
    },
  );

  ipcMain.handle(
    'mcp:update',
    (
      _event,
      id: string,
      patch: Partial<{
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        enabled: boolean;
      }>,
    ) => {
      const server = updateMcpServer(id, patch);
      refreshMcp();
      return server;
    },
  );

  ipcMain.handle('mcp:delete', (_event, id: string) => {
    deleteMcpServer(id);
    refreshMcp();
    return { ok: true };
  });

  ipcMain.handle('mcp:test', async (_event, id: string) => {
    const server = getMcpServer(id);
    if (!server) return { ok: false, tools: [], error: 'Server 不存在' };
    return testMcpServer(server);
  });
}

export async function initMcpOnStartup(): Promise<void> {
  await reloadMcpConnections();
}
