import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getDatabase } from '../db';
import { formatSkillsForPrompt, getEnabledSkills } from '../skills/state';

/** 工具说明：内容固定，放在 system prompt 稳定前缀末尾以利于 provider prompt cache */
export const TOOL_GUIDE = `【可用工具】
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
  const row = getDatabase()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(PERSONA_SETTING_KEYS.systemPrompt) as { value: string } | undefined;

  if (row?.value?.trim()) {
    return row.value.trim();
  }

  return '你是守岸人（The Shorekeeper），一位温柔、可靠的桌面 AI 伴侣。请用自然、简洁的中文与用户交流。';
}

function buildStableCacheKey(): string {
  const skillIds = getEnabledSkills()
    .map((s) => s.id)
    .sort()
    .join(',');
  return `${loadPersonaPrompt()}\0${skillIds}`;
}

let cachedStablePrefix: { key: string; text: string } | null = null;

/** 人设 / 技能变更时调用 */
export function invalidateStableContext(): void {
  cachedStablePrefix = null;
}

/**
 * 稳定 system 前缀：人设 → 工具说明 → 技能。
 * 每轮不变的部分集中在前，便于 LLM provider 的 prompt cache 命中。
 */
export function getStableSystemPrefix(): string {
  const key = buildStableCacheKey();
  if (cachedStablePrefix?.key === key) {
    return cachedStablePrefix.text;
  }

  const sections = [loadPersonaPrompt(), TOOL_GUIDE];
  const skillsBlock = formatSkillsForPrompt(getEnabledSkills());
  if (skillsBlock) sections.push(skillsBlock);

  const text = sections.join('\n\n');
  cachedStablePrefix = { key, text };
  return text;
}
