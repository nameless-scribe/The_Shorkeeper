import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../registry';
import { createScheduledTaskTool, deleteScheduledTaskTool, listScheduledTasksTool } from '../schedule/schedule-tools';
import { readXlsxTool } from '../doc/gen-tools';
import { webSearchTool } from '../web/web-search';
import type { Skill } from '../../skills/loader';

vi.mock('../builtin', () => ({
  createBuiltinRegistry: () => {
    const registry = new ToolRegistry();
    registry.register(createScheduledTaskTool);
    registry.register(listScheduledTasksTool);
    registry.register(deleteScheduledTaskTool);
    registry.register(readXlsxTool);
    registry.register(webSearchTool);
    return registry;
  },
}));

vi.mock('../../config/plugins', () => ({
  getPluginSettings: vi.fn(() => ({
    webSearch: true,
    fetchUrl: true,
    docGen: true,
    bookkeeping: true,
    lifeTools: true,
    filesystemMode: 'confirm',
  })),
  isPluginToolEnabled: vi.fn(() => true),
  pluginSettingsCacheKey: vi.fn(() => 'default'),
}));

vi.mock('../../mcp/client', () => ({
  getMcpToolDefinitions: vi.fn(async () => []),
}));

vi.mock('../../skills/state', () => ({
  getEnabledSkills: vi.fn(() => [
    {
      id: 'excel',
      allowedTools: ['read_xlsx', 'gen_xlsx', 'list_dir', 'read_file'],
    },
  ]),
}));

import { getEnabledSkills } from '../../skills/state';
import { getAgentRegistry, invalidateAgentRegistry } from '../agent-registry';

describe('getAgentRegistry', () => {
  beforeEach(() => {
    invalidateAgentRegistry();
  });

  it('keeps schedule tools available when skills restrict other tools', async () => {
    const registry = await getAgentRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain('create_scheduled_task');
    expect(names).toContain('list_scheduled_tasks');
    expect(names).toContain('delete_scheduled_task');
    expect(names).not.toContain('web_search');
  });

  it('includes skill-whitelisted tools alongside core tools', async () => {
    const registry = await getAgentRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain('read_xlsx');
    expect(names).toContain('create_scheduled_task');
  });

  it('does not filter tools when no skill has a whitelist', async () => {
    invalidateAgentRegistry();
    vi.mocked(getEnabledSkills).mockReturnValue([
      {
        id: 'example',
        name: 'Example',
        description: 'Test skill without a tool whitelist',
        version: '1.0.0',
        systemPromptFragment: 'Keep responses concise.',
        allowedTools: undefined,
        trigger: 'manual',
        priority: 0,
      },
    ]);

    const registry = await getAgentRegistry();
    const names = registry.list().map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('create_scheduled_task');
  });

  it('filters by activeSkills instead of all enabled when provided', async () => {
    invalidateAgentRegistry();
    const activeOnly: Skill[] = [
      {
        id: 'excel',
        name: 'Excel',
        description: 'Test Excel skill',
        version: '1.0.0',
        systemPromptFragment: 'Use Excel tools.',
        allowedTools: ['read_xlsx', 'gen_xlsx'],
        trigger: 'auto',
        priority: 10,
      },
    ];

    const registry = await getAgentRegistry(activeOnly);
    const names = registry.list().map((t) => t.name);

    expect(names).toContain('read_xlsx');
    expect(names).not.toContain('web_search');
    expect(names).toContain('create_scheduled_task');
  });
});
