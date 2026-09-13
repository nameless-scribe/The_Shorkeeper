import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  requireBoolean,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label}必须是数组`);
  if (value.length > 100) throw new RangeError(`${label}最多 100 项`);
  return value.map((item, index) =>
    requireString(item, `${label}[${index}]`, { allowEmpty: true, maxLength: 4_096 }));
}

function parseStringMap(value: unknown, label: string): Record<string, string> {
  const input = requireRecord(value, label);
  const entries = Object.entries(input);
  if (entries.length > 100) throw new RangeError(`${label}最多 100 项`);
  return Object.fromEntries(entries.map(([key, item]) => [
    requireString(key, `${label} key`, { maxLength: 200 }),
    requireString(item, `${label}.${key}`, { allowEmpty: true, maxLength: 20_000 }),
  ]));
}

function parseMcpServerInput(value: unknown, partial = false) {
  const input = requireRecord(value, 'MCP Server 参数');
  return {
    name: input.name === undefined && partial
      ? undefined
      : requireString(input.name, '名称', { maxLength: 200 }),
    command: input.command === undefined && partial
      ? undefined
      : requireString(input.command, '启动命令', { maxLength: 32_767 }),
    args: input.args === undefined ? undefined : parseStringArray(input.args, 'args'),
    env: input.env === undefined ? undefined : parseStringMap(input.env, 'env'),
    enabled: input.enabled === undefined ? undefined : requireBoolean(input.enabled, 'enabled'),
  };
}

function parseMcpServerCreateInput(value: unknown) {
  const parsed = parseMcpServerInput(value);
  return { ...parsed, name: parsed.name!, command: parsed.command! };
}
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

function refreshMcp(): void {
  invalidateMcpLoad();
  invalidateAgentRegistry();
  void ensureMcpLoaded().catch((err) => {
    console.error('[mcp] 重载失败:', err);
  });
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:list', (event) => {
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
      const server = createMcpServer(parseMcpServerCreateInput(input));
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
      const server = updateMcpServer(
        requireString(id, 'MCP Server ID', { maxLength: 200 }),
        parseMcpServerInput(patch, true),
      );
      refreshMcp();
      return server ? redactMcpServerInfo(server) : null;
    },
  );

  ipcMain.handle('mcp:delete', (event, id: string) => {
    deleteMcpServer(requireString(id, 'MCP Server ID', { maxLength: 200 }));
    refreshMcp();
    return { ok: true };
  });

  ipcMain.handle('mcp:test', async (event, id: string) => {
    const server = getMcpServer(requireString(id, 'MCP Server ID', { maxLength: 200 }));
    if (!server) return { ok: false, tools: [], error: 'Server 不存在' };
    return testMcpServer(server);
  });
}

export async function initMcpOnStartup(): Promise<void> {
  await reloadMcpConnections();
}
