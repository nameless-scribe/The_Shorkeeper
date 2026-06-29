import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getDatabase } from '../db';
import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';
import { formatRagForPrompt, retrieveRelevantChunks } from '../rag/retriever';
import { formatSkillsForPrompt, getEnabledSkills } from '../skills/state';

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
- create_scheduled_task：创建定时提醒。schedule_kind=recurring 时用 cron（如 "0 9 * * *" 每天9点）；schedule_kind=once 时用 run_at（ISO 时间，只提醒一次）
- list_scheduled_tasks：列出已有定时任务
- delete_scheduled_task：按 id 删除定时任务

当用户说「每天几点提醒我…」→ schedule_kind=recurring + cron。
当用户说「明天/指定日期时间提醒一次」→ schedule_kind=once + run_at（ISO 本地时间）。
当用户询问工作区文件时，请主动调用 list_dir 或 read_file，不要编造文件列表。
当用户消息中含「已上传以下文件到工作区」时，用 read_file 读取对应路径。
当对话涉及用户偏好或过往事实时，可先 recall_memory 再回答。
当用户明确要求「将本次对话计入/保存/写入知识库」时，系统会自动提炼对话并归档，无需你手动处理。`;

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
 * 人设 → 用户画像 → 长期记忆 → RAG → Worldbook → (技能留 M6) → 工具说明
 */
export async function buildSystemPrompt(input: ContextBuildInput): Promise<string> {
  const sections: string[] = [loadPersonaPrompt()];

  const profile = getProfileSummary();
  if (profile) sections.push(profile);

  const memories = searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) sections.push(memoryBlock);

  try {
    const ragChunks = await retrieveRelevantChunks(input.userMessage, 5);
    const ragBlock = formatRagForPrompt(ragChunks);
    if (ragBlock) sections.push(ragBlock);
  } catch (err) {
    console.warn('[rag] 检索失败，跳过 RAG 注入:', err);
  }

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) sections.push(worldbookBlock);

  const skillsBlock = formatSkillsForPrompt(getEnabledSkills());
  if (skillsBlock) sections.push(skillsBlock);

  sections.push(TOOL_GUIDE);

  return sections.join('\n\n');
}
