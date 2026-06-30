import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';
import { formatRagForPrompt, retrieveRelevantChunks } from '../rag/retriever';
import { listDocuments } from '../rag/documents';
import { shouldRunRag } from '../config/performance';
import {
  formatSummaryForPrompt,
  getSessionSummary,
} from '../memory/session-context';
import { formatToolGuideForPrompt, getStableSystemPrefix } from './stable-context';
import type { ToolDefinition } from '../tools/types';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
  availableTools?: ToolDefinition[];
}

/**
 * 组装 system prompt：
 * - 稳定前缀（人设 + 工具 + 技能）→ 利于 prompt cache
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
  const stableBase = getStableSystemPrefix();
  const toolGuide = input.availableTools
    ? formatToolGuideForPrompt(input.availableTools)
    : null;
  const stable = toolGuide ? `${stableBase}\n\n${toolGuide}` : stableBase;
  const dynamicSections: string[] = [];

  const profile = getProfileSummary();
  if (profile) dynamicSections.push(profile);

  const summaryBlock = formatSummaryForPrompt(getSessionSummary(input.sessionId));
  if (summaryBlock) dynamicSections.push(summaryBlock);

  const memories = searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) dynamicSections.push(memoryBlock);

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) dynamicSections.push(worldbookBlock);

  try {
    const hasDocuments = listDocuments().length > 0;
    if (shouldRunRag(input.userMessage, hasDocuments)) {
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
