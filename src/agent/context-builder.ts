import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getDatabase } from '../db';
import { getProfileSummary } from '../memory/user-profile';
import { formatMemoriesForPrompt, searchMemories } from '../memory/long-term';
import { formatWorldbookForPrompt, matchWorldbook } from '../memory/worldbook';
import { formatRagForPrompt, retrieveRelevantChunks } from '../rag/retriever';
import { listDocuments } from '../rag/documents';
import { formatSkillsForPrompt, getEnabledSkills } from '../skills/state';
import { shouldRunRag } from '../config/performance';
import {
  formatSummaryForPrompt,
  getSessionSummary,
} from '../memory/session-context';

export interface ContextBuildInput {
  userMessage: string;
  sessionId: string;
}

const TOOL_GUIDE = `【可用工具】
- list_dir / read_file / write_file：工作区文件读写
- web_search / fetch_url / get_weather / translate：网络搜索、抓取、天气、翻译
- gen_markdown / gen_docx / gen_xlsx / gen_pdf：生成文档到工作区
- bookkeeping：记账（add/list/summary）
- travel_plan：生成旅行规划 Markdown
- recall_memory / search_worldbook / save_memory：记忆与设定
- create_scheduled_task / list_scheduled_tasks / delete_scheduled_task：定时提醒

当用户说「每天几点提醒我…」→ schedule_kind=recurring + cron。
当用户说「明天/指定日期时间提醒一次」→ schedule_kind=once + run_at（ISO 本地时间）。
write_file 与文档生成会写入工作区，需用户确认。
当用户询问工作区文件时，请主动调用 list_dir 或 read_file。
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
 * 人设 → 用户画像 → 会话摘要 → 长期记忆 → RAG → Worldbook → 技能 → 工具说明
 */
export async function buildSystemPrompt(input: ContextBuildInput): Promise<string> {
  const sections: string[] = [loadPersonaPrompt()];

  const profile = getProfileSummary();
  if (profile) sections.push(profile);

  const summaryBlock = formatSummaryForPrompt(getSessionSummary(input.sessionId));
  if (summaryBlock) sections.push(summaryBlock);

  const memories = searchMemories(input.userMessage, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);
  if (memoryBlock) sections.push(memoryBlock);

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

  const worldbookHits = matchWorldbook(input.userMessage, 5);
  const worldbookBlock = formatWorldbookForPrompt(worldbookHits);
  if (worldbookBlock) sections.push(worldbookBlock);

  const skillsBlock = formatSkillsForPrompt(getEnabledSkills());
  if (skillsBlock) sections.push(skillsBlock);

  sections.push(TOOL_GUIDE);

  return sections.join('\n\n');
}
