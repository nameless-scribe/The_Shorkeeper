import { ToolRegistry } from './registry';
import { readFileTool } from './file/read-file';
import { writeFileTool } from './file/write-file';
import { listDirTool } from './file/list-dir';
import { webSearchTool } from './web/web-search';
import { fetchUrlTool } from './web/fetch-url';
import { weatherTool } from './web/weather';
import { translateTool } from './web/translate';
import {
  genDocxTool,
  genMarkdownTool,
  genPdfTool,
  genXlsxTool,
} from './doc/gen-tools';
import { bookkeepingTool } from './life/bookkeeping';
import { travelPlanTool } from './life/travel-plan';
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
  registry.register(writeFileTool);
  registry.register(listDirTool);
  registry.register(webSearchTool);
  registry.register(fetchUrlTool);
  registry.register(weatherTool);
  registry.register(translateTool);
  registry.register(genMarkdownTool);
  registry.register(genDocxTool);
  registry.register(genXlsxTool);
  registry.register(genPdfTool);
  registry.register(bookkeepingTool);
  registry.register(travelPlanTool);
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
