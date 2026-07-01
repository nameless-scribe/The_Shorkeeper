# The Shorekeeper

自用桌面 AI Agent：Electron + React + 流式对话 + 工具调用 + 记忆 / RAG + MCP / 技能 + 多窗伴侣 UI。

核心能力：长期记忆与 Worldbook、混合 RAG 知识库、博查联网搜索、定时任务、Token 统计、好感度阶段、文档生成与生活类工具。

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

**在其他 Windows 电脑使用：** 拷贝 `release/` 下的安装包（`.exe`），双击安装即可，**无需** Node / pnpm。首次打开后会自动创建数据目录：

| 路径 | 说明 |
|------|------|
| `D:\SQLlite\` | 数据库根目录（默认，首次启动自动创建） |
| `D:\SQLlite\shorekeeper.db` | 聊天、设置、记忆等 |
| `D:\SQLlite\workspace\` | Agent 读写文件的工作区 |
| `D:\SQLlite\appearance\` | 自定义背景与头像 |

安装包内已包含 **sql.js 运行时**（WASM）与 **数据库迁移脚本**，无需单独安装 SQLite。若目标机没有 `D:` 盘，会自动回退到用户目录下的应用数据文件夹。

首次打开后还需：

1. **设置 → API 设置** — 填写模型 API Key 与接入地址
2. **设置 → 人设** — 编辑核心 System Prompt（每轮注入）
3. **设置 → 外观** — 切换主题或上传背景/头像
4. **设置 → 技能** — 打开需要的技能（`skills/` 已内置）
5. **设置 → 插件** — 按需开启联网搜索、文档生成等工具
6. **设置 → 文档** — 导入知识库（支持 MD / TXT / PDF / DOCX）

自定义数据目录（可选）：环境变量 `SHOREKEEPER_DB_DIR` / `SHOREKEEPER_WORKSPACE_DIR`，或在安装目录旁放置 `.env`。

## 路径说明

| 项 | 默认路径 |
|----|----------|
| 数据库 | `D:\SQLlite\shorekeeper.db`（`SHOREKEEPER_DB_PATH`） |
| 工作区 | `D:\SQLlite\workspace`（Agent 读写文件、生成文档；导入重名文件时自动追加 `_N` 后缀） |
| 数据库目录 | `D:\SQLlite`（`SHOREKEEPER_DB_DIR`） |

可在 `.env` 中覆盖，详见 `src/config/paths.ts`。

## 性能 / Token 优化

设置 → **性能** 页，或 `.env`：

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `RAG_ENABLED` | 是否启用 RAG | `true` |
| `RAG_INJECT_MODE` | 注入模式：`catalog` / `auto` / `tool` | `catalog` |
| `RAG_MIN_SCORE` | 检索最低相似度阈值 | `0.35` |
| `RAG_MAX_CHUNKS_PER_DOC` | 单文档最多注入片段数 | `2` |
| `AUTO_MEMORY_EXTRACT` | 记忆自动提取 | `true` |
| `MEMORY_EXTRACT_INTERVAL` | 每 N 轮提取（`every_n` 模式） | `3` |
| `MAX_HISTORY_MESSAGES` | 送入模型的最近消息条数 | `20` |
| `COMPRESS_THRESHOLD` | 长会话压缩阈值 | `30` |

`catalog` 模式下仅注入文档目录，模型按需调用 `search_knowledge` 工具，Token 开销更低。

## 联网搜索

设置 → **插件** 页填写博查 API Key，或 `.env`：

```env
WEB_SEARCH_API_KEY=sk-你的博查Key
```

详见 [博查开放平台](https://open.bochaai.com)。

## 项目结构

```
electron/              # 主进程、preload、IPC、窗口、定时调度
src/agent/             # 对话编排、上下文组装、会话锁
src/affection/         # 好感度阶段
src/config/            # 路径、性能、插件、联网搜索配置
src/tools/             # 内置工具（文件、网络、文档、记忆、生活、日程）
src/models/            # OpenAI / Anthropic 模型适配
src/memory/            # 长期记忆、Worldbook、会话摘要
src/rag/               # 知识库导入、混合检索、缓存
src/mcp/               # MCP Client
src/skills/            # 技能加载
src/db/                # sql.js 数据库与 migration
src/renderer/          # React 聊天 / Dock / 设置 / 状态 / 日程 UI
skills/                # 用户技能包
```

## 常用命令

```powershell
pnpm dev                  # 开发模式
pnpm test                 # 单元测试（Vitest）
pnpm db:init              # 初始化数据库与 migration
pnpm db:seed              # 写入守岸人人设与 Worldbook 种子
pnpm db:reset-keep-models # 重置数据库但保留模型配置
pnpm dist                 # Windows 打包
```

## 文档

- [DESIGN.md](docs/DESIGN.md) — 架构设计
- [DATABASE.md](docs/DATABASE.md) — 数据库与 migration
- [MODELS.md](docs/MODELS.md) — 模型与 API 配置
- [PLAN.md](docs/PLAN.md) — 里程碑实施计划
- [FIXES.md](docs/FIXES.md) — 已知问题与修复清单

## 桌宠资源（M8）

Live2D 模型或精灵图放置说明见 M8 里程碑；当前版本不含桌宠窗口。
