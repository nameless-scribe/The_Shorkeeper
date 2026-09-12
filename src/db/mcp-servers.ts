import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';
import {
  protectSecretMap,
  redactSecretMap,
  revealSecretMap,
} from '../security/secret-storage';

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: number;
}

export interface McpServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

const SELECT = `SELECT id, name, command, args, env, enabled FROM mcp_servers`;

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

function rowToInfo(row: McpServerRow): McpServerInfo {
  const storedEnv = parseJsonObject(row.env);
  const env = revealSecretMap(storedEnv);
  const protectedEnv = protectSecretMap(env);
  if (JSON.stringify(protectedEnv) !== JSON.stringify(storedEnv)) {
    getDatabase()
      .prepare('UPDATE mcp_servers SET env = ? WHERE id = ?')
      .run(JSON.stringify(protectedEnv), row.id);
  }
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: parseJsonArray(row.args),
    env,
    enabled: row.enabled === 1,
  };
}

export function listMcpServers(): McpServerInfo[] {
  const rows = getDatabase().prepare(`${SELECT} ORDER BY name ASC`).all() as unknown as McpServerRow[];
  return rows.map(rowToInfo);
}

export function redactMcpServerInfo(server: McpServerInfo): McpServerInfo {
  return { ...server, env: redactSecretMap(server.env) };
}

export function listMcpServersForRenderer(): McpServerInfo[] {
  return listMcpServers().map(redactMcpServerInfo);
}

export function listEnabledMcpServers(): McpServerInfo[] {
  return listMcpServers().filter((s) => s.enabled);
}

export function getMcpServer(id: string): McpServerInfo | null {
  const row = getDatabase().prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as McpServerRow | undefined;
  return row ? rowToInfo(row) : null;
}

export interface CreateMcpServerInput {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export function createMcpServer(input: CreateMcpServerInput): McpServerInfo {
  const id = uuid();
  getDatabase()
    .prepare(
      `INSERT INTO mcp_servers (id, name, command, args, env, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      input.command.trim(),
      JSON.stringify(input.args ?? []),
      JSON.stringify(protectSecretMap(input.env ?? {})),
      input.enabled === false ? 0 : 1,
    );
  return getMcpServer(id)!;
}

export function updateMcpServer(
  id: string,
  patch: Partial<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    enabled: boolean;
  }>,
): McpServerInfo | null {
  const existing = getMcpServer(id);
  if (!existing) return null;

  getDatabase()
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, command = ?, args = ?, env = ?, enabled = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      patch.command ?? existing.command,
      JSON.stringify(patch.args ?? existing.args),
      JSON.stringify(protectSecretMap(patch.env ?? existing.env)),
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      id,
    );

  return getMcpServer(id);
}

export function deleteMcpServer(id: string): void {
  getDatabase().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}
