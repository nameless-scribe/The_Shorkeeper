export const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  list_dir: '列出目录',
  read_xlsx: '读取 Excel',
  convert_to_markdown: '转 Markdown',
  gen_markdown: '生成 Markdown',
  gen_docx: '生成 Word',
  gen_xlsx: '生成 Excel',
  gen_pdf: '生成 PDF',
  web_search: '网络搜索',
  fetch_url: '抓取网页',
  recall_memory: '检索记忆',
  search_knowledge: '检索知识库',
  save_memory: '保存记忆',
  create_scheduled_task: '创建定时任务',
  list_scheduled_tasks: '列出定时任务',
  delete_scheduled_task: '删除定时任务',
  update_agent_plan: '更新执行计划',
  import_tasks_from_xlsx: '从 Excel 导入待办',
  list_user_tasks: '列出用户待办',
  update_user_task: '更新用户待办',
  travel_plan: '旅行规划',
  bookkeeping: '记账',
  get_weather: '查询天气',
  translate: '翻译',
};

export function toolDisplayName(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
