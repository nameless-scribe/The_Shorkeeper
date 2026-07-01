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

**打包内容（白名单）：** 仅 `dist/`、`dist-electron/`、`skills/`、`package.json` 及 sql.js / migration 资源。**不会**打入开发机 `.env`、源码、`docs/`、本地 `shorekeeper.db` 或 `workspace/`。API Key 需在目标机 **设置 → API 设置** 填写，或在该机 `userData` / 安装目录旁自行放置 `.env`。

首次打开后还需：

1. **设置 → API 设置** — 填写模型 API Key 与接入地址
2. **设置 → 人设** — 编辑核心 System Prompt（每轮注入）
3. **设置 → 外观** — 切换主题或上传背景/头像
4. **设置 → 技能** — 打开需要的技能（`skills/` 已内置）
5. **设置 → 插件** — 按需开启联网搜索、文档生成等工具
6. **设置 → 泰提斯终端** — 导入知识库（支持 MD / TXT / PDF / DOCX）

自定义数据目录（可选）：环境变量 `SHOREKEEPER_DB_DIR` / `SHOREKEEPER_WORKSPACE_DIR`，或在安装目录旁放置 `.env`。

## 路径说明

| 项 | 默认路径 |
|----|----------|
| 数据库目录 | `D:\SQLlite`（`SHOREKEEPER_DB_DIR`） |
| 数据库文件 | `D:\SQLlite\shorekeeper.db`（`SHOREKEEPER_DB_PATH`） |
| 工作区 | `D:\SQLlite\workspace`（`SHOREKEEPER_WORKSPACE_DIR`；Agent 读写与生成文档） |
| 外观资源 | `D:\SQLlite\appearance\`（自定义背景 `bg-*`、头像；DB 仅存文件名） |

可在 `.env` 中覆盖，详见 `src/config/paths.ts`。主题与壁纸说明见 [UI-THEME.md](docs/UI-THEME.md)。

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
TheShorekeeper/
├── electron/                 # Electron 主进程
│   ├── main.ts               # 入口：DB 初始化、IPC 注册、托盘、调度器
│   ├── preload.ts            # 渲染进程 IPC 桥（contextBridge）
│   ├── tray.ts               # 系统托盘
│   ├── protocol/             # 自定义协议（如 sk-asset:// 本地外观资源）
│   ├── ipc/                  # IPC 处理器（agent / session / appearance / …）
│   ├── windows/              # 多窗：chat / status / schedule / dock / reminder
│   ├── dock/                 # Dock 显隐与偏好
│   ├── scheduler/            # node-cron 定时任务
│   └── state/                # Agent Presence 状态
├── src/
│   ├── agent/                # 编排器、工具循环、上下文组装、会话锁
│   ├── affection/            # 好感度阶段
│   ├── config/               # 路径、性能、插件、人设、外观、主题预设
│   │   └── themes/           # 9 套主题色板（shorekeeper / midnight / …）
│   ├── models/               # OpenAI / Anthropic 适配、Embedding 配置
│   ├── tools/                # 内置工具（file / web / doc / memory / life / schedule）
│   ├── memory/               # 长期记忆、Worldbook、摘要、自动提取
│   ├── rag/                  # 文档导入、分块、混合检索、缓存
│   ├── mcp/                  # MCP Client
│   ├── skills/               # 技能包加载（对应仓库根 skills/）
│   ├── db/                   # sql.js、schema、migrations、repositories
│   ├── session/              # 活跃会话
│   ├── scheduler/            # 提醒意图解析
│   ├── workspace/            # 工作区文件导入
│   ├── shared/               # 主进程/渲染进程共用类型与主题工具
│   └── renderer/             # React UI（Vite 单入口，?panel= 区分窗口）
│       ├── ChatPage.tsx      # 主聊天
│       ├── components/       # 消息列表、TitleBar、权限弹窗等
│       ├── settings/         # 设置抽屉（API / 人设 / 外观 / 文档 / …）
│       ├── theme/            # ThemeProvider、CSS 变量注入
│       ├── dock/             # Dock 快捷栏
│       ├── status/           # 状态面板
│       └── schedule/         # 日程与 Token 图表
├── skills/                   # 用户技能包（SKILL.md，会打入安装包）
├── scripts/                  # 维护脚本（见下方常用命令）
├── public/                   # 内置立绘、默认头像（构建进 dist/）
├── docs/                     # 设计 / 数据库 / 模型 / 主题 / 计划
├── .env.example              # 环境变量模板（勿提交 .env）
├── vite.config.ts
└── package.json              # 脚本与 electron-builder 打包配置
```

### 设置页一览

| 分组 | 页面 | 说明 |
|------|------|------|
| 能力 | 插件 / 技能 / MCP | 联网搜索、文档工具、外部 MCP |
| 人格与记忆 | 人设 / 用户信息 / 记忆 | System Prompt、画像、性能与 RAG 调优 |
| 个性化 | 外观 | 9 套主题预设、壁纸、头像、遮罩 |
| 数据与任务 | 泰提斯终端 / 定时任务 | 知识库导入、周期与一次性任务 |
| 系统 | API 设置 / 免责声明 | 模型配置与协议 |

### 多窗口

同一 Vite 构建，通过 URL 参数 `?panel=` 加载不同 React 根组件：`chat`（默认）、`status`、`schedule`、`reminder`、`dock`。

## 常用命令

```powershell
pnpm dev                      # 开发模式（Vite + Electron）
pnpm test                     # 单元测试（Vitest）
pnpm typecheck                # TypeScript 检查
pnpm build                    # 生产构建（不打包安装程序）
pnpm dist                     # Windows 安装包 → release/
pnpm db:init                  # 初始化数据库并应用 migration
pnpm db:migrate               # 同 db:init
pnpm db:seed                  # 写入守岸人人设与 Worldbook 种子
pnpm db:cleanup-sessions      # 删除无消息的空会话
pnpm db:reset-keep-models     # 重置数据库但保留 API 模型配置
```

## 文档

- [DESIGN.md](docs/DESIGN.md) — 架构设计
- [DATABASE.md](docs/DATABASE.md) — 数据库与 migration
- [MODELS.md](docs/MODELS.md) — 模型与 API 配置
- [UI-THEME.md](docs/UI-THEME.md) — 主题预设与外观
- [PLAN.md](docs/PLAN.md) — 里程碑实施计划
- [superpowers/README.md](docs/superpowers/README.md) — 进行中的专项计划

## 桌宠资源（M8）

Live2D 模型或精灵图放置说明见 M8 里程碑；当前版本不含桌宠窗口。
