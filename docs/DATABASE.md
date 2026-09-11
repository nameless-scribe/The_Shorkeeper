# 数据库配置说明

## 路径（默认）

| 用途 | 路径 |
|------|------|
| 数据库目录 | `D:\SQLlite` |
| 主库文件 | `D:\SQLlite\shorekeeper.db` |
| Agent 工作区 | `D:\SQLlite\workspace` |
| 外观资源 | `D:\SQLlite\appearance\`（背景 `bg-*`、头像；`app_settings` 仅存文件名） |

代码默认值在 `src/config/paths.ts`；打包后若无法使用 `D:\SQLlite`，会回退到 Electron `userData` 下同名结构。环境变量见 `.env.example`。

## 运行时实现

- 本项目使用 **sql.js**（WASM SQLite）+ 手写 migration，兼容 Electron Windows。
- 应用启动时 `initDatabase()` 自动建表并执行 `src/db/migrations/*.sql`。
- `sql.js` 每次写操作同步确认落盘：先写入同目录临时文件并执行 `fsync`，再原子替换主库。落盘失败会返回给调用方，并从主库恢复内存状态。
- 业务 SQL 集中在 `src/db` 与 `src/db/repositories`；Agent、记忆、RAG、渲染、调度和工具层通过结构化接口访问数据，不直接依赖 sql.js。
- schema 变更前自动复制一份 `shorekeeper.db.pre-migration.bak-*`；每个 migration 的 SQL 和账本记录在同一事务中提交。
- `schema_migrations.status` 区分 `applied`、`skipped`、`partial`。`partial` 会直接中止启动，不允许应用在不确定的 schema 上继续运行。
- 应用运行时不得使用 Navicat、DB Browser 或 `sqlite3` 写入同一主库；`sql.js` 的下一次整库落盘可能覆盖外部修改。外部工具仅应在完全退出应用后使用。

## 内存模式 vs 文件模式

- **`:memory:`** — 仅存在于进程内存，退出后数据消失；单测临时库使用。
- **文件模式** — 本项目使用 `D:\SQLlite\shorekeeper.db`，数据持久保存。

## 初始化与迁移

```powershell
cd e:\TheShorekeeper

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
| `long_term_memory` | 长期记忆（`memory_key` 结构化 upsert） |
| `worldbook_entries` | Worldbook 条目 |
| `token_usage` | 按日 Token 统计（含 `cached_tokens`） |
| `scheduled_tasks` | 周期 / 一次性定时任务 |
| `documents` / `document_chunks` | RAG 文档与分块（embedding BLOB） |
| `document_chunks_fts` | 文档 FTS 索引（若环境支持 FTS5） |
| `mcp_servers` | MCP 服务配置 |
| `bookkeeping_entries` | 记账记录 |
| `session_summaries` | 长会话压缩摘要 |

### 查看长期记忆示例

```sql
SELECT memory_key, content, importance, created_at
FROM long_term_memory
ORDER BY created_at DESC;
```

M3 之后新写入的记忆应带 `memory_key`；历史无 key 行可手动清理。

## 用图形工具打开

在 **Navicat**（连接类型选 SQLite）、DB Browser for SQLite、DBeaver 等中打开：

```
D:\SQLlite\shorekeeper.db
```

## 备份

建议备份整个数据目录（含工作区与外观文件）：

```
D:\SQLlite\
├── shorekeeper.db
├── workspace\
└── appearance\
```

仅复制 `shorekeeper.db` 也可保留聊天与设置，但不含工作区文件与自定义壁纸。

应用会在实际 schema 变更前自动创建数据库快照，但这不能替代整个数据目录的定期备份。手动复制仍建议在应用未运行时进行；当前 `sql.js` 路线不应直接套用依赖原生 SQLite 连接的在线 backup 命令。

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
