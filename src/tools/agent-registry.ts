import {
  getPluginSettings,
  isPluginToolEnabled,
  pluginSettingsCacheKey,
} from '../config/plugins';
import { getMcpToolDefinitions } from '../mcp/client';
import type { Skill } from '../skills/loader';
import { getEnabledSkills } from '../skills/state';
import { createBuiltinRegistry } from './builtin';
import { ToolRegistry } from './registry';

let cachedBaseRegistry: ToolRegistry | null = null;
let baseCacheKey = '';

/** 核心伴侣能力：不受技能工具白名单限制 */
const CORE_TOOL_NAMES = new Set([
  'create_scheduled_task',
  'list_scheduled_tasks',
  'delete_scheduled_task',
  'update_agent_plan',
  'import_tasks_from_xlsx',
  'create_user_task',
  'list_user_tasks',
  'update_user_task',
  'manage_goals',
  'manage_commitments',
  'build_daily_brief',
  'build_evening_review',
  'recall_memory',
  'save_memory',
  'search_worldbook',
  'search_knowledge',
]);

function buildBaseCacheKey(mcpTools: { name: string }[], pluginsKey: string): string {
  const mcpHash = mcpTools
    .map((t) => t.name)
    .sort()
    .join(',');
  return `${mcpHash}:${pluginsKey}`;
}

function applyPluginFilter(registry: ToolRegistry): ToolRegistry {
  const settings = getPluginSettings();
  const filtered = new ToolRegistry();
  for (const tool of registry.list()) {
    if (isPluginToolEnabled(tool.name, settings)) {
      filtered.register(tool);
    }
  }
  return filtered;
}

function applySkillToolFilter(registry: ToolRegistry, skills: Skill[]): ToolRegistry {
  const restricted = skills.filter((s) => s.allowedTools && s.allowedTools.length > 0);
  if (restricted.length === 0) return registry;

  const allowed = new Set<string>();
  for (const skill of restricted) {
    for (const name of skill.allowedTools ?? []) {
      allowed.add(name);
    }
  }

  const filtered = new ToolRegistry();
  for (const tool of registry.list()) {
    if (allowed.has(tool.name) || CORE_TOOL_NAMES.has(tool.name)) {
      filtered.register(tool);
    }
  }
  return filtered;
}

async function getBaseRegistry(): Promise<ToolRegistry> {
  const mcpTools = await getMcpToolDefinitions();
  const pluginsKey = pluginSettingsCacheKey(getPluginSettings());
  const key = buildBaseCacheKey(mcpTools, pluginsKey);

  if (cachedBaseRegistry && baseCacheKey === key) {
    return cachedBaseRegistry;
  }

  const registry = createBuiltinRegistry();
  for (const tool of mcpTools) {
    try {
      registry.register(tool);
    } catch (err) {
      console.warn(`[tools] 跳过 MCP 工具 ${tool.name}:`, err);
    }
  }

  cachedBaseRegistry = applyPluginFilter(registry);
  baseCacheKey = key;
  return cachedBaseRegistry;
}

export interface AgentRegistryResolution {
  registry: ToolRegistry;
  activeSkills: Skill[];
  skillWarnings: string[];
}

export async function resolveAgentRegistry(skills: Skill[]): Promise<AgentRegistryResolution> {
  const base = await getBaseRegistry();
  const available = new Set(base.list().map((tool) => tool.name));
  const activeSkills: Skill[] = [];
  const skillWarnings: string[] = [];

  for (const skill of skills) {
    const missing = (skill.requiredTools ?? []).filter((toolName) => !available.has(toolName));
    if (missing.length) {
      skillWarnings.push(`技能「${skill.name}」未激活：缺少工具 ${missing.join(', ')}`);
    } else {
      activeSkills.push(skill);
    }
  }

  return {
    registry: applySkillToolFilter(base, activeSkills),
    activeSkills,
    skillWarnings,
  };
}

export async function getAgentRegistry(activeSkills?: Skill[]): Promise<ToolRegistry> {
  const skills = activeSkills ?? getEnabledSkills();
  return (await resolveAgentRegistry(skills)).registry;
}

export function invalidateAgentRegistry(): void {
  cachedBaseRegistry = null;
  baseCacheKey = '';
}
