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
import { getStableSystemPrefix } from './stable-context';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
}

/**
 * 组装 system prompt：
 * - 稳定前缀（人设 + 工具 + 技能）→ 利于 prompt cache
 * - 半稳定（用户画像、会话摘要）
 * - 动态块（记忆 / Worldbook / RAG，随 query 变化）
 */
export async function buildSystemPrompt(input: ContextBuildInput): Promise<string> {
  const sections: string[] = [getStableSystemPrefix()];

  const profile = getProfileSummary();
  if (profile) sections.push(profile);

  const summaryBlock = formatSummaryForPrompt(getSessionSummary(input.sessionId));
  if (summaryBlock) sections.push(summaryBlock);

  const memories = searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) sections.push(memoryBlock);

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) sections.push(worldbookBlock);

  try {
    const hasDocuments = listDocuments().length > 0;
    if (shouldRunRag(input.userMessage, hasDocuments)) {
      const ragChunks = await retrieveRelevantChunks(input.userMessage, 5);
      const ragBlock = formatRagForPrompt(ragChunks);
      if (ragBlock) sections.push(ragBlock);
    }
  } catch (err) {
    console.warn('[rag] 检索失败，跳过 RAG 注入:', err);
  }

  return sections.join('\n\n');
}
