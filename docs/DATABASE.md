# 数据库配置说明

## 路径（已固定）

| 用途 | 路径 |
|------|------|
| 数据库目录 | `D:\SQLlite` |
| 主库文件 | `D:\SQLlite\shorekeeper.db` |
| Agent 工作区 | `D:\SQLlite\workspace` |

代码中的默认值定义在 `src/config/paths.ts`，可通过环境变量覆盖（见 `.env.example`）。

## 内存模式 vs 文件模式

- **`:memory:`** — 仅存在于进程内存，退出后数据消失；适合临时测试。
- **文件模式** — 本项目使用 `D:\SQLlite\shorekeeper.db`，数据持久保存。

你在本机安装的 SQLite（命令行或图形工具）与项目里用的 **better-sqlite3** 是两套东西：

- 系统 / 工具里的 SQLite：可手动打开 `D:\SQLlite\shorekeeper.db` 查看数据。
- 项目运行时：Node 通过 `better-sqlite3` 读写同一文件。

## 初始化数据库

### 方式 A：Python（无需编译，推荐先用来建文件）

```powershell
cd e:\TheShorekeeper
python scripts/init-db.py
```

### 方式 B：Node（需 better-sqlite3 编译成功）

```powershell
pnpm db:init
```

### 写入守岸人种子数据（人设 + Worldbook）

基于 `守岸人.txt` 整理的 prompt 与 Worldbook 条目，幂等写入数据库：

```powershell
pnpm db:seed
```

- `app_settings`：`persona.system_prompt`、`persona.version`
- `worldbook_entries`：10 条关键词触发型背景（已存在 id 则跳过）
- 同时应用 `src/db/migrations/0001_memory_worldbook.sql`（含 FTS5）

种子源文件（可编辑后重新 `db:seed`）：

- `src/db/seeds/persona-shorekeeper.ts`
- `src/db/seeds/worldbook-shorekeeper.ts`

若报错 `Could not locate the bindings file`，需安装 **Visual Studio「使用 C++ 的桌面开发」** 工作负载，然后：

```powershell
pnpm rebuild better-sqlite3
pnpm db:init
```

## 用图形工具打开

在 DB Browser for SQLite、DBeaver 等中打开：

```
D:\SQLlite\shorekeeper.db
```

即可查看 `sessions`、`messages`、`app_settings` 表。

## 备份

复制整个文件即可：

```
D:\SQLlite\shorekeeper.db
```

建议在应用未运行时复制，或使用 SQLite 的 backup 命令。
