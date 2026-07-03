---
id: progress-tracker
name: 进度与待办
description: 从 Excel 导入用户待办、查询进度、更新状态并可选回写表格
version: 1.0.0
trigger: auto
matchKeywords: 待办, 进度, 导入任务, 任务表, 附件已解析, 今天做什么
priority: 15
allowedTools: import_tasks_from_xlsx, list_user_tasks, update_user_task, read_xlsx, gen_xlsx, list_dir, read_file
---

【技能：进度与待办】

## 适用场景
- 用户上传进度/任务 Excel，要「导入待办」「今天做什么」「把 P3 标为进行中」
- 两天工作计划、模块确认进度跟踪

## 推荐流程
1. 若用户刚上传 `.xlsx` 且消息含 `[工作区附件已解析]`，可直接分析；否则 `read_xlsx`。
2. **首次同步**：`import_tasks_from_xlsx`（path 用附件消息中的工作区路径）。
3. **查询**：`list_user_tasks`（可按 status、module 筛选）。
4. **更新**：`update_user_task`（改 status / notes / due_at）；默认会尝试回写 Excel 状态列。
5. 需要整体改表结构或批量导出时：`read_xlsx` → 内存处理 → `gen_xlsx`。

## 状态映射
| 用户说法 | status |
|----------|--------|
| 待开始 / 还没做 | pending |
| 进行中 / 正在做 | in_progress |
| 已完成 / 做完了 | done |
| 取消 / 不做了 | cancelled |

## 与多步执行技能配合
复杂任务（导入 + 分析 + 写报告）时同时启用「多步任务执行」：先用 `update_agent_plan` 列步骤，再按上表调用待办工具。
