import { getMcpToolDefinitions } from '../mcp/client';
import { getEnabledSkills } from '../skills/state';
import { createBuiltinRegistry } from './builtin';
import { ToolRegistry } from './registry';

let cachedRegistry: ToolRegistry | null = null;
let cacheKey = '';

function buildCacheKey(skillIds: string[], mcpCount: number): string {
  return `${skillIds.sort().join(',')}:${mcpCount}`;
}

function applySkillToolFilter(registry: ToolRegistry): ToolRegistry {
  const enabled = getEnabledSkills();
  const restricted = enabled.filter((s) => s.allowedTools && s.allowedTools.length > 0);
  if (restricted.length === 0) return registry;

  const allowed = new Set<string>();
  for (const skill of restricted) {
    for (const name of skill.allowedTools ?? []) {
      allowed.add(name);
    }
  }

  const filtered = new ToolRegistry();
  for (const tool of registry.list()) {
    if (allowed.has(tool.name)) {
      filtered.register(tool);
    }
  }
  return filtered;
}

export async function getAgentRegistry(): Promise<ToolRegistry> {
  const mcpTools = await getMcpToolDefinitions();
  const skillIds = getEnabledSkills().map((s) => s.id);
  const key = buildCacheKey(skillIds, mcpTools.length);

  if (cachedRegistry && cacheKey === key) {
    return cachedRegistry;
  }

  const registry = createBuiltinRegistry();
  for (const tool of mcpTools) {
    try {
      registry.register(tool);
    } catch (err) {
      console.warn(`[tools] 跳过 MCP 工具 ${tool.name}:`, err);
    }
  }

  cachedRegistry = applySkillToolFilter(registry);
  cacheKey = key;
  return cachedRegistry;
}

export function invalidateAgentRegistry(): void {
  cachedRegistry = null;
  cacheKey = '';
}
