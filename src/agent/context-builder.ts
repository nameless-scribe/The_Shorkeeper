import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getDatabase } from '../db';
import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
}

const TOOL_GUIDE = `【可用工具】
- list_dir：列出工作区目录中的文件
- read_file：读取工作区内的文本文件
- web_search：搜索网络信息
- recall_memory：按关键词检索长期记忆
- search_worldbook：搜索世界观 / 背景设定条目
- save_memory：将值得长期记住的事实写入记忆库

当用户询问工作区文件时，请主动调用 list_dir 或 read_file，不要编造文件列表。
当对话涉及用户偏好或过往事实时，可先 recall_memory 再回答。`;

function loadPersonaPrompt(): string {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(PERSONA_SETTING_KEYS.systemPrompt) as { value: string } | undefined;

  if (row?.value?.trim()) {
    return row.value.trim();
  }

  return '你是守岸人（The Shorekeeper），一位温柔、可靠的桌面 AI 伴侣。请用自然、简洁的中文与用户交流。';
}

/**
 * 按 DESIGN §5.1 顺序组装 system prompt：
 * 人设 → 用户画像 → 长期记忆 → (RAG 留 M5) → Worldbook → (技能留 M6) → 工具说明
 */
export function buildSystemPrompt(input: ContextBuildInput): string {
  const sections: string[] = [loadPersonaPrompt()];

  const profile = getProfileSummary();
  if (profile) sections.push(profile);

  const memories = searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) sections.push(memoryBlock);

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) sections.push(worldbookBlock);

  sections.push(TOOL_GUIDE);

  return sections.join('\n\n');
}
