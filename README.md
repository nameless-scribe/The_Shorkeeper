# The Shorekeeper

自用桌面 AI Agent：Electron + React + API 流式聊天 + SQLite。

## 环境要求

- Node.js **20+**
- pnpm
- 数据库通过 **sql.js** 读写（默认 `D:\SQLlite\shorekeeper.db`）

## 快速开始

1. 复制环境变量：

```powershell
copy .env.example .env
```

2. 编辑 `.env`，填入 **阿里云百炼 Qwen3.6-Plus**（详见 [docs/MODELS.md](docs/MODELS.md)）：

```env
OPENAI_API_KEY=sk-你的百炼APIKey
OPENAI_BASE_URL=https://你的接入点/compatible-mode/v1
DEFAULT_MODEL=qwen3.6-plus
INCLUDE_STREAM_USAGE=false
```

3. 初始化数据库（若尚未创建）：

```powershell
pnpm db:init
```

4. 启动开发模式：

```powershell
pnpm install
pnpm dev
```

若 Electron 下载失败，可设置镜像后重装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
pnpm rebuild electron
pnpm dev
```

## 打包（Windows）

```powershell
pnpm dist
```

安装包输出到 `release/` 目录。首次打包会下载 NSIS 相关工具，耗时较长。

## 路径说明

| 项 | 默认路径 |
|----|----------|
| 数据库 | `D:\SQLlite\shorekeeper.db`（`SHOREKEEPER_DB_PATH`） |
| 工作区 | `D:\SQLlite\workspace`（Agent 读写文件、生成文档） |
| 数据库目录 | `D:\SQLlite`（`SHOREKEEPER_DB_DIR`） |

可在 `.env` 中覆盖，详见 `src/config/paths.ts`。

## 性能 / Token 优化

设置 → **性能** 页，或 `.env`：

- `RAG_ENABLED` — 是否注入 RAG 检索
- `AUTO_MEMORY_EXTRACT` — 记忆自动提取（设置页可选每轮 / 每 N 轮 / 手动）
- `MAX_HISTORY_MESSAGES` — 送入模型的最近消息条数（默认 20）
- `COMPRESS_THRESHOLD` — 长会话压缩阈值（默认 30 条）

## 项目结构

```
electron/          # 主进程、preload、IPC
src/agent/         # 对话编排
src/tools/         # 内置工具（文件、网络、文档、记账等）
src/models/        # API 模型适配
src/db/            # SQLite（sql.js）
src/renderer/      # React 聊天 UI
```

## 文档

- [DESIGN.md](docs/DESIGN.md) — 架构设计
- [PLAN.md](docs/PLAN.md) — 实施计划
- [DATABASE.md](docs/DATABASE.md) — 数据库说明

## 桌宠资源（M8）

Live2D 模型或精灵图放置说明见 M8 里程碑；当前版本不含桌宠窗口。
