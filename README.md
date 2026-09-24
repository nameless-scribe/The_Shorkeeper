# The Shorekeeper

本地优先的 Windows 桌面 AI 助理：Electron + React + 流式 Agent、工具调用、记忆 / RAG、MCP / 技能、多窗口与语音交互。

核心能力包括：可追溯长期记忆与 Worldbook、混合 RAG 知识库、目标 / 承诺 / 待办闭环、主动收件箱与定时任务、办公文档读写、录音转写、图片理解、只读 MySQL 查询、博查搜索，以及百炼 CosyVoice TTS / 语音通话。

当前 P0、P1、P3–P8 主体工程均已落地（P2 外部连接器已取消）；真实录音、真实视觉模型、真实业务数据库与长期主动性体验仍按各阶段计划持续验收。2026-09-20 全仓稳定性复审已收口并发写入、缓存失效、启动恢复和停机取消等问题，见 [稳定化计划](docs/STABILITY-PLAN.md#22-2026-09-20-全仓稳定性复审)。

ERP 对话报工正在实施：草稿、审批、浏览器提交与回查已有模拟验证，真实账号和真实报工尚未验收，见 [实施计划](docs/ERP-WORK-REPORT-IMPLEMENTATION-PLAN.md)。

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
6. **设置 → 语音** — TTS、通话、录音转写与看图开关（可选）
7. **设置 → 泰提斯终端** — 导入知识库（MD / TXT / PDF / DOCX）
8. **设置 → 数据源** — 添加只读 MySQL、维护数据字典与指标（可选）

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
│   ├── datasources/          # MySQL 只读连接、字典、方案编译与查询
│   ├── documents/            # Markdown / DOCX / PDF / 图表处理
│   ├── models/               # OpenAI / Anthropic 适配、Embedding
│   ├── tools/                # 文件、文档、数据、视觉、语音等工具
│   ├── memory/               # 长期记忆、Worldbook、摘要
│   ├── proactivity/          # 本地主动事件、路由、投递与收件箱
│   ├── rag/                  # 导入、分块、混合检索
│   ├── runtime/              # 启动恢复、停机与电源生命周期
│   ├── mcp/                  # MCP Client
│   ├── skills/               # 技能加载与解析
│   ├── vision/               # 图片预处理、视觉客户端与缓存契约
│   ├── voice/                # TTS、STT、录音转写与通话会话
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
| 个性化 | 外观 / 语音 | 主题、壁纸、头像；TTS、通话、转写与看图 |
| 数据与任务 | 泰提斯终端 / 数据源 / 用户待办 / 定时任务 / 运行记录 | 知识库、只读查询、任务与 Agent 审计 |
| 系统 | API 设置 / 关于与更新 / 免责声明 | 模型、自动更新、协议 |

### 多窗口

同一 Vite 构建，通过 `?panel=` 加载：`chat`（默认）、`status`、`schedule`、`reminder`、`dock`、`call`（语音通话）。

## 常用命令

```powershell
pnpm dev                      # 开发（Vite + Electron）
pnpm test                     # Vitest
pnpm typecheck                # TypeScript
pnpm build                    # 生产构建（不打安装包）
pnpm test:p0                  # 任务闭环、工具证据与恢复
pnpm test:p1                  # 个人模型、记忆来源与新鲜度
pnpm test:p3                  # 本地主动服务
pnpm test:p4                  # 录音转写
pnpm test:p5                  # 办公文档能力
pnpm test:p6                  # 意图理解与追问
pnpm test:p7                  # 数据源查询
pnpm test:p8                  # 图片理解
pnpm test:ui:strict           # 开发版 React 下跑 UI smoke（查 StrictMode 类问题，见下）
pnpm test:electron            # Electron 运行时与窗口生命周期 smoke
pnpm test:settings:scan       # 起真实应用（临时数据目录）逐页点设置页按钮：遮挡、console 错误、异常
pnpm build:dev-react          # 仅产出开发版 React 的 dist/（供上一条使用）
pnpm dist                     # Windows 安装包 → release/
pnpm db:init                  # 初始化 DB + migration
pnpm db:migrate               # 同 db:init
pnpm db:seed                  # 人设 / Worldbook 种子
pnpm db:health                # 只读数据库健康检查
pnpm db:backup                # 数据库备份、校验与恢复入口
pnpm db:cleanup-sessions      # 删除空会话
pnpm db:reset-keep-models     # 重置 DB 但保留模型配置
```

**关于 `pnpm test:ui:strict`：** 其余 `test:*:ui` 都先 `pnpm build`，跑的是 production React，此时 `React.StrictMode` 是空操作——updater 双调用、effect 双挂载这类问题在那里**结构上测不出来**。该入口改用 `NODE_ENV=development` 构建（注意不是 `vite build --mode development`，后者只影响 `.env` 与 `import.meta.env.MODE`，React 仍是生产版），并要求渲染进程 console 零错误零告警。

它会把 `dist/` 与 `dist-electron/` 换成开发版产物，**打包或发布前请重新执行 `pnpm build`**。

## 文档

| 文档 | 说明 |
|------|------|
| [DEVELOPMENT-CONTRACT.md](docs/DEVELOPMENT-CONTRACT.md) | 全仓库开发契约与完成标准 |
| [使用说明.md](docs/使用说明.md) | 日常配置、技能、插件、工作区与待办 |
| [DESIGN.md](docs/DESIGN.md) | 当前架构与模块边界 |
| [DATABASE.md](docs/DATABASE.md) | 数据库、迁移、备份与原生 SQLite |
| [MODELS.md](docs/MODELS.md) | 对话、Embedding 与视觉模型配置 |
| [STABILITY-PLAN.md](docs/STABILITY-PLAN.md) | 稳定化阶段、复审方法与最新收口记录 |
| [P0-TASK-LOOP.md](docs/P0-TASK-LOOP.md) | P0 任务闭环、运行记录与完成证据 |
| [P1-PERSONAL-MODEL-PLAN.md](docs/P1-PERSONAL-MODEL-PLAN.md) | P1 可追溯个人模型实施计划与阶段出口 |
| [P3-LOCAL-PROACTIVITY-PLAN.md](docs/P3-LOCAL-PROACTIVITY-PLAN.md) | P3 本地主动服务实施契约、路由规则与验收记录 |
| [P4-AUDIO-TRANSCRIPTION-PLAN.md](docs/P4-AUDIO-TRANSCRIPTION-PLAN.md) | P4 录音转写与会议纪要实施计划与实施记录 |
| [P4-REAL-DEVICE-TEST-CHECKLIST.md](docs/P4-REAL-DEVICE-TEST-CHECKLIST.md) | P4 尚待完成的真实录音、语音输入和会议纪要验收清单 |
| [P5-DOCUMENT-CAPABILITY-PLAN.md](docs/P5-DOCUMENT-CAPABILITY-PLAN.md) | P5 办公文档读写实施计划与实施记录 |
| [P6-INTENT-AND-INQUIRY-PLAN.md](docs/P6-INTENT-AND-INQUIRY-PLAN.md) | P6 意图理解与追问（`ask_user`）实施计划与实施记录 |
| [P7-DATA-SOURCE-QUERY-PLAN.md](docs/P7-DATA-SOURCE-QUERY-PLAN.md) | P7 数据源查询实施计划与实施记录 |
| [P8-VISION-PLAN.md](docs/P8-VISION-PLAN.md) | P8 图片理解与 OCR 实施记录（P8.0–P8.3 代码完成，待真实验收） |
| [UI-THEME.md](docs/UI-THEME.md) | 主题与外观 |
| [RAG-OPTIMIZATION.md](docs/RAG-OPTIMIZATION.md) | 知识库检索优化 |
| [S2-ACCEPTANCE.md](docs/S2-ACCEPTANCE.md) | Agent 运行时验收集 |
| [S3-ACCEPTANCE.md](docs/S3-ACCEPTANCE.md) | 工具 / 技能 / 权限验收集 |
| [S5-ACCEPTANCE.md](docs/S5-ACCEPTANCE.md) | 私人助理验收集 |
| [RAG-RETRIEVAL-BASELINE.md](docs/RAG-RETRIEVAL-BASELINE.md) | RAG 检索质量基线 |
| [STABILITY-SOAK-BASELINE.md](docs/STABILITY-SOAK-BASELINE.md) | 长稳、强制中断恢复和运行时取消基线 |

## 进度

- **M1–M7**：已完成（脚手架、Agent、记忆、多窗、RAG、MCP/技能、工具与打包）
- **稳定化 S0–S5**：已收口（原生 SQLite、Agent 运行时、工具权限、RAG 生命周期、私人助理契约）
- **2026-09-20 全仓稳定性复审**：已确认缺口均加入回归，覆盖音频并发计费、视觉缓存与截断、文件并发写／取消回滚、查询产物碰撞／部分结果／核验状态、启动恢复、单实例保护、副作用结果未知阻断、一次性任务失败、主动服务停机和消息 IPC 失败
- **P0**：任务闭环、目标/承诺与每日管家工程已完成；真实使用观察持续进行
- **P1**：可追溯个人模型、冲突裁决、来源回链与知识新鲜度工程已完成
- **P2**：外部连接器方向已取消，不接入邮箱、外部日历、联系人或云盘
- **P3**：纯本地主动服务工程已完成（持久事件账本、本地采集器、主动收件箱、统一路由与频率预算、四个纵向场景、`pnpm test:p3` / `pnpm test:p3:ui`）；收口后又做了一轮复审并修复 8 个问题（过期事件周期性翻转、重开事件不再路由、弹窗预算被显式提醒占用等，见 [P3 计划 §9.6](docs/P3-LOCAL-PROACTIVITY-PLAN.md)）；连续两周真实使用观察尚未开始
- **P4**：录音转写、会议纪要与聊天框语音输入已完成（`pnpm test:p4`），真实使用观察进行中，见 [P4 计划](docs/P4-AUDIO-TRANSCRIPTION-PLAN.md)
- **P5**：P5.0–P5.3 已实现并通过自动化回归：PDF 按版面重建表格、抽图与逐页标记，扫描件保留清晰页面图并明确说明没有文字层；`gen_pdf` 支持中文与 Markdown 排版；`gen_docx` 可从 Markdown 生成结构化 Word；`update_docx_text` 可预览后原位修改文字并保留其余部件；`gen_chart` 生成 SVG + PNG 并在聊天中预览。P5.4 真实文件验收尚未完成，见 [P5 计划](docs/P5-DOCUMENT-CAPABILITY-PLAN.md)
- **P6**：意图理解与追问工程已完成（【证据不足先问】规则、`ask_user` 工具与提问弹窗、`user_questions` 落库与中断恢复、会议纪要 / 每日管家改用弹窗提问，`pnpm test:p6`）；真实使用观察进行中，见 [P6 计划](docs/P6-INTENT-AND-INQUIRY-PLAN.md)
- **P7**：P7.0–P7.5 主体代码已实现：MySQL 只读连接与设置页、数据字典、查询方案与 SQL 校验执行、结果自检、命名查询学习、Excel / 图表导出和定时重跑。P7.6 真实库 10 题评测与两周使用观察尚未完成，见 [P7 计划](docs/P7-DATA-SOURCE-QUERY-PLAN.md)
- **P8**：P8.0–P8.3 代码已实现：图片附件、百炼视觉客户端、`look_at_image`、同图同问缓存、设置开关与扫描 PDF 衔接。真实模型探针、照片 / 截图 / 图纸验收尚未完成；P8.4 OCR 专用模型评估为可选项，见 [P8 计划](docs/P8-VISION-PLAN.md)
- **语音**：TTS 朗读与通话（STT → Agent → CosyVoice）已落地
- **ERP 报工**：M0–M3 代码和模拟验证已完成首轮；M4/M5 的自由对话、自动登录、结果未知回查、部分批次重新确认接续及运行历史明细已有实现。打包态的审批账本、浏览器提交和回查业务模拟通过；打包应用内的用户确认界面与 Agent 全链路、真实 ERP 仍待验收

2026-09-24 状态复核：现有 227 个 Vitest 文件均被测试配置收集，未发现空测试或内容相同的测试文件；两份此前未列入索引的实机清单与长稳基线仍承载待验收事项和历史基线，已补入上方索引。类型检查通过；全量测试首次运行 1360/1361 项通过，Excel 导出用例并发超时，单独重跑该文件 7/7 项通过，第二次全量运行 227 个文件、1361 项全部通过。真实设备、真实 ERP 和打包应用内 Agent 全链路仍按对应计划验收。

## License

暂未指定开源许可证。仓库若公开，请自行补充 `LICENSE`，并确认立绘等资源具备再分发权利。
