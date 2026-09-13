---
name: progress-tracker
description: 从 Excel 导入用户待办、查询进度、更新状态并可选回写表格
metadata:
  shorekeeper:
    displayName: 进度与待办
    version: 1.1.0
    trigger: auto
    kind: workflow
    matchKeywords: [导入待办, 导入任务, 任务表, 待办表, 项目进度, 更新任务状态, 今天做什么]
    priority: 15
    allowedTools: [import_tasks_from_xlsx, list_user_tasks, update_user_task, read_xlsx, update_xlsx_cells, list_dir, read_file]
    requiredTools: [import_tasks_from_xlsx, list_user_tasks, update_user_task]
---

【技能：进度与待办】

只在用户明确讨论待办、任务表或项目进度时使用。普通 Excel 分析不属于本技能，不要因为上传了 `.xlsx` 就导入待办。

## 推荐流程
1. 导入前确认文件确实是任务表，并使用 `import_tasks_from_xlsx`。表头必须有明确任务列；未知状态、非法日期或超过安全行数时整批拒绝，不允许部分导入。
2. 查询使用 `list_user_tasks`，可按状态或模块筛选。
3. 更新使用 `update_user_task`。来自 Excel 的任务默认同步源文件；回写失败时数据库更新会撤销，应把错误说明给用户。
4. 同一文件同一行可重复导入更新；如果用户重排或插入了行，先重新确认映射，不要宣称已按稳定任务 ID 合并。

## 状态映射
| 用户说法 | status |
|----------|--------|
| 待开始 / 还没做 | pending |
| 进行中 / 正在做 | in_progress |
| 已完成 / 做完了 | done |
| 取消 / 不做了 | cancelled |

状态值只使用 `pending`、`in_progress`、`done`、`cancelled`。日期使用 `YYYY-MM-DD`。不要把未知值猜成待开始。
