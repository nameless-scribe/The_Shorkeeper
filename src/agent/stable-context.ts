import { PERSONA_SETTING_KEYS } from '../db/seeds/persona-shorekeeper';
import { getSetting } from '../db/app-settings';
import type { ToolDefinition } from '../tools/types';

/** 各工具在 system prompt 中的简短说明（仅列出当前实际可用的工具） */
const TOOL_SUMMARY: Record<string, string> = {
  list_dir: '列出工作区目录',
  read_file: '读取工作区文件',
  write_file: '写入工作区文件（需用户确认）',
  replace_text: '精确替换工作区文本片段（需用户确认）',
  web_search: '网络搜索',
  fetch_url: '抓取网页正文',
  get_weather: '查询天气',
  translate: '翻译文本',
  read_xlsx: '读取工作区 Excel (.xlsx)',
  update_xlsx_cells: '安全修改现有 Excel 的指定单元格',
  convert_to_markdown: '将 Word/文本文件转为 Markdown',
  gen_markdown: '生成 Markdown 到工作区',
  gen_docx: '生成 Word 到工作区',
  gen_xlsx: '生成 Excel 到工作区',
  gen_pdf: '生成 PDF 到工作区',
  bookkeeping: '记账（add/list/summary）',
  travel_plan: '生成旅行规划 Markdown',
  recall_memory: '检索长期记忆',
  search_worldbook: '检索 Worldbook 设定',
  search_knowledge: '检索/列出用户导入的知识库文档',
  save_memory: '保存长期记忆',
  create_scheduled_task: '创建定时提醒',
  list_scheduled_tasks: '列出定时任务',
  delete_scheduled_task: '删除定时任务',
  update_agent_plan: '更新执行计划',
  import_tasks_from_xlsx: '从 Excel 导入待办',
  list_user_tasks: '列出用户待办',
  update_user_task: '更新用户待办',
};

const SCHEDULE_TOOL_HINT =
  '用户要求定时/周期/每天/几点提醒时，必须调用 create_scheduled_task，禁止仅口头答应「已设好」。' +
  '这是应用内弹窗提醒（需 Shorekeeper 保持运行），不是手机或系统闹钟。' +
  '「每天几点提醒我…」→ schedule_kind=recurring + cron（如每天 17:30 → "30 17 * * *"）；' +
  '「指定日期时间提醒一次」→ schedule_kind=once + run_at（ISO 本地时间，如 2026-06-30T17:30:00）。';

/** 根据当前可用工具生成说明，避免技能白名单禁用后仍提示不可用工具 */
export function formatToolGuideForPrompt(
  tools: ToolDefinition[],
  activeSkillIds: string[] = [],
): string | null {
  if (!tools.length) return null;

  const skillSet = new Set(activeSkillIds);
  const lines = tools.map((tool) => {
    const summary = TOOL_SUMMARY[tool.name] ?? tool.description.split('。')[0];
    return `- ${tool.name}：${summary}`;
  });

  const sections = [`【当前可用工具】\n${lines.join('\n')}`];
  if (tools.some((t) => t.name === 'create_scheduled_task')) {
    sections.push(`【定时提醒】${SCHEDULE_TOOL_HINT}`);
  }
  if (
    tools.some((t) => t.name === 'update_agent_plan') &&
    !skillSet.has('task-execution')
  ) {
    sections.push(
      '【执行计划】多步文件/表格任务须先调用 update_agent_plan 列出步骤，并逐步更新状态（pending → in_progress → completed）。',
    );
  }

  const workspaceWriteHint = skillSet.has('workspace-doc-edit')
    ? '用户要求修改/更新/保存工作区文件时，按已激活的「工作区文档维护」技能流程执行（read → write → 读回校验）。'
    : '用户要求修改/更新/保存工作区文件时，必须调用 write_file 或 gen_* 真正写入磁盘；不可只在回复文字中描述已修改。写入成功后用户会看到可点击打开的文件卡片。';

  sections.push(
    '【工作区文件】读取前必须先 list_dir 确认真实路径与文件名；禁止猜测子目录。' +
      '用户口述的《》书名号、文档标题不等于磁盘文件名；上传附件消息里给出的路径最准确。' +
      'read_file 失败时按错误提示中的候选路径重试，或 list_dir "." 列出根目录。' +
      `${workspaceWriteHint} ` +
      '涉及用户偏好或过往事实时，可先 recall_memory。' +
      (tools.some((t) => t.name === 'search_knowledge')
        ? ' 用户可能在讨论已导入的业务文档（知识库）；需要具体内容时请调用 search_knowledge，不要声称没有知识库。'
        : '') +
      '【工具错误】工具返回以「错误:」开头的消息时，必须在回复中如实引用具体错误原文；禁止用「临时问题」「工具侧故障」等模糊说法掩盖失败原因。',
  );

  return sections.join('\n\n');
}

function loadPersonaPrompt(): string {
  const prompt = getSetting(PERSONA_SETTING_KEYS.systemPrompt);

  if (prompt?.trim()) {
    return prompt.trim();
  }

  return '你是守岸人（The Shorekeeper），一位温柔、可靠的桌面 AI 伴侣。请用自然、简洁的中文与用户交流；回复只用文字，不使用 emoji、表情符号或颜文字。';
}

function buildStableCacheKey(): string {
  return loadPersonaPrompt();
}

let cachedStablePrefix: { key: string; text: string } | null = null;

/** 人设变更时调用 */
export function invalidateStableContext(): void {
  cachedStablePrefix = null;
}

/**
 * 稳定 system 前缀：人设 → 上下文优先级。
 * 工具说明与技能在 context-builder 中按本轮对话组装。
 */
export function getStableSystemPrefix(): string {
  const key = buildStableCacheKey();
  if (cachedStablePrefix?.key === key) {
    return cachedStablePrefix.text;
  }

  const sections = [
    loadPersonaPrompt(),
    '【上下文优先级】Worldbook 提供行为与背景规则；长期记忆记录用户偏好与事实；' +
      'RAG 引用块来自用户导入文档的事实。若内容冲突，以 RAG 引用为准。',
  ];

  const text = sections.join('\n\n');
  cachedStablePrefix = { key, text };
  return text;
}
