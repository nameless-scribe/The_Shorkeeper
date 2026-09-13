import { listMessages } from '../db/repositories/messages';
import { completeChat } from '../models/complete-chat';
import { getModelRuntimeConfigSafe } from '../models/config';
import { getPerformanceSettings } from '../config/performance';
import { getSetting, setSetting } from '../db/app-settings';
import {
  DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  estimateTokens,
  truncateToTokenBudget,
} from '../agent/context-budget';
import {
  getExtractedUpToMessageId,
  markExtractedUpToMessageId,
} from './extraction-state';
import {
  formatMemoriesForExtraction,
  listMemories,
  upsertMemory,
} from './long-term';
import { createMemoryCandidate, hasRejectedMemoryFact } from '../db/repositories/memory-candidates';
import {
  getCurrentMemoryByKey,
  listMemoryEmbeddings,
} from '../db/repositories/long-term-memory';
import { allowsAutoMemoryExtraction } from '../assistant/mode';
import type { AssistantMode } from '../shared/types';
import {
  clampMemoryConfidence,
  assessMemoryFactRelation,
  evaluateMemoryCandidate,
  type MemoryCandidateDraft,
} from './candidate-policy';
import { parseCommitmentDrafts, proposeCommitmentsFromDrafts } from './commitment-extraction';
import { stageMemoryConflict } from './personal-memory-service';
import { embedText } from '../rag/embedding';
import { isSemanticallyDuplicateMemory } from './dedupe';
import { formatLocalDate } from '../tasks/due-date';

export interface ExtractMemoriesOptions {
  assistantMode?: AssistantMode;
}

export interface StructuredMemoryFact extends MemoryCandidateDraft {
  key: string;
  content: string;
}

function buildExtractionPrompt(existingMemories: string): string {
  const today = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
  return `你是记忆提取助手。你的任务是从「本轮新对话」中提取值得长期记住的用户事实。
今天是 ${formatLocalDate(today)}（星期${weekday}）；"明天""周五前"等相对时间请据此换算成绝对日期。

【已有长期记忆】
${existingMemories}

【规则】
1. 只分析本轮对话，不要重复提取已有记忆中已覆盖的事实
2. 若本轮更新了某个已有主题（如称呼变了），复用相同的 memory_key 并输出新 content
3. 若无任何新事实或更新，输出 []
4. 不要编造对话中未出现的信息
5. 置信度必须是 0 到 1 的数字；reason 简述为什么这是稳定事实
6. 每条事实必须给出 memory_type，只能是 identity / preference / relationship / event / goal / habit / procedure：
   - user.identity.* 或 user.nickname — 身份、名字、称呼
   - user.preference.* — 稳定偏好
   - user.relationship.* — 人物或与助手的关系
   - user.event.* — 有时间边界的个人事件
   - user.goal.* — 用户目标；确认后进入目标系统，不复制成长期记忆
   - user.habit.* / user.schedule.* — 习惯、作息、周期行为
   - user.procedure.* — 用户希望助手以后如何做事
   不得输出 user.other.*；无法归类就不要提取。
7. sensitivity 只能是 normal / private / sensitive。关系与行程至少 private；健康、财务等为 sensitive。
8. model_use_policy 只能是 allow / deny；sensitive 必须 deny。密码、Token、验证码、密钥、身份证号、银行卡号不得输出。
9. 事件可输出 expires_at，稳定事实可输出 valid_from；均使用 Unix 毫秒时间戳，不确定则省略。
10. 另外识别用户在本轮明确答应别人或自己要做的事（如"我周五前把报告发给老板""明天给妈妈打电话"），
   以 {"type":"commitment","title":"…","due":"YYYY-MM-DD 或 ISO 时间，不确定则省略","promised_to":"对象，可省略","confidence":0.9,"reason":"…"} 输出。
   只记用户自己的承诺，不记助手答应的事；假设、犹豫或已完成的事不算承诺。

【输出格式】
仅输出 JSON 数组，例如：
[{"key":"user.nickname","content":"用户名叫汐","memory_type":"identity","sensitivity":"normal","model_use_policy":"allow","confidence":0.95,"reason":"用户明确自我介绍"},
 {"type":"commitment","title":"周五前把报告发给老板","due":"2026-09-18","promised_to":"老板","confidence":0.9,"reason":"用户明确说要在周五前发"}]`;
}

function parseStructuredArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOptionalTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseStructuredFacts(items: unknown[]): StructuredMemoryFact[] {
  return items
    .filter((item): item is Record<string, unknown> => {
      return typeof item === 'object' && item !== null;
    })
    .filter((item) => item.type !== 'commitment')
    .map((item) => ({
      key: String(item.key ?? '').trim(),
      content: String(item.content ?? '').trim(),
      confidence: clampMemoryConfidence(item.confidence),
      reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 240) : '',
      memoryType: item.memory_type,
      sensitivity: item.sensitivity,
      modelUsePolicy: item.model_use_policy,
      validFrom: parseOptionalTimestamp(item.valid_from),
      expiresAt: parseOptionalTimestamp(item.expires_at),
    }))
    .filter((item) => item.key && item.content);
}

async function isSemanticDuplicate(
  content: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const existing = listMemoryEmbeddings(200).filter((memory) => memory.embedding);
  if (!existing.length) return false;
  try {
    const vector = new Float32Array(await embedText(content, signal));
    return isSemanticallyDuplicateMemory(vector, existing);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[memory] 语义去重失败，继续使用确定性 key/content 判定:', error);
    return false;
  }
}

function formatTurnDialogue(
  rows: Array<{ role: string; content: string }>,
): string {
  return rows
    .map((row) => `${row.role === 'user' ? '用户' : '助手'}：${row.content}`)
    .join('\n');
}

/** 取刚结束的一轮对话（最后一条 user + 紧随其后的 assistant） */
function getLatestTurn(sessionId: string): Array<{ id: string; role: string; content: string }> {
  const all = listMessages(sessionId).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  if (all.length < 2) return [];

  const last = all.at(-1)!;
  const secondLast = all.at(-2)!;

  if (last.role === 'assistant' && secondLast.role === 'user') {
    return [
      { id: secondLast.id, role: secondLast.role, content: secondLast.content },
      { id: last.id, role: last.role, content: last.content },
    ];
  }

  if (last.role === 'user') {
    return [];
  }

  return [];
}

/** run_finished 后异步提取：仅分析本轮增量，按候选策略保存或进入待确认队列。 */
export async function extractMemoriesFromSession(
  sessionId: string,
  signal?: AbortSignal,
  options?: ExtractMemoriesOptions,
): Promise<number> {
  if (!allowsAutoMemoryExtraction(options?.assistantMode)) return 0;

  const config = getModelRuntimeConfigSafe();
  if (!config) return 0;

  const turn = getLatestTurn(sessionId);
  if (!turn.length) return 0;

  const latestUserMessage = turn.find((m) => m.role === 'user');
  if (!latestUserMessage) return 0;

  if (getExtractedUpToMessageId(sessionId) === latestUserMessage.id) {
    return 0;
  }

  const { contextMaxInputTokens = DEFAULT_CONTEXT_MAX_INPUT_TOKENS } = getPerformanceSettings();
  const existingMemories = truncateToTokenBudget(
    formatMemoriesForExtraction(listMemories(80)),
    3000,
  );
  const systemPrompt = buildExtractionPrompt(existingMemories);
  const dialogueBudget = Math.max(
    512,
    Math.min(12_000, contextMaxInputTokens - estimateTokens(systemPrompt) - 1024),
  );
  const dialogue = truncateToTokenBudget(formatTurnDialogue(turn), dialogueBudget);

  const reply = await completeChat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请从以下本轮对话中提取新事实或需更新的记忆：\n\n${dialogue}`,
      },
    ],
    config,
    { sessionId, signal },
  );

  const items = parseStructuredArray(reply);
  const facts = parseStructuredFacts(items);
  try {
    // 承诺候选只进 proposed 队列，由简报或下一轮对话确认；失败不影响记忆提取。
    proposeCommitmentsFromDrafts(parseCommitmentDrafts(items), { sessionId });
  } catch (error) {
    console.warn('[memory] 承诺候选写入失败:', error instanceof Error ? error.message : error);
  }
  if (!facts.length) {
    markExtractedUpToMessageId(sessionId, latestUserMessage.id);
    return 0;
  }

  let saved = 0;
  const acceptedInBatch = new Set<string>();
  for (const fact of facts) {
    const evaluation = evaluateMemoryCandidate(fact);
    if (evaluation.decision === 'deny') continue;

    const batchKey = `${evaluation.key}\u0000${evaluation.content.trim().toLowerCase()}`;
    if (acceptedInBatch.has(batchKey)) continue;
    acceptedInBatch.add(batchKey);

    const existing = getCurrentMemoryByKey(evaluation.key);
    if (existing) {
      const relation = assessMemoryFactRelation(
        evaluation.key,
        evaluation.content,
        existing.memoryKey ?? '',
        existing.content,
      );
      if (relation === 'duplicate') continue;
      stageMemoryConflict({
        memoryKey: evaluation.key,
        content: evaluation.content,
        category: evaluation.category,
        confidence: evaluation.confidence,
        reason: evaluation.reason,
        sourceSessionId: sessionId,
        sourceMessageId: latestUserMessage.id,
        memoryType: evaluation.memoryType,
        sensitivity: evaluation.sensitivity,
        modelUsePolicy: evaluation.modelUsePolicy,
        validFrom: evaluation.validFrom,
        expiresAt: evaluation.expiresAt,
        conflictsWithMemoryId: existing.id,
        proposedAction: relation === 'supplement' ? 'merge' : 'replace',
      });
      continue;
    }

    // deny 策略（敏感 / 私密）的内容不得离开本机：跳过远端语义查重。
    if (evaluation.modelUsePolicy !== 'deny' && (await isSemanticDuplicate(evaluation.content, signal))) continue;

    if (evaluation.decision === 'silent') {
      if (hasRejectedMemoryFact(evaluation.key, evaluation.content)) continue;
      await upsertMemory(evaluation.key, evaluation.content, evaluation.confidence, sessionId, {
        skipEmbedding: true,
        memoryType: evaluation.memoryType,
        confidence: evaluation.confidence,
        sensitivity: evaluation.sensitivity,
        modelUsePolicy: evaluation.modelUsePolicy,
        validFrom: evaluation.validFrom ?? undefined,
        expiresAt: evaluation.expiresAt,
        sourceMessageId: latestUserMessage.id,
      });
      saved += 1;
      continue;
    }

    createMemoryCandidate({
      memoryKey: evaluation.key,
      content: evaluation.content,
      category: evaluation.category,
      confidence: evaluation.confidence,
      reason: evaluation.reason,
      sourceSessionId: sessionId,
      sourceMessageId: latestUserMessage.id,
      memoryType: evaluation.memoryType,
      sensitivity: evaluation.sensitivity,
      modelUsePolicy: evaluation.modelUsePolicy,
      validFrom: evaluation.validFrom,
      expiresAt: evaluation.expiresAt,
    });
  }

  markExtractedUpToMessageId(sessionId, latestUserMessage.id);

  return saved;
}

const TURN_COUNT_PREFIX = 'memory.extract_turns.';

function getSessionTurnCount(sessionId: string): number {
  const raw = getSetting(`${TURN_COUNT_PREFIX}${sessionId}`);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function incrementSessionTurnCount(sessionId: string): number {
  const next = getSessionTurnCount(sessionId) + 1;
  setSetting(`${TURN_COUNT_PREFIX}${sessionId}`, String(next));
  return next;
}

/** 根据性能设置决定是否自动提取记忆 */
export function shouldAutoExtractMemories(
  sessionId: string,
  _userMessage: string,
  assistantMode?: AssistantMode,
): boolean {
  if (!allowsAutoMemoryExtraction(assistantMode)) return false;

  const { memoryExtractMode, memoryExtractInterval } = getPerformanceSettings();

  if (memoryExtractMode === 'manual') return false;

  if (memoryExtractMode === 'every_n') {
    const turns = incrementSessionTurnCount(sessionId);
    if (turns % memoryExtractInterval !== 0) return false;
  }

  return true;
}
