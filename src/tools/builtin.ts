import { ToolRegistry } from './registry';
import { readFileTool } from './file/read-file';
import { listDirTool } from './file/list-dir';
import { webSearchTool } from './web/web-search';

let defaultRegistry: ToolRegistry | null = null;

export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(webSearchTool);
  return registry;
}

export function getBuiltinRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createBuiltinRegistry();
  }
  return defaultRegistry;
}
