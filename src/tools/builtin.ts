import { ToolRegistry } from './registry';
import { readFileTool } from './file/read-file';
import { listDirTool } from './file/list-dir';
import { webSearchTool } from './web/web-search';
import {
  recallMemoryTool,
  saveMemoryTool,
  searchWorldbookTool,
} from './memory/memory-tools';
import {
  createScheduledTaskTool,
  deleteScheduledTaskTool,
  listScheduledTasksTool,
} from './schedule/schedule-tools';

let defaultRegistry: ToolRegistry | null = null;

export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(webSearchTool);
  registry.register(recallMemoryTool);
  registry.register(searchWorldbookTool);
  registry.register(saveMemoryTool);
  registry.register(createScheduledTaskTool);
  registry.register(listScheduledTasksTool);
  registry.register(deleteScheduledTaskTool);
  return registry;
}

export function getBuiltinRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createBuiltinRegistry();
  }
  return defaultRegistry;
}
