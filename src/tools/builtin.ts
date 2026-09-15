import { ToolRegistry } from './registry';
import { readFileTool } from './file/read-file';
import { writeFileTool } from './file/write-file';
import { replaceTextTool } from './file/replace-text';
import { listDirTool } from './file/list-dir';
import { webSearchTool } from './web/web-search';
import { fetchUrlTool } from './web/fetch-url';
import { weatherTool } from './web/weather';
import { translateTool } from './web/translate';
import { convertToMarkdownTool } from './doc/convert-markdown';
import { updateDocxTextTool } from './doc/update-docx-text';
import { genChartTool } from './doc/gen-chart';
import {
  genDocxTool,
  genMarkdownTool,
  genPdfTool,
  genXlsxTool,
  readXlsxTool,
  updateXlsxCellsTool,
} from './doc/gen-tools';
import { bookkeepingTool } from './life/bookkeeping';
import { travelPlanTool } from './life/travel-plan';
import {
  recallMemoryTool,
  saveMemoryTool,
  searchWorldbookTool,
} from './memory/memory-tools';
import { searchKnowledgeTool } from './memory/knowledge-tools';
import {
  createScheduledTaskTool,
  deleteScheduledTaskTool,
  listScheduledTasksTool,
} from './schedule/schedule-tools';
import { transcribeAudioTool } from './voice/transcribe-audio';
import { updateAgentPlanTool } from './plan/plan-tools';
import { askUserTool } from './interaction/ask-user';
import {
  createUserTaskTool,
  importTasksFromXlsxTool,
  listUserTasksTool,
  updateUserTaskTool,
} from './tasks/user-task-tools';
import { manageGoalsTool } from './tasks/goal-tools';
import { manageCommitmentsTool } from './tasks/commitment-tools';
import { buildDailyBriefTool, buildEveningReviewTool } from './tasks/steward-tools';

let defaultRegistry: ToolRegistry | null = null;

export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(askUserTool);
  registry.register(writeFileTool);
  registry.register(replaceTextTool);
  registry.register(listDirTool);
  registry.register(webSearchTool);
  registry.register(fetchUrlTool);
  registry.register(weatherTool);
  registry.register(translateTool);
  registry.register(readXlsxTool);
  registry.register(updateXlsxCellsTool);
  registry.register(convertToMarkdownTool);
  registry.register(genMarkdownTool);
  registry.register(genDocxTool);
  registry.register(updateDocxTextTool);
  registry.register(genXlsxTool);
  registry.register(genPdfTool);
  registry.register(genChartTool);
  registry.register(bookkeepingTool);
  registry.register(travelPlanTool);
  registry.register(recallMemoryTool);
  registry.register(searchWorldbookTool);
  registry.register(searchKnowledgeTool);
  registry.register(saveMemoryTool);
  registry.register(createScheduledTaskTool);
  registry.register(listScheduledTasksTool);
  registry.register(deleteScheduledTaskTool);
  registry.register(updateAgentPlanTool);
  registry.register(importTasksFromXlsxTool);
  registry.register(createUserTaskTool);
  registry.register(listUserTasksTool);
  registry.register(updateUserTaskTool);
  registry.register(manageGoalsTool);
  registry.register(manageCommitmentsTool);
  registry.register(buildDailyBriefTool);
  registry.register(buildEveningReviewTool);
  registry.register(transcribeAudioTool);
  return registry;
}

export function getBuiltinRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createBuiltinRegistry();
  }
  return defaultRegistry;
}
