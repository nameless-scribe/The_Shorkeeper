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
- 图形工具（Navicat、DB Browser 等）可打开**同一文件** `shorekeeper.db` 查看数据；应用运行中一般可读，写入时偶有锁，建议以查看为主。

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
| `pnpm db:cleanup-sessions` | 删除无消息的空会话（保留当前活跃会话） |
| `pnpm db:reset-keep-models` | 清空业务数据，保留应用内 API 模型配置 |

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

建议在应用未运行时复制，或使用 SQLite 的 backup 命令。
