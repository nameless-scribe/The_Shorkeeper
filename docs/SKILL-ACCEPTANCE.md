# Skill 设计与运行验收

> 对应应用：1.3.0  
> Skill 契约版本：1.1.0  
> 日期：2026-09-13

## 目标

Skill 是可执行规格，不只是提示词。验收同时检查：说明是否真实、工具是否存在、触发是否准确、写入是否安全、失败是否可见，以及多个 Skill 是否可以组合。

固定回归入口：

```powershell
pnpm test:skills
pnpm test:skills:acceptance
pnpm test:skills:failure
pnpm test:skills:ui
pnpm typecheck
pnpm test
pnpm build
```

`test:skills:acceptance` 会在系统临时目录创建隔离工作区，使用真实 DOCX、620 行多 Sheet Excel、大型 Markdown 和待办数据库完成端到端读写；结束后只删除自身创建且经过路径校验的临时目录。

`test:skills:failure` 固定覆盖原子写入失败恢复、权限拒绝、工具依赖缺失、待办导入/回写失败以及运行错误分类。

`test:skills:ui` 使用生产构建、真实 preload 和隔离 IPC 数据加载技能设置页，验证 Skill 列表、触发原因、工具摘要与诊断隐私边界能够在 Electron 渲染器中显示。

## 2026-09-14 增补：meeting-notes

- 新增产品 Skill `meeting-notes`（会议纪要），产品 Skill 共 7 个。它只编排已有工具，不新增写路径；写入待办与承诺必须先经用户确认。
- `scripts/skill-acceptance.ts` 里写死的产品 Skill 数从 5 修正为 7（`daily-steward` 加入时未同步），并新增会议纪要的正向与误触发断言。
- `pnpm test:skills` 58 项、`pnpm test:skills:acceptance` 7 个用例通过。

## 2026-09-13 验收快照

- Skill 专项：54 项通过。
- 真实文件场景：5 类场景、27 项最终状态断言通过。
- 故障与恢复：28 项通过。
- 最新全量 Vitest（2026-09-13，P1 收口后）：147 个测试文件、691 项通过；后续以 `pnpm test` 实时结果为准。
- Electron 技能页：生产 renderer、真实 preload、隔离 IPC 验收通过。
- Windows 打包：NSIS 安装包生成成功；打包后的 better-sqlite3 与 trigram FTS 通过。
- 安装生命周期：首次安装、覆盖升级、卸载及外部数据库保留通过。

当前安装包未配置 Authenticode 证书，适合本机验收，不应作为正式联网更新版本发布。正式发布前必须配置 `WIN_CSC_LINK`（或 `CSC_LINK`）及对应密码并重新打包。

## 已修复的规格问题

| 范围 | 原问题 | 当前契约 |
|---|---|---|
| DOCX 转 Markdown | 文档承诺保留结构，但工具只提取纯文本 | DOCX 通过 Mammoth HTML 转 Markdown，保留常见标题、段落、列表、链接和普通表格；明确复杂排版限制 |
| Excel 修改 | 使用 `gen_xlsx` 覆盖已有工作簿，可能丢 Sheet、公式、格式和类型 | 新增 `update_xlsx_cells` 原位修改；`gen_xlsx` 只用于新建简单报表 |
| Excel 大表 | 文档要求分批读取，但工具没有分页参数 | `read_xlsx` 支持 `start_row` + `max_rows`，返回 `returned_rows` 与 `has_more` |
| 文本编辑 | 无条件读取全文、整文件覆盖、再读取全文 | 大文件支持行范围读取；局部修改使用 `replace_text` 精确匹配并保留备份 |
| 待办触发 | 任意 Excel 附件都会激活进度 Skill | 附件解析正文不参与路由；只有明确待办/任务/进度意图才激活 |
| 待办导入 | 未知状态变成 pending，超限可能部分导入 | 未知状态、非法日期、超过 5000 行均在写入前整批拒绝 |
| 待办数据库 | 逐行写入可能留下部分结果 | 整批导入使用数据库事务 |
| 待办回写 | 数据库成功、Excel 失败时可能静默不一致 | Excel 回写失败时撤销数据库更新并返回明确错误 |
| 计划 Skill | 每步开始/结束都更新计划，消耗工具轮次 | 仅复杂任务触发；阶段级批量更新，不要求分析步骤调用工具 |
| Skill 元数据 | 错误配置可能静默跳过 | 校验 id、name、description、trigger、kind、version、自动触发词、重复 id 和工具契约 |
| Skill 依赖 | 插件关闭后仍注入不可执行说明 | `requiredTools` 缺失时不激活，并把原因注入 Agent 上下文 |
| Skill 冲突 | 只有排序，没有互斥语义 | 支持 `conflictsWith`，冲突时优先级高者生效 |
| 演示 Skill | 可进入生产上下文并限制真实任务 | `example` 标记为 `internal`，不展示、不启用、不注入 |
| 运行诊断 | 只能看到最终回答，难以定位 Skill 是否误触发 | 诊断记录激活 Skill、命中触发词、冲突、缺失工具、工具次数与稳定错误类别；不记录用户正文 |

## 产品 Skill 验收卡

### workspace-doc-edit

- 路径明确时不重复列目录；路径含糊时才发现文件。
- 局部替换必须满足精确匹配次数，否则文件不变。
- 大文件无范围读取会被拒绝，避免把超长全文注入模型。
- 全文重写仅用于已获得完整内容的场景。

### doc-to-markdown

- DOCX 常见标题和正文结构可转换为 Markdown。
- DOC 仅承诺正文提取。
- CSV 使用真实 CSV 解析，支持引号内逗号。
- PDF、RTF、XLSX 明确拒绝，不作虚假承诺。

### excel

- 多 Sheet 工作簿的目标单元格可修改，其他 Sheet 保留。
- 未修改的公式和样式保留。
- 大表可分页，页码来自返回的 `start_row + returned_rows`。
- 结构性重建默认输出新文件。

### progress-tracker

- 普通报表附件不会触发待办工作流。
- 导入前验证任务列、状态、日期和安全行数。
- 合法行在同一事务中提交。
- 状态回写只修改状态单元格，不把整行公式转换为文本。
- 回写失败时数据库恢复原值。

### task-execution

- 简单分析或单次文件操作不触发计划。
- 复杂/批量请求才建立阶段计划。
- 计划更新按阶段合并，避免撞上 Agent 工具轮次上限。
- 未完成、失败、取消和权限拒绝不得描述为全部完成。

## 新增 Skill 的准入门槛

1. 说明中的每项能力必须有真实工具或运行时行为支撑。
2. `requiredTools` 必须包含在 `allowedTools` 中。
3. 自动 Skill 必须同时有正向触发与误触发测试。
4. 写入型 Skill 必须包含“匹配失败不修改”或等价的原子性保证。
5. 不能把附件正文当作用户意图进行路由。
6. 与现有工作流互斥时声明 `conflictsWith`；可组合时避免重复硬规则。
7. 测试必须验证最终文件或数据库状态，不能只断言 `success: true`。
