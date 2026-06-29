# 数据库配置说明

## 路径（已固定）

| 用途 | 路径 |
|------|------|
| 数据库目录 | `D:\SQLlite` |
| 主库文件 | `D:\SQLlite\shorekeeper.db` |
| Agent 工作区 | `D:\SQLlite\workspace` |

代码中的默认值定义在 `src/config/paths.ts`，可通过环境变量覆盖（见 `.env.example`）。

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

### Migration 列表（M1–M3）

| 文件 | 内容 |
|------|------|
| `0000_init.sql` | 占位（基础表在 `src/db/index.ts` INIT_SQL） |
| `0001_memory_worldbook.sql` | `user_profile`、`long_term_memory`、`worldbook_entries` |
| `0002_worldbook_fts5.sql` | `worldbook_fts` 虚表 + trigger（sql.js 常跳过） |
| `0003_memory_key.sql` | `long_term_memory.memory_key` 唯一索引 |

### 种子数据（`pnpm db:seed`）

- `app_settings`：`persona.system_prompt`、`persona.version`
- `worldbook_entries`：10 条关键词触发型背景（已存在 id 则跳过）

种子源文件（可编辑后重新 `db:seed`）：

- `src/db/seeds/persona-shorekeeper.ts`
- `src/db/seeds/worldbook-shorekeeper.ts`

## 主要数据表（当前）

| 表 | 用途 |
|----|------|
| `sessions` | 会话 |
| `messages` | 消息（工作记忆） |
| `app_settings` | 人设、提取状态等 KV |
| `user_profile` | 用户画像（设置页编辑，注入 prompt） |
| `long_term_memory` | 长期记忆（`memory_key` 结构化 upsert） |
| `worldbook_entries` | Worldbook 条目 |

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

复制整个文件即可：

```
D:\SQLlite\shorekeeper.db
```

建议在应用未运行时复制，或使用 SQLite 的 backup 命令。
