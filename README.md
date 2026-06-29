# The Shorekeeper

自用桌面 AI Agent（M1 脚手架）：Electron + React + API 流式聊天 + SQLite。

## 环境要求

- Node.js **20+**
- pnpm
- 数据库通过 **sql.js** 读写 `D:\SQLlite\shorekeeper.db`（兼容 Electron 内置 Node）

## 快速开始

1. 复制环境变量：

```powershell
copy .env.example .env
```

2. 编辑 `.env`，填入 **阿里云百炼 Qwen3.6-Plus**（详见 [docs/MODELS.md](docs/MODELS.md)）：

```env
OPENAI_API_KEY=sk-你的百炼APIKey
OPENAI_BASE_URL=https://你的接入点/compatible-mode/v1
DEFAULT_MODEL=Qwen3.6-Plus
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

## 数据库路径

默认：`D:\SQLlite\shorekeeper.db`（见 `src/config/paths.ts`）

## 项目结构

```
electron/          # 主进程、preload、IPC
src/agent/         # 对话编排
src/models/        # API 模型适配
src/db/            # SQLite（node:sqlite）
src/renderer/      # React 聊天 UI
```

## 文档

- [DESIGN.md](docs/DESIGN.md) — 架构设计
- [PLAN.md](docs/PLAN.md) — 实施计划
- [DATABASE.md](docs/DATABASE.md) — 数据库说明
