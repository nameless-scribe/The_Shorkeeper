import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getDatabase } from '../db';
import { formatSkillsForPrompt, getEnabledSkills } from '../skills/state';
import type { ToolDefinition } from '../tools/types';

/** 各工具在 system prompt 中的简短说明（仅列出当前实际可用的工具） */
const TOOL_SUMMARY: Record<string, string> = {
  list_dir: '列出工作区目录',
  read_file: '读取工作区文件',
  write_file: '写入工作区文件（需用户确认）',
  web_search: '网络搜索',
  fetch_url: '抓取网页正文',
  get_weather: '查询天气',
  translate: '翻译文本',
  gen_markdown: '生成 Markdown 到工作区',
  gen_docx: '生成 Word 到工作区',
  gen_xlsx: '生成 Excel 到工作区',
  gen_pdf: '生成 PDF 到工作区',
  bookkeeping: '记账（add/list/summary）',
  travel_plan: '生成旅行规划 Markdown',
  recall_memory: '检索长期记忆',
  search_worldbook: '检索 Worldbook 设定',
  save_memory: '保存长期记忆',
  create_scheduled_task: '创建定时提醒',
  list_scheduled_tasks: '列出定时任务',
  delete_scheduled_task: '删除定时任务',
};

const SCHEDULE_TOOL_HINT =
  '「每天几点提醒我…」→ schedule_kind=recurring + cron；「指定日期时间提醒一次」→ schedule_kind=once + run_at（ISO 本地时间，如 2026-06-30T10:00:00）。';

/** 根据当前可用工具生成说明，避免技能白名单禁用后仍提示不可用工具 */
export function formatToolGuideForPrompt(tools: ToolDefinition[]): string | null {
  if (!tools.length) return null;

  const lines = tools.map((tool) => {
    const summary = TOOL_SUMMARY[tool.name] ?? tool.description.split('。')[0];
    return `- ${tool.name}：${summary}`;
  });

  const sections = [`【当前可用工具】\n${lines.join('\n')}`];
  if (tools.some((t) => t.name === 'create_scheduled_task')) {
    sections.push(`【定时提醒】${SCHEDULE_TOOL_HINT}`);
  }
  sections.push(
    '当用户询问工作区文件时，请主动调用 list_dir 或 read_file。涉及用户偏好或过往事实时，可先 recall_memory。',
  );

  return sections.join('\n\n');
}

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

  const sections = [loadPersonaPrompt()];
  const skillsBlock = formatSkillsForPrompt(getEnabledSkills());
  if (skillsBlock) sections.push(skillsBlock);

  const text = sections.join('\n\n');
  cachedStablePrefix = { key, text };
  return text;
}
