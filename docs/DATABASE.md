# 数据库配置说明

## 路径（默认）

| 用途 | 路径 |
|------|------|
| 数据库目录 | `D:\SQLlite` |
| 活动主库 | `D:\SQLlite\shorekeeper.native.db`（better-sqlite3） |
| sql.js 回滚源 | `D:\SQLlite\shorekeeper.db`（`SHOREKEEPER_DB_PATH` 指向此基路径） |
| 引擎标记 | `D:\SQLlite\shorekeeper.db.engine.json` |
| Agent 工作区 | `D:\SQLlite\workspace` |
| 外观资源 | `D:\SQLlite\appearance\`（背景 `bg-*`、头像；`app_settings` 仅存文件名） |

代码默认值在 `src/config/paths.ts`；打包后若无法使用 `D:\SQLlite`，会回退到 Electron `userData` 下同名结构。环境变量见 `.env.example`。

## 运行时实现

- 生产运行时使用 **better-sqlite3**；活动库为 `shorekeeper.native.db`。`sql.js` 只保留为回滚源和双 adapter 测试。
- 启动通过 `.engine.json` 选择引擎；标记损坏会阻断启动，不会静默回退。
- 应用启动时 `initDatabase()` 自动建表并执行 `src/db/migrations/*.sql`。
- sql.js 回滚路径每次写操作仍走临时文件 + `fsync` 原子替换；native 路径使用 WAL。
- 业务 SQL 集中在 `src/db` 与 `src/db/repositories`；Agent、记忆、RAG、渲染、调度和工具层通过 Repository 访问数据。
- schema 变更前自动复制一份迁移前备份；每个 migration 的 SQL 和账本记录在同一事务中提交。
- `schema_migrations.status` 区分 `applied`、`skipped`、`partial`。`partial` 会直接中止启动，不允许应用在不确定的 schema 上继续运行。
- 应用运行时不要用 Navicat、DB Browser 或 `sqlite3` 写入同一主库。完全退出后再用外部工具打开活动库 `shorekeeper.native.db`。

## 内存模式 vs 文件模式

- **`:memory:`** — 仅存在于进程内存，退出后数据消失；单测临时库使用。
- **文件模式** — 生产使用 `D:\SQLlite\shorekeeper.native.db`；`shorekeeper.db` 是 sql.js 回滚源。

## 初始化与迁移

```powershell
cd The_Shorkeeper

# 确保库文件存在并应用 migration
pnpm db:init

# 写入守岸人人设 + Worldbook 种子
pnpm db:seed
```

`pnpm db:migrate` 与 `pnpm db:init` 等效（均触发 `openDatabase` + migration）。

其他维护脚本：

| 命令 | 说明 |
|------|------|
| `pnpm db:health` | 只读检查完整性、迁移状态、关键表计数、Embedding 占用、备份和 sidecar 文件 |
| `pnpm db:backup list` | 按时间列出手动、迁移前、恢复前、旧版和损坏库备份 |
| `pnpm db:backup create` | 校验主库后创建手动备份并输出 SHA-256 |
| `pnpm db:cleanup-sessions` | 删除无消息的空会话（保留当前活跃会话） |
| `pnpm db:reset-keep-models` | 清空业务数据，保留应用内 API 模型配置 |
| `pnpm db:native status` | 查看当前引擎标记与活动库 |
| `pnpm db:native rehearse` | 只读副本迁移演练，不替换生产主库 |

使用 `pnpm db:health -- --json` 可输出结构化 JSON。健康状态为 `critical` 时命令退出码为 1；检查过程直接读取数据库文件，不触发建表、migration 或持久化。

### Migration 列表

| 文件 | 内容 |
|------|------|
| `0000_init.sql` | `sessions`、`messages`、`app_settings` |
| `0001_memory_worldbook.sql` | `user_profile`、`long_term_memory`、`worldbook_entries` |
| `0002_worldbook_fts5.sql` | `worldbook_fts` 虚表 + trigger（sql.js 环境常跳过） |
| `0003_memory_key.sql` | `long_term_memory.memory_key` 唯一索引 |
| `0004_m4_ui.sql` | `token_usage`、`scheduled_tasks` |
| `0005_schedule_kind.sql` | 定时任务类型字段扩展 |
| `0006_rag.sql` | `documents`、`document_chunks` |
| `0007_m6.sql` | `mcp_servers` |
| `0008_m7.sql` | `bookkeeping_entries`、`session_summaries`、会话归档字段 |
| `0009_token_cache.sql` | `token_usage.cached_tokens` |
| `0010_rag_fts.sql` | `document_chunks_fts`（FTS5 混合检索） |
| `0011_rag_metadata.sql` | 文档 `content_hash`、embedding 模型/维度元数据 |
| `0012_user_tasks.sql` | 用户待办及状态索引 |
| `0013_rag_summary.sql` | 文档摘要与目录字段 |
| `0014_rag_fts_trigram.sql` | 使用 trigram tokenizer 重建 RAG FTS 索引 |
| `0015_rag_doc_embedding.sql` | 文档级 embedding |
| `0016_rag_lifecycle.sql` | 文档生命周期状态 |
| `0017_rag_document_versions.sql` | 文档身份与版本链 |
| `0018_rag_index_config.sql` | 分块配置记录 |
| `0019_session_assistant_mode.sql` | 会话工作模式 |
| `0020_memory_candidates.sql` | 记忆候选队列 |
| `0021_task_runs.sql` | `task_runs`、`task_run_steps`、`artifacts`、`approvals`（P0 闭环骨架） |
| `0022_goals_commitments.sql` | `goals`、`commitments`、`briefings`，`user_tasks.goal_id`（P0 每日管家） |
| `0023_personal_memory_model.sql` | P1 个人事实类型/状态/敏感与时效字段、仅 active key 唯一、候选冲突元数据、`memory_sources` 来源链 |
| `0024_context_sources.sql` | P1 每次 run 实际注入的记忆、文档、目标与承诺来源账本 |
| `0025_document_freshness.sql` | P1 本地文档来源、mtime/size、检查状态与手工/自动同步策略 |

打包时 migration 以 `extraResources/db-migrations/` 形式随安装包分发；开发态直接读 `src/db/migrations/`。

### 种子数据（`pnpm db:seed`）

- `app_settings`：`persona.system_prompt`、`persona.version` 等
- `worldbook_entries`：关键词触发型背景（已存在 id 则跳过）

种子源文件（可编辑后重新 `db:seed`）：

- `src/db/seeds/persona-shorekeeper.ts`
- `src/db/seeds/worldbook-shorekeeper.ts`

## 主要数据表（当前）

| 表 | 用途 |
|----|------|
| `sessions` | 会话（含归档、压缩标记） |
| `messages` | 消息（工作记忆） |
| `app_settings` | KV：人设、主题 preset、外观资源文件名、插件开关、性能项等 |
| `user_profile` | 用户画像（设置页编辑，注入 prompt） |
| `long_term_memory` | 长期记忆事实；保存类型、独立置信度、敏感/模型使用策略、有效期、状态与替代关系；同一 `memory_key` 仅允许一条 active，历史版本可保留 |
| `worldbook_entries` | Worldbook 条目 |
| `token_usage` | 按日 Token 统计（含 `cached_tokens`） |
| `scheduled_tasks` | 周期 / 一次性定时任务 |
| `documents` / `document_chunks` | RAG 文档与分块（embedding BLOB） |
| `document_chunks_fts` | 文档 FTS 索引（若环境支持 FTS5） |
| `mcp_servers` | MCP 服务配置 |
| `bookkeeping_entries` | 记账记录 |
| `session_summaries` | 长会话压缩摘要 |
| `user_tasks` | 用户待办（Excel 导入或 `create_user_task` 直接创建） |
| `memory_candidates` | 待确认的记忆候选，含事实类型、敏感/模型使用策略、有效期、冲突对象与建议动作 |
| `memory_sources` | 长期记忆来源链，可关联 session/message/run/document/chunk/tool/goal/commitment 等稳定引用 |
| `task_runs` | 每次 Agent run 的持久化记录：来源、阶段、终态、模型、回复消息 id、步骤统计 |
| `task_run_steps` | run 内每次工具调用：顺序、工具名、风险等级、幂等声明、状态与错误分类 |
| `artifacts` | 工具产物证据：工作区相对路径、大小、SHA-256，关联 run 与步骤 |
| `approvals` | 权限确认记录：工具、参数摘要、风险等级、结论与决定方式（用户/超时/中止/窗口关闭/启动收口） |
| `goals` | 中长期目标：状态 `active / paused / done / dropped`、优先级、目标日期；待办和承诺通过 `goal_id` 分组 |
| `commitments` | 承诺：`owner = user` 必挂一条待办（`task_id`），`owner = assistant` 指向提醒（`scheduled_task_id`）；状态 `proposed / open / done / missed / cancelled`，完成时记录 `evidence_run_id` |
| `briefings` | 每日简报记录，`(brief_date, kind)` 唯一，保证早/晚简报每天只生成一次 |
| `task_run_context_sources` | run 实际使用的上下文来源；只保存稳定引用和限长脱敏摘要，不保存完整 prompt |

### 运行记录的生命周期

- `task_runs.phase` 取值：`created`、`running`、`waiting_tool`、`waiting_approval`、`finalizing`、`finished`、`cancelled`、`error`、`interrupted`。
- 终态只能由 run 自身收口一次；之后的迟到事件不会改写终态。
- 应用启动时 `reconcileInterruptedRuns()` 把所有非终态 run 标为 `interrupted`（`terminal_reason = process_exit`），运行中的步骤标为 `interrupted`，pending 审批标为 `interrupted / startup`。
- 下一次同会话对话会注入“上次运行中断”说明；只有那一轮成功产生回复后才写入 `acknowledged_at`，之后不再注入。若那一轮本身失败，说明会保留到再下一轮。
- 记录写入失败不会影响 run 本身：记录器在首次失败后停止本次 run 的持久化并打印告警。
- 上下文预算完成后，只有真正进入 prompt 的 memory/document/goal/commitment 才写入 `task_run_context_sources`；运行详情可据稳定引用回查当前来源。

### 查看长期记忆示例

```sql
SELECT memory_key, memory_type, content, importance, confidence,
       sensitivity, model_use_policy, status, valid_from, expires_at, updated_at
FROM long_term_memory
ORDER BY updated_at DESC;
```

`importance` 是检索重要度，`confidence` 是事实可信度，两者不可混用。0023 将既有记忆回填为 `other / active / normal / allow`，置信度使用中性默认值 `0.5`，不会把旧 `importance` 冒充为置信度。

P1.2 之后，提供给模型的常规列表、向量检索和 embedding 列表只返回 `status = active`、`model_use_policy = allow` 且未过期的事实。设置页使用独立管理查询，仍可查看 active 事实；`disputed / superseded / rejected` 与过期事实不会进入 prompt。同 key 新值不会直接更新旧行：冲突产生候选并把原事实标为 `disputed`，用户选择替代后旧行转为 `superseded`、新行成为 active，并通过 `superseded_by` 连接版本链。保留原事实会恢复 active；并存会为新事实生成独立情境 key。上述状态、候选和 `memory_sources` 来源写入在同一事务中完成，设置页手工编辑同样创建新版本，删除则软标记为 `rejected`。

P1.3/P1.4 之后，预算裁剪后真正进入 prompt 的记忆、文档片段、目标和承诺会写入 `task_run_context_sources`，但完整 prompt 与私密正文不会写入运行审计。`documents` 同时记录来源类型、mtime/size 基线、最近检查、新鲜度原因和同步策略。本地来源变化先标 `changed`，同步成功后才切换新版本；缺失或索引失败时继续保留上一可用快照。自动同步仅处理用户显式设为 `auto` 的来源，并在启动/唤醒时按 6 小时间隔、每批最多 20 个执行。

## 用图形工具打开

在 **Navicat**（连接类型选 SQLite）、DB Browser for SQLite、DBeaver 等中打开：

```
D:\SQLlite\shorekeeper.native.db
```

sql.js 回滚源仍是 `D:\SQLlite\shorekeeper.db`。

## 备份

建议备份整个数据目录（含工作区与外观文件）：

```
D:\SQLlite\
├── shorekeeper.native.db
├── shorekeeper.db
├── shorekeeper.db.engine.json
├── workspace\
└── appearance\
```

仅复制活动主库也可保留聊天与设置，但不含工作区文件与自定义壁纸。建议同时备份 `.engine.json` 和 sql.js 回滚源。

应用会在实际 schema 变更前自动创建数据库快照，但这不能替代整个数据目录的定期备份。手动复制仍建议在应用未运行时进行。

### 备份命令

```powershell
# 创建经过完整性校验的手动备份
pnpm db:backup create

# 列出所有可识别备份
pnpm db:backup list

# 校验一个备份，不修改主库
pnpm db:backup validate -- "D:\SQLlite\shorekeeper.db.manual.bak-..."

# 预览：保留最近 10 份可用备份
pnpm db:backup prune -- --keep 10

# 确认删除超出保留数量的旧备份
pnpm db:backup prune -- --keep 10 --yes
```

创建备份前应退出所有可能写库的外部 SQLite 工具。启动和手动备份都会拒绝非空 WAL，避免只复制主库而遗漏已提交事务。

首版保留策略按数量管理：建议保留最近 10 份可用备份。`prune` 默认只预览，只有显式追加 `--yes` 才会删除；历史损坏库备份不会被自动纳入删除候选。

### 恢复

请先完全退出 The Shorekeeper、Navicat、DB Browser 和其他可能打开该数据库的程序：

```powershell
pnpm db:backup restore -- "D:\SQLlite\shorekeeper.db.manual.bak-..." --yes
```

恢复流程会先校验备份，随后为当前主库创建 `pre-restore` 安全备份，再以原子替换方式恢复。检测到非空 WAL 时会中止；残留 SHM 会改名保留。当前只允许恢复主库目录中由系统识别的可用备份，损坏库备份不能直接恢复。
