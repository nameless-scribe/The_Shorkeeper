---
id: task-execution
name: 多步任务执行
description: 复杂文件/表格任务先列执行计划再逐步完成；禁止跳步或口头谎称已写入
version: 1.0.0
trigger: auto
matchKeywords: 多步, 执行计划, 分析, 汇总, 写回, 修改文件, 步骤
priority: 20
allowedTools: update_agent_plan, list_dir, read_file, read_xlsx, write_file, gen_markdown, gen_xlsx, convert_to_markdown
---

【技能：多步任务执行】

## 何时启用
用户要求分析/修改/汇总工作区文件，或任务明显需要 2 步以上（读表 → 分析 → 写回）。

## 硬性流程
1. **先**调用 `update_agent_plan` 列出全部步骤（id 如 step-1、step-2…）。
2. 开始某步前将该步标为 `in_progress`；完成后标为 `completed`。
3. 每步必须调用对应工具，不可只在回复中描述结果。
4. Excel：优先使用消息中已预解析的附件数据；需最新数据时再 `read_xlsx`。
5. 写回：`.xlsx` 用 `gen_xlsx`（先 read 再合并）；`.md`/`.txt` 用 `read_file` + `write_file`。
6. 全部步骤完成前，不得声称任务已结束。

## 计划示例
```json
{
  "items": [
    { "id": "step-1", "content": "读取 OA 进度表", "status": "in_progress" },
    { "id": "step-2", "content": "汇总待办模块", "status": "pending" },
    { "id": "step-3", "content": "写回或生成报告", "status": "pending" }
  ]
}
```

## 禁止
- 未调用 `update_agent_plan` 就开始多步操作。
- 工具失败时用「临时问题」等模糊说法；须引用工具返回的错误原文。
