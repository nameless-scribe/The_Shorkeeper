import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerInfo } from '../db/mcp-servers';
import { listEnabledMcpServers } from '../db/mcp-servers';
import type { JSONSchema, ToolDefinition, ToolContext, ToolResult } from '../tools/types';

interface ConnectedServer {
  server: McpServerInfo;
  client: Client;
  transport: StdioClientTransport;
}

const connections = new Map<string, ConnectedServer>();
let loadPromise: Promise<void> | null = null;

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverId)}__${sanitizeSegment(toolName)}`;
}

function toJsonSchema(input: unknown): JSONSchema {
  if (input && typeof input === 'object') {
    return input as JSONSchema;
  }
  return { type: 'object', properties: {} };
}

function mcpToolToDefinition(
  server: McpServerInfo,
  tool: { name: string; description?: string; inputSchema?: unknown },
  client: Client,
): ToolDefinition {
  const registeredName = mcpToolName(server.id, tool.name);

  return {
    name: registeredName,
    description: tool.description?.trim() || `MCP 工具 (${server.name}/${tool.name})`,
    parameters: toJsonSchema(tool.inputSchema),
    category: 'mcp',
    requiresPermission: ['mcp'],
    execute: async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      if (ctx.signal.aborted) {
        return { success: false, output: '', error: '已取消' };
      }

      try {
        const result = await client.callTool(
          { name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
          undefined,
          { signal: ctx.signal, timeout: 60_000 },
        );

        const textParts: string[] = [];
        if (Array.isArray(result.content)) {
          for (const block of result.content) {
            if (block && typeof block === 'object' && 'type' in block) {
              if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
                textParts.push(block.text);
              } else {
                textParts.push(JSON.stringify(block));
              }
            }
          }
        }

        const output = textParts.join('\n').trim() || JSON.stringify(result.content ?? null);
        if (result.isError) {
          return { success: false, output, error: output || 'MCP 工具返回错误' };
        }
        return { success: true, output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}

const MCP_ENV_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
]);

function buildMcpEnv(server: McpServerInfo): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (typeof value !== 'string') continue;
    if (MCP_ENV_ALLOWLIST.has(key)) continue;
    env[key] = value;
  }
  return env;
}

async function connectServer(server: McpServerInfo): Promise<ConnectedServer | null> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: buildMcpEnv(server),
    stderr: 'pipe',
  });

  const client = new Client({ name: 'the-shorekeeper', version: '0.1.0' });
  await client.connect(transport);
  return { server, client, transport };
}

export async function reloadMcpConnections(): Promise<void> {
  for (const conn of connections.values()) {
    try {
      await conn.client.close();
    } catch {
      /* ignore */
    }
    try {
      await conn.transport.close();
    } catch {
      /* ignore */
    }
  }
  connections.clear();

  const enabled = listEnabledMcpServers();
  for (const server of enabled) {
    try {
      const conn = await connectServer(server);
      if (conn) connections.set(server.id, conn);
    } catch (err) {
      console.error(`[mcp] 连接失败 (${server.name}):`, err);
    }
  }
}

export function ensureMcpLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = reloadMcpConnections().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

export async function getMcpToolDefinitions(): Promise<ToolDefinition[]> {
  await ensureMcpLoaded();

  const tools: ToolDefinition[] = [];
  for (const conn of connections.values()) {
    try {
      const listed = await conn.client.listTools();
      for (const tool of listed.tools) {
        tools.push(mcpToolToDefinition(conn.server, tool, conn.client));
      }
    } catch (err) {
      console.error(`[mcp] 列举工具失败 (${conn.server.name}):`, err);
    }
  }
  return tools;
}

export async function testMcpServer(server: McpServerInfo): Promise<{
  ok: boolean;
  tools: string[];
  error?: string;
}> {
  let conn: ConnectedServer | null = null;
  try {
    conn = await connectServer(server);
    if (!conn) {
      return { ok: false, tools: [], error: '无法建立连接' };
    }
    const listed = await conn.client.listTools();
    return {
      ok: true,
      tools: listed.tools.map((t) => t.name),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, tools: [], error: message };
  } finally {
    if (conn) {
      try {
        await conn.client.close();
      } catch {
        /* ignore */
      }
      try {
        await conn.transport.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export function invalidateMcpLoad(): void {
  loadPromise = null;
}
