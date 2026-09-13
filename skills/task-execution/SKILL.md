---
name: task-execution
description: 为复杂、批量或多文件任务维护精简的阶段计划，并如实记录未完成与失败项
metadata:
  shorekeeper:
    displayName: 多步任务执行
    version: 1.1.0
    trigger: auto
    kind: workflow
    matchKeywords: [多步任务, 执行计划, 批量处理, 分阶段完成, 持续推进]
    priority: 20
    allowedTools: [update_agent_plan, list_dir, read_file, replace_text, read_xlsx, update_xlsx_cells, write_file, gen_markdown, gen_xlsx, convert_to_markdown]
    requiredTools: [update_agent_plan]
---

【技能：多步任务执行】

仅用于包含多个可验证阶段、多个文件或三次以上外部工具操作的任务。简单读取、单文件修改或一次转换不需要计划。

1. 开始前用 `update_agent_plan` 建立少量、面向结果的阶段；不要把每次读取或思考拆成独立步骤。
2. 进入新阶段或阶段结果变化时更新计划。可以在一次更新中同时完成前一步并开始下一步，避免无意义的工具轮次。
3. 只有产生外部副作用的步骤必须有对应工具证据；分析和判断可以由模型完成。
4. 文件修改使用对应的安全工具：文本优先精确替换，现有 Excel 优先修改指定单元格，新产物才使用 `gen_*`。
5. 工具失败、用户取消或权限拒绝时，把对应阶段保留为未完成或取消，并明确最终未完成项。

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

不要逐字泄露可能包含内部路径或敏感信息的原始异常；保留具体、可操作的失败原因即可。不得在计划仍有未完成阶段时声称全部完成。
