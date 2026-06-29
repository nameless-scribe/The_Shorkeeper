import { listMessages } from '../db/repositories/messages';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { isDuplicateMemory } from './dedupe';
import { listMemoryContents, saveMemory } from './long-term';

const EXTRACTION_PROMPT = `你是记忆提取助手。从对话中提取值得长期记住的用户相关事实（称呼、偏好、习惯、重要日期、职业等）。
规则：
- 只提取对话中明确出现的信息，不要编造
- 每条事实用一句简短中文
- 以 JSON 数组输出，例如：["用户喜欢喝咖啡","用户名叫小明"]
- 若无值得记住的内容，输出：[]`;

function parseFacts(raw: string): string[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function formatDialogue(
  rows: Array<{ role: string; content: string }>,
): string {
  return rows
    .map((row) => `${row.role === 'user' ? '用户' : '助手'}：${row.content}`)
    .join('\n');
}

/** run_finished 后异步提取并写入长期记忆 */
export async function extractMemoriesFromSession(sessionId: string): Promise<number> {
  const config = getModelConfigSafe();
  if (!config) return 0;

  const rows = listMessages(sessionId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12);

  if (rows.length < 2) return 0;

  const dialogue = formatDialogue(rows);
  const reply = await completeChat(
    [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `请从以下对话提取事实：\n\n${dialogue}` },
    ],
    config,
  );

  const facts = parseFacts(reply);
  if (!facts.length) return 0;

  const existing = listMemoryContents();
  let saved = 0;

  for (const fact of facts) {
    if (isDuplicateMemory(fact, existing)) continue;
    saveMemory(fact, 0.55, sessionId);
    existing.push(fact);
    saved += 1;
  }

  return saved;
}
