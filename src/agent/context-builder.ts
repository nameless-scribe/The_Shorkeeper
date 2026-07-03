import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories, searchMemoriesWithEmbedding } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';
import {
  formatDocumentCatalogForPrompt,
  formatRagForPrompt,
  retrieveRelevantChunks,
} from '../rag/retriever';
import { listDocuments } from '../rag/documents';
import { shouldAutoRetrieveRag, shouldInjectRagCatalog, getPerformanceSettings } from '../config/performance';
import {
  formatSummaryForPrompt,
  getSessionSummary,
} from '../memory/session-context';
import { formatAffectionForPrompt } from '../affection';
import { formatSkillsForPrompt } from '../skills/loader';
import type { Skill } from '../skills/loader';
import { formatToolGuideForPrompt, getStableSystemPrefix } from './stable-context';
import type { ToolDefinition } from '../tools/types';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
  availableTools?: ToolDefinition[];
  activeSkills?: Skill[];
}

/**
 * 组装 system prompt：
 * - 稳定前缀（人设 + 上下文优先级）+ 本轮技能 + 工具说明
 * - 半稳定（用户画像、会话摘要）
 * - 动态块（记忆 / Worldbook / RAG，随 query 变化）
 */
export async function buildSystemPrompt(input: ContextBuildInput): Promise<string> {
  const parts = await buildSystemPromptParts(input);
  return parts.combined;
}

export interface SystemPromptParts {
  stable: string;
  dynamic: string | null;
  combined: string;
}

export async function buildSystemPromptParts(
  input: ContextBuildInput,
): Promise<SystemPromptParts> {
  const stableSections = [getStableSystemPrefix()];

  const skillsBlock = input.activeSkills?.length
    ? formatSkillsForPrompt(input.activeSkills)
    : null;
  if (skillsBlock) stableSections.push(skillsBlock);

  const activeSkillIds = input.activeSkills?.map((s) => s.id) ?? [];
  const toolGuide = input.availableTools
    ? formatToolGuideForPrompt(input.availableTools, activeSkillIds)
    : null;
  if (toolGuide) stableSections.push(toolGuide);

  const stable = stableSections.join('\n\n');
  const dynamicSections: string[] = [];

  dynamicSections.push(formatAffectionForPrompt());

  const profile = getProfileSummary();
  if (profile) dynamicSections.push(profile);

  const summaryBlock = formatSummaryForPrompt(getSessionSummary(input.sessionId));
  if (summaryBlock) dynamicSections.push(summaryBlock);

  const settings = getPerformanceSettings();
  const memories = settings.memorySemanticInContext
    ? await searchMemoriesWithEmbedding(input.userMessage, 5)
    : searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) dynamicSections.push(memoryBlock);

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) dynamicSections.push(worldbookBlock);

  try {
    const documents = listDocuments();
    const hasDocuments = documents.length > 0;
    const filenames = documents.map((d) => d.filename);
    if (shouldInjectRagCatalog(hasDocuments)) {
      const catalog = formatDocumentCatalogForPrompt(documents);
      if (catalog) dynamicSections.push(catalog);
    }
    if (shouldAutoRetrieveRag(input.userMessage, hasDocuments, filenames)) {
      const ragChunks = await retrieveRelevantChunks(input.userMessage, 5);
      const ragBlock = formatRagForPrompt(ragChunks);
      if (ragBlock) dynamicSections.push(ragBlock);
    }
  } catch (err) {
    console.warn('[rag] 检索失败，跳过 RAG 注入:', err);
  }

  const dynamic = dynamicSections.length ? dynamicSections.join('\n\n') : null;
  const combined = dynamic ? `${stable}\n\n${dynamic}` : stable;

  return { stable, dynamic, combined };
}
