# The Shorekeeper

桌面 AI Agent：Electron + React + 流式对话 + 工具调用 + 记忆 / RAG + MCP / 技能 + 多窗伴侣 UI + 语音朗读 / 通话。

核心能力：长期记忆与 Worldbook、混合 RAG 知识库、博查联网搜索、定时任务、Token 统计、好感度阶段、文档生成与生活类工具、百炼 CosyVoice TTS 与语音通话。

> 当前为个人项目。推送 GitHub 前请确认未提交 `.env`、数据库与真实 API Key（见下方「仓库安全」）。

## 环境要求

- Node.js **20+**
- pnpm
- Windows（开发与打包主路径）；生产数据库为 **better-sqlite3**（活动库 `shorekeeper.native.db`）

## 快速开始

```powershell
git clone https://github.com/<你的用户名>/<仓库名>.git
cd TheShorekeeper   # 或你的仓库目录名
copy .env.example .env
pnpm install
pnpm db:init
pnpm db:seed        # 可选：写入守岸人人设与 Worldbook 种子
pnpm dev
```

编辑 `.env`，填入 **阿里云百炼** 等配置（详见 [docs/MODELS.md](docs/MODELS.md)）：

```env
OPENAI_API_KEY=sk-你的百炼APIKey
OPENAI_BASE_URL=https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
DEFAULT_MODEL=qwen3.6-plus
INCLUDE_STREAM_USAGE=false
```

也可启动后在 **设置 → API 设置** 填写（应用内配置优先于 `.env`）。

若 Electron 下载失败，可设置镜像后重装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
pnpm rebuild electron
pnpm dev
```

## 仓库安全（推送前必读）

| 项 | 说明 |
|----|------|
| `.env` | **勿提交**；已在 `.gitignore`。只提交 `.env.example`（占位符） |
| `*.db` / workspace | 本地会话与知识库数据，已忽略 |
| `node_modules/`、`dist/`、`release/` | 已忽略 |
| `public/vad/` | 由 `scripts/copy-vad-assets.mjs` 从依赖同步，勿手改入库 |
| API Key / 接入点 | 文档与示例一律使用占位符；个人域名与真实 Key 只放本地 `.env` 或应用内设置 |

推送前自检：

```powershell
git ls-files | Select-String -Pattern '\.env$|\.db$|credentials|secret'
```

应只看到 `.env.example` 这类安全文件。

## 打包（Windows）

```powershell
pnpm dist
```

安装包输出到 `release/`。首次打包会下载 NSIS 相关工具，耗时较长。

面向用户发布的 Windows 安装包必须通过 `WIN_CSC_LINK`（或 `CSC_LINK`）与对应密码配置代码签名。未配置签名时仍可生成本地测试安装包，但构建会自动禁用在线更新，避免从通用更新源安装未经签名验证的程序。

**构建顺序：** `pnpm dist` 会先执行 `scripts/copy-vad-assets.mjs`（同步 VAD / ONNX 到 `public/vad/`），再 `vite build` 与 `electron-builder`。**请勿单独运行 `vite build`**，否则安装包内语音通话 VAD 可能无法初始化。开发模式 `pnpm dev` 同样会在启动前同步 VAD。

**在其他 Windows 电脑使用：** 拷贝 `release/` 下的安装包（`.exe`）安装即可，无需 Node / pnpm。安装包含 better-sqlite3、sql.js 回滚能力与数据库迁移脚本。若目标机没有 `D:` 盘，会自动回退到用户目录下的应用数据文件夹。

**打包白名单：** 仅 `dist/`、`dist-electron/`、`skills/`、`package.json` 及运行时依赖。**不会**打入开发机 `.env`、源码、`docs/`、本地数据库或 `workspace/`。API Key 需在目标机 **设置 → API 设置** 填写。

首次打开建议：

1. **设置 → API 设置** — 模型 API Key 与接入地址
2. **设置 → 人设** — 核心 System Prompt
3. **设置 → 外观** — 主题或背景 / 头像
4. **设置 → 技能** — 按需开启（见 [使用说明.md](docs/使用说明.md#技能系统)）
5. **设置 → 插件** — 联网搜索、多格式编写等
6. **设置 → 语音** — TTS / 通话（可选）
7. **设置 → 泰提斯终端** — 导入知识库（MD / TXT / PDF / DOCX）

自定义数据目录：环境变量 `SHOREKEEPER_DB_DIR` / `SHOREKEEPER_WORKSPACE_DIR`，或在安装目录旁放置 `.env`。

## 路径说明

| 项 | 默认路径 |
|----|----------|
| 数据库目录 | `D:\SQLlite`（`SHOREKEEPER_DB_DIR`） |
| 活动主库 | `D:\SQLlite\shorekeeper.native.db` |
| sql.js 回滚源 | `D:\SQLlite\shorekeeper.db`（`SHOREKEEPER_DB_PATH` 指向此基路径） |
| 工作区 | `D:\SQLlite\workspace`（`SHOREKEEPER_WORKSPACE_DIR`） |
| 外观资源 | `D:\SQLlite\appearance\`（自定义背景 / 头像；DB 仅存文件名） |

可在 `.env` 中覆盖，见 `src/config/paths.ts`。主题说明见 [UI-THEME.md](docs/UI-THEME.md)。

## 性能 / Token 优化

设置 → **性能**，或 `.env`：

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `RAG_ENABLED` | 是否启用 RAG | `true` |
| `RAG_INJECT_MODE` | `catalog` / `auto` / `tool` | `catalog` |
| `RAG_MIN_SCORE` | 检索最低相似度阈值 | `0.35` |
| `RAG_MAX_CHUNKS_PER_DOC` | 单文档最多注入片段数 | `2` |
| `AUTO_MEMORY_EXTRACT` | 记忆自动提取 | `true` |
| `MEMORY_EXTRACT_INTERVAL` | 每 N 轮提取 | `3` |
| `MAX_HISTORY_MESSAGES` | 送入模型的最近消息条数 | `20` |
| `COMPRESS_THRESHOLD` | 长会话压缩阈值 | `30` |

`catalog` 模式下仅注入文档目录，模型按需调用 `search_knowledge`，Token 更省。更多检索优化见 [RAG-OPTIMIZATION.md](docs/RAG-OPTIMIZATION.md)。

## 联网搜索

设置 → **插件** 填写博查 API Key，或 `.env`：

```env
WEB_SEARCH_API_KEY=sk-你的博查Key
```

详见 [博查开放平台](https://open.bochaai.com)。

## 项目结构

```
TheShorekeeper/
├── electron/                 # 主进程：IPC、托盘、多窗、调度、更新
├── src/
│   ├── agent/                # 编排、工具循环、上下文
│   ├── affection/            # 好感度
│   ├── config/               # 路径、性能、插件、人设、外观、主题
│   ├── models/               # OpenAI / Anthropic 适配、Embedding
│   ├── tools/                # file / web / doc / memory / life / schedule
│   ├── memory/               # 长期记忆、Worldbook、摘要
│   ├── rag/                  # 导入、分块、混合检索
│   ├── mcp/                  # MCP Client
│   ├── skills/               # 技能加载与解析
│   ├── voice/                # TTS / 通话会话
│   ├── db/                   # better-sqlite3 / sql.js adapter、schema、migrations
│   └── renderer/             # React UI（?panel= 区分窗口）
├── skills/                   # 内置技能包（打入安装包）
├── scripts/                  # DB / VAD / 打包辅助脚本
├── public/                   # 内置立绘等（VAD 构建时同步）
├── docs/                     # 设计与使用文档
├── .env.example
└── package.json
```

### 设置页一览

| 分组 | 页面 | 说明 |
|------|------|------|
| 能力 | 插件 / 技能 / MCP | 联网、文档工具、技能、外部 MCP |
| 人格与记忆 | 人设 / 用户信息 / 记忆 / Worldbook | System Prompt、画像、RAG 调优 |
| 个性化 | 外观 / 语音 | 主题、壁纸、头像；TTS 与通话 |
| 数据与任务 | 泰提斯终端 / 定时任务 / 运行记录 | 知识库、周期与一次性任务；Agent 运行、审批与产物历史 |
| 系统 | API 设置 / 关于 / 免责声明 | 模型、自动更新、协议 |

### 多窗口

同一 Vite 构建，通过 `?panel=` 加载：`chat`（默认）、`status`、`schedule`、`reminder`、`dock`、`call`（语音通话）。

## 常用命令

```powershell
pnpm dev                      # 开发（Vite + Electron）
pnpm test                     # Vitest
pnpm typecheck                # TypeScript
pnpm build                    # 生产构建（不打安装包）
pnpm dist                     # Windows 安装包 → release/
pnpm db:init                  # 初始化 DB + migration
pnpm db:migrate               # 同 db:init
pnpm db:seed                  # 人设 / Worldbook 种子
pnpm db:cleanup-sessions      # 删除空会话
pnpm db:reset-keep-models     # 重置 DB 但保留模型配置
```

## 文档

| 文档 | 说明 |
|------|------|
| [DEVELOPMENT-CONTRACT.md](docs/DEVELOPMENT-CONTRACT.md) | 全仓库开发契约与完成标准 |
| [P1-PERSONAL-MODEL-PLAN.md](docs/P1-PERSONAL-MODEL-PLAN.md) | P1 可追溯个人模型实施计划与阶段出口 |
| [P3-LOCAL-PROACTIVITY-PLAN.md](docs/P3-LOCAL-PROACTIVITY-PLAN.md) | P3 本地主动服务实施契约、路由规则与验收记录 |
| [P3-LOCAL-PROACTIVITY-PLAN.md](docs/P3-LOCAL-PROACTIVITY-PLAN.md) | P3 本地事件、主动收件箱、通知路由与降噪实施契约 |
| [使用说明.md](docs/使用说明.md) | 技能、插件、工作区、待办 |
| [DESIGN.md](docs/DESIGN.md) | 架构设计 |
| [DATABASE.md](docs/DATABASE.md) | 数据库与 migration |
| [MODELS.md](docs/MODELS.md) | 模型与 API |
| [UI-THEME.md](docs/UI-THEME.md) | 主题与外观 |
| [RAG-OPTIMIZATION.md](docs/RAG-OPTIMIZATION.md) | 知识库检索优化 |
| [STABILITY-PLAN.md](docs/STABILITY-PLAN.md) | 稳定化计划（S0–S5 已收口） |
| [S2-ACCEPTANCE.md](docs/S2-ACCEPTANCE.md) | Agent 运行时验收集 |
| [S3-ACCEPTANCE.md](docs/S3-ACCEPTANCE.md) | 工具 / 技能 / 权限验收集 |
| [S5-ACCEPTANCE.md](docs/S5-ACCEPTANCE.md) | 私人助理验收集 |
| [RAG-RETRIEVAL-BASELINE.md](docs/RAG-RETRIEVAL-BASELINE.md) | RAG 检索质量基线 |

## 进度

- **M1–M7**：已完成（脚手架、Agent、记忆、多窗、RAG、MCP/技能、工具与打包）
- **稳定化 S0–S5**：已收口（原生 SQLite、Agent 运行时、工具权限、RAG 生命周期、私人助理契约）
- **P0**：任务闭环、目标/承诺与每日管家工程已完成；真实使用观察持续进行
- **P1**：可追溯个人模型、冲突裁决、来源回链与知识新鲜度工程已完成
- **P2**：外部连接器方向已取消，不接入邮箱、外部日历、联系人或云盘
- **P3**：纯本地主动服务工程已完成（持久事件账本、本地采集器、主动收件箱、统一路由与频率预算、四个纵向场景、`pnpm test:p3` / `pnpm test:p3:ui`）；连续两周真实使用观察尚未开始
- **语音**：TTS 朗读与通话（STT → Agent → CosyVoice）已落地

## License

暂未指定开源许可证。仓库若公开，请自行补充 `LICENSE`，并确认立绘等资源具备再分发权利。
