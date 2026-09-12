import { ipcMain } from 'electron';
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServersForRenderer,
  redactMcpServerInfo,
  updateMcpServer,
} from '../../src/db/mcp-servers';
import {
  ensureMcpLoaded,
  invalidateMcpLoad,
  reloadMcpConnections,
  testMcpServer,
} from '../../src/mcp/client';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';
import { assertTrustedIpcSender } from '../windows/security';

function refreshMcp(): void {
  invalidateMcpLoad();
  invalidateAgentRegistry();
  void ensureMcpLoaded().catch((err) => {
    console.error('[mcp] 重载失败:', err);
  });
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:list', (event) => {
    assertTrustedIpcSender(event);
    return listMcpServersForRenderer();
  });

  ipcMain.handle(
    'mcp:create',
    (
      event,
      input: {
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        enabled?: boolean;
      },
    ) => {
      assertTrustedIpcSender(event);
      const server = createMcpServer(input);
      refreshMcp();
      return redactMcpServerInfo(server);
    },
  );

  ipcMain.handle(
    'mcp:update',
    (
      event,
      id: string,
      patch: Partial<{
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        enabled: boolean;
      }>,
    ) => {
      assertTrustedIpcSender(event);
      const server = updateMcpServer(id, patch);
      refreshMcp();
      return server ? redactMcpServerInfo(server) : null;
    },
  );

  ipcMain.handle('mcp:delete', (event, id: string) => {
    assertTrustedIpcSender(event);
    deleteMcpServer(id);
    refreshMcp();
    return { ok: true };
  });

  ipcMain.handle('mcp:test', async (event, id: string) => {
    assertTrustedIpcSender(event);
    const server = getMcpServer(id);
    if (!server) return { ok: false, tools: [], error: 'Server 不存在' };
    return testMcpServer(server);
  });
}

export async function initMcpOnStartup(): Promise<void> {
  await reloadMcpConnections();
}
