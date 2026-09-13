import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories, searchMemoriesWithEmbedding } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';
import {
  formatDocumentCatalogForPrompt,
  formatRagForPrompt,
  retrieveRelevantChunks,
} from '../rag/retriever';
import { listIndexedDocuments } from '../rag/documents';
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
import { normalizeAssistantMode } from '../assistant/mode';
import { getAssistantModePrompt } from '../assistant/mode-prompt';
import type { AssistantMode, TaskRunKind } from '../shared/types';
import {
  applyContextSectionBudget,
  DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  truncateToTokenBudget,
  type ContextBudgetReport,
  type ContextSection,
} from './context-budget';
import { peekInterruptedRunNotice } from './run-recovery';
import { listGoals } from '../db/repositories/goals';
import { listCommitments } from '../db/repositories/commitments';
import type { CreateTaskRunContextSourceInput } from '../db/repositories/context-sources';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
  availableTools?: ToolDefinition[];
  activeSkills?: Skill[];
  skillWarnings?: string[];
  assistantMode?: AssistantMode;
  signal?: AbortSignal;
  maxTokens?: number;
  /** 运行来源；中断说明只在用户主动的聊天轮次注入，不打进定时/语音 run */
  runKind?: TaskRunKind;
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
  /** 本轮注入了哪次中断 run 的说明；调用方在成功收口后确认 */
  interruptedRunId?: string;
  /** 只包含经过预算裁剪后真正进入本轮 prompt 的来源。 */
  contextSources: CreateTaskRunContextSourceInput[];
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
  const sourcesBySection = new Map<string, CreateTaskRunContextSourceInput[]>();
  sections.push({
    id: 'assistant_mode',
    text: getAssistantModePrompt(normalizeAssistantMode(input.assistantMode)),
    priority: 92,
    required: true,
    group: 'stable',
  });

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
  if (input.skillWarnings?.length) {
    sections.push({
      id: 'skill_warnings',
      text: `【技能状态】\n${input.skillWarnings.map((warning) => `- ${warning}`).join('\n')}\n如用户正在请求这些能力，请明确说明缺少的工具或设置，不要假装技能已执行。`,
      priority: 94,
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

  const interrupted = (input.runKind ?? 'chat') === 'chat'
    ? peekInterruptedRunNotice(input.sessionId)
    : null;
  if (interrupted) {
    sections.push({
      id: 'interrupted_run',
      text: interrupted.notice,
      priority: 88,
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
    sourcesBySection.set('long_term_memory', memories.map((memory) => ({
        sourceType: 'memory' as const,
        sourceId: memory.id,
        sourceRef: `mem:${memory.id}`,
        label: memory.memoryKey ?? '长期记忆',
        summary: memory.sensitivity === 'private'
          ? '已注入一条私密记忆（内容不写入运行审计）'
          : memory.content,
        sourceUpdatedAt: memory.updatedAt,
    })));
  }

  const escapeContext = (value: string) => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  try {
    const goals = listGoals({ status: 'active', limit: 5 });
    if (goals.length) {
    sections.push({
      id: 'active_goals',
      text: `【当前目标】\n使用目标信息时在相关句末附上对应 ref。\n${goals.map((goal) => `<goal ref="goal:${goal.id}" priority="${goal.priority}">${escapeContext(goal.title)}${goal.description ? ` — ${escapeContext(goal.description)}` : ''}</goal>`).join('\n')}`,
      priority: 68,
      group: 'dynamic',
    });
    sourcesBySection.set('active_goals', goals.map((goal) => ({
      sourceType: 'goal', sourceId: goal.id, sourceRef: `goal:${goal.id}`,
      label: goal.title, summary: goal.description, sourceUpdatedAt: goal.updatedAt,
    })));
    }

    const commitments = listCommitments({ statuses: ['proposed', 'open'], limit: 5 });
    if (commitments.length) {
    sections.push({
      id: 'open_commitments',
      text: `【未完成承诺】\n使用承诺信息时在相关句末附上对应 ref。\n${commitments.map((item) => `<commitment ref="commitment:${item.id}" owner="${item.owner}" status="${item.status}">${escapeContext(item.title)}</commitment>`).join('\n')}`,
      priority: 72,
      group: 'dynamic',
    });
    sourcesBySection.set('open_commitments', commitments.map((item) => ({
      sourceType: 'commitment', sourceId: item.id, sourceRef: `commitment:${item.id}`,
      label: item.title, summary: item.promisedTo ? `承诺对象：${item.promisedTo}` : null,
      sourceUpdatedAt: item.updatedAt,
    })));
    }
  } catch (error) {
    console.warn('[context] 目标与承诺读取失败，跳过注入:', error);
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
    const documents = listIndexedDocuments();
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
      const documentById = new Map(documents.map((document) => [document.id, document]));
      const ragChunks = (await retrieveRelevantChunks(retrievalQuery, 5, {
        signal: input.signal,
      })).map((chunk) => {
        const document = documentById.get(chunk.documentId);
        return {
          ...chunk,
          documentVersion: document?.version,
          freshnessStatus: document?.freshnessStatus,
          lastCheckedAt: document?.lastCheckedAt,
        };
      });
      const ragBlock = formatRagForPrompt(ragChunks);
      if (ragBlock) {
        sections.push({
          id: 'rag_references',
          text: ragBlock,
          priority: 90,
          group: 'dynamic',
        });
        sourcesBySection.set('rag_references', ragChunks.map((chunk) => ({
          sourceType: 'document',
          sourceId: chunk.documentId,
          sourceRef: `doc:${chunk.documentId}#chunk:${chunk.chunkIndex}`,
          label: `${chunk.filename} · 片段 ${chunk.chunkIndex + 1}`,
          summary: `相关度 ${chunk.score.toFixed(2)} · 来源状态 ${chunk.freshnessStatus ?? 'unknown'}`,
          documentVersion: chunk.documentVersion ?? null,
          sourceUpdatedAt: chunk.lastCheckedAt ?? null,
        })));
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
  const interruptedInjected = interrupted &&
    budgeted.report.includedSectionIds.includes('interrupted_run');

  return {
    stable,
    dynamic,
    combined,
    budget: budgeted.report,
    contextSources: budgeted.report.includedSectionIds.flatMap(
      (sectionId) => sourcesBySection.get(sectionId) ?? [],
    ),
    ...(interruptedInjected ? { interruptedRunId: interrupted.runId } : {}),
  };
}
