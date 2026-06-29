import { listMessages } from '../db/repositories/messages';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { getPerformanceSettings } from '../config/performance';
import { getSetting, setSetting } from '../db/app-settings';
import {
  getExtractedUpToMessageId,
  markExtractedUpToMessageId,
} from './extraction-state';
import {
  formatMemoriesForExtraction,
  listMemories,
  upsertMemory,
} from './long-term';

export interface StructuredMemoryFact {
  key: string;
  content: string;
}

function buildExtractionPrompt(existingMemories: string): string {
  return `你是记忆提取助手。你的任务是从「本轮新对话」中提取值得长期记住的用户事实。

【已有长期记忆】
${existingMemories}

【规则】
1. 只分析本轮对话，不要重复提取已有记忆中已覆盖的事实
2. 若本轮更新了某个已有主题（如称呼变了），复用相同的 memory_key 并输出新 content
3. 若无任何新事实或更新，输出 []
4. 不要编造对话中未出现的信息
5. memory_key 命名规范：
   - user.nickname — 称呼/名字
   - user.preference.* — 偏好（如 user.preference.drink）
   - user.schedule.* — 作息/忙碌时段
   - user.relationship.* — 与助手的关系、情感
   - user.habit.* — 习惯
   - user.other.* — 其他（尽量用具体子 key，如 user.other.weekend_activity）

【输出格式】
仅输出 JSON 数组，例如：
[{"key":"user.nickname","content":"用户名叫汐"}]`;
}

function parseStructuredFacts(raw: string): StructuredMemoryFact[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is { key?: string; content?: string } => {
        return typeof item === 'object' && item !== null;
      })
      .map((item) => ({
        key: String(item.key ?? '').trim(),
        content: String(item.content ?? '').trim(),
      }))
      .filter((item) => item.key && item.content);
  } catch {
    return [];
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
    return [{ id: last.id, role: last.role, content: last.content }];
  }

  return [];
}

/** run_finished 后异步提取：仅分析本轮增量，按 key upsert */
export async function extractMemoriesFromSession(sessionId: string): Promise<number> {
  const config = getModelConfigSafe();
  if (!config) return 0;

  const turn = getLatestTurn(sessionId);
  if (!turn.length) return 0;

  const latestUserMessage = turn.find((m) => m.role === 'user');
  if (!latestUserMessage) return 0;

  if (getExtractedUpToMessageId(sessionId) === latestUserMessage.id) {
    return 0;
  }

  const existingMemories = formatMemoriesForExtraction(listMemories(80));
  const dialogue = formatTurnDialogue(turn);

  const reply = await completeChat(
    [
      { role: 'system', content: buildExtractionPrompt(existingMemories) },
      {
        role: 'user',
        content: `请从以下本轮对话中提取新事实或需更新的记忆：\n\n${dialogue}`,
      },
    ],
    config,
    { sessionId },
  );

  markExtractedUpToMessageId(sessionId, latestUserMessage.id);

  const facts = parseStructuredFacts(reply);
  if (!facts.length) return 0;

  let saved = 0;
  for (const fact of facts) {
    await upsertMemory(fact.key, fact.content, 0.55, sessionId, { skipEmbedding: true });
    saved += 1;
  }

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
export function shouldAutoExtractMemories(sessionId: string, _userMessage: string): boolean {
  const { memoryExtractMode, memoryExtractInterval } = getPerformanceSettings();

  if (memoryExtractMode === 'manual') return false;

  if (memoryExtractMode === 'every_n') {
    const turns = incrementSessionTurnCount(sessionId);
    if (turns % memoryExtractInterval !== 0) return false;
  }

  return true;
}
