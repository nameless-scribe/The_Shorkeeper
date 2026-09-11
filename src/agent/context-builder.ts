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
import {
  applyContextSectionBudget,
  DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  truncateToTokenBudget,
  type ContextBudgetReport,
  type ContextSection,
} from './context-budget';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
  availableTools?: ToolDefinition[];
  activeSkills?: Skill[];
  signal?: AbortSignal;
  maxTokens?: number;
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
  budget: ContextBudgetReport;
}

export async function buildSystemPromptParts(
  input: ContextBuildInput,
): Promise<SystemPromptParts> {
  const settings = getPerformanceSettings();
  const retrievalQuery = truncateToTokenBudget(input.userMessage, 2_000);
  const sections: ContextSection[] = [{
    id: 'stable_prefix',
    text: getStableSystemPrefix(),
    priority: 100,
    required: true,
    group: 'stable',
  }];

  const skillsBlock = input.activeSkills?.length
    ? formatSkillsForPrompt(input.activeSkills)
    : null;
  if (skillsBlock) {
    sections.push({
      id: 'active_skills',
      text: skillsBlock,
      priority: 95,
      required: true,
      group: 'stable',
    });
  }

  const activeSkillIds = input.activeSkills?.map((s) => s.id) ?? [];
  const toolGuide = input.availableTools
    ? formatToolGuideForPrompt(input.availableTools, activeSkillIds)
    : null;
  if (toolGuide) {
    sections.push({
      id: 'tool_guide',
      text: toolGuide,
      priority: 90,
      required: true,
      group: 'stable',
    });
  }

  sections.push({
    id: 'affection',
    text: formatAffectionForPrompt(),
    priority: 30,
    group: 'dynamic',
  });

  const profile = getProfileSummary();
  if (profile) {
    sections.push({ id: 'profile', text: profile, priority: 65, group: 'dynamic' });
  }

  const summaryBlock = formatSummaryForPrompt(getSessionSummary(input.sessionId));
  if (summaryBlock) {
    sections.push({
      id: 'session_summary',
      text: summaryBlock,
      priority: 85,
      group: 'dynamic',
    });
  }

  const memories = settings.memorySemanticInContext
    ? await searchMemoriesWithEmbedding(retrievalQuery, 5, input.signal)
    : searchMemories(retrievalQuery, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) {
    sections.push({
      id: 'long_term_memory',
      text: memoryBlock,
      priority: 70,
      group: 'dynamic',
    });
  }

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) {
    sections.push({
      id: 'worldbook',
      text: worldbookBlock,
      priority: 80,
      group: 'dynamic',
    });
  }

  try {
    const documents = listDocuments();
    const hasDocuments = documents.length > 0;
    const filenames = documents.map((d) => d.filename);
    if (shouldInjectRagCatalog(hasDocuments)) {
      const catalog = formatDocumentCatalogForPrompt(documents);
      if (catalog) {
        sections.push({
          id: 'rag_catalog',
          text: catalog,
          priority: 40,
          group: 'dynamic',
        });
      }
    }
    if (shouldAutoRetrieveRag(input.userMessage, hasDocuments, filenames)) {
      const ragChunks = await retrieveRelevantChunks(retrievalQuery, 5, {
        signal: input.signal,
      });
      const ragBlock = formatRagForPrompt(ragChunks);
      if (ragBlock) {
        sections.push({
          id: 'rag_references',
          text: ragBlock,
          priority: 90,
          group: 'dynamic',
        });
      }
    }
  } catch (err) {
    if (input.signal?.aborted) throw err;
    console.warn('[rag] 检索失败，跳过 RAG 注入:', err);
  }

  const configuredInputBudget = settings.contextMaxInputTokens ?? DEFAULT_CONTEXT_MAX_INPUT_TOKENS;
  const systemBudget = input.maxTokens ?? Math.max(
    1024,
    Math.min(8000, Math.floor(configuredInputBudget * 0.4)),
  );
  const budgeted = applyContextSectionBudget(sections, systemBudget);
  const stable = budgeted.sections
    .filter((section) => section.group === 'stable')
    .map((section) => section.text)
    .join('\n\n');
  const dynamicSections = budgeted.sections
    .filter((section) => section.group === 'dynamic')
    .map((section) => section.text);
  const dynamic = dynamicSections.length ? dynamicSections.join('\n\n') : null;
  const combined = dynamic ? `${stable}\n\n${dynamic}` : stable;

  return { stable, dynamic, combined, budget: budgeted.report };
}
