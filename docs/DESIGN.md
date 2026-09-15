# The Shorekeeper 设计文档

> 版本：0.3.8
> 更新日期：2026-09-13
> 状态：**M1–M7、稳定化 S0–S5、P0、P1 与 P3 工程均已收口**；P2 外部连接器已取消。P3 本地主动服务（事件账本、采集器、收件箱、统一路由）自动化验收已通过，连续两周真实使用观察尚未开始。语音 TTS 与通话已落地。推送仓库时勿提交 `.env` / 真实 Key（见根目录 README「仓库安全」）。

---

## 1. 项目概述

### 1.1 项目名称

**The Shorekeeper**（岸守护者）

### 1.2 项目定位

The Shorekeeper 是一款 **自用桌面 AI Agent 应用**，将完整的 Agent 能力（工具调用、记忆、RAG、MCP、技能）与 **伴侣式多窗 UI** 结合。用户通过聊天窗、状态面板、Dock 快捷栏等浮动界面与 Agent 交互，获得人格化、可扩展的本地智能助手体验。

### 1.3 核心目标

| 目标 | 说明 |
|------|------|
| 本地优先 | 数据、配置、会话默认存储在本机，无需依赖云端数据库 |
| Agent 能力完整 | 支持多轮工具调用、记忆、文档检索、MCP 扩展 |
| 伴侣式体验 | 心情/状态、TTS、人格化对话、多窗快捷入口 |
| 可扩展 | 技能系统、MCP Server、内置工具可插拔 |
| 自用友好 | 部署简单、单文件数据库备份、无服务端运维 |

### 1.4 非目标（当前阶段）

- 多用户 / 账号系统
- 云端同步（可后续扩展）
- 移动端版本

---

## 2. 用户场景

### 2.1 典型使用流程

```
启动应用
  → 默认显示聊天窗；状态/日程窗预加载但隐藏
  → 全部主面板隐藏时显示 Dock 快捷栏（头像 + 状态 / 日程 / Token）
  → 点击 Dock 区块 / 托盘菜单打开对应窗口
  → 选择模型、风格、推理模式
  → 发送消息 → Agent 循环（可能调用工具）→ 流式回复
  → TTS 朗读
  → 会话与记忆自动持久化
```

### 2.2 主要功能场景

| 场景 | 描述 |
|------|------|
| 日常对话 | 流式聊天、人设风格、贴纸/表情 |
| 工具协助 | 读文件、搜索、天气、翻译、文档生成 |
| 记忆召回 | 长期记忆、用户画像、历史会话检索 |
| 知识检索 | 导入文档 RAG、Worldbook 世界观触发 |
| 状态陪伴 | 在线状态、心情、喂食、好感度阶段 |
| 资源监控 | Token 用量统计、周趋势、定时任务 |
| 联网能力 | 博查 Web Search、URL 抓取、天气、翻译 |

---

## 3. 系统架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      表现层 (Renderer)                       │
│  聊天窗 │ 状态面板 │ 日程/Token │ Dock 快捷栏 │ 设置/侧边栏 │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC + AG-UI Event Stream
┌──────────────────────────▼──────────────────────────────────┐
│                   桥接层 (Preload)                           │
│              contextBridge · 类型安全 API                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                 Agent 运行时 (Main Process)                  │
│  编排器 │ Tool Loop │ 模型适配 │ 工具 │ MCP │ 技能 │ 权限    │
│  记忆 │ RAG │ TTS │ 定时任务 │ 窗口管理 │ 系统托盘           │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      数据层 (Data)                           │
│         SQLite (shorekeeper.db) · 本地文件 · 配置             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 架构原则

1. **主进程持有智能**：所有 LLM 调用、工具执行、数据库访问仅在 Main Process 进行。
2. **渲染进程只展示**：UI 通过 IPC 订阅 AG-UI 事件，不直接访问 API Key 或数据库。
3. **单一数据源**：会话状态由主进程管理，多窗口通过事件广播同步。
4. **插件化扩展**：内置工具、MCP 工具、技能通过统一 `ToolRegistry` 注册。
5. **分阶段交付**：按里程碑递增能力，避免过度设计。
6. **IPC 零信任边界**：TypeScript 参数类型不代表运行时可信；所有主进程 IPC 先验证页面来源，再验证结构、枚举、数值、长度和数量上限。

### 3.3 进程与窗口模型

| 窗口 | 类型 | 职责 |
|------|------|------|
| `chat` | 无边框、圆角 | 消息列表、输入、流式输出、工具卡片；**启动时默认显示** |
| `status` | 浮动面板 | 头像、在线、心情、活动、快捷操作 |
| `schedule` | 浮动面板 | 日程、Token 统计、定时任务入口 |
| `dock` | 透明、无边框、可置顶 | 主面板全隐藏时的伴侣快捷栏：头像 + 状态/日程/Token 预览 |
| `reminder` | 透明、置顶 | 定时任务 reminder 弹窗 |
| `settings` | 聊天窗内 Drawer | 模型、API、MCP、技能、人设、外观、文档、任务 |

**窗口生命周期（M4）：**

- `WindowManager` 统一管理 `chat` / `status` / `schedule` 三窗的 create/show/hide 与 bounds 持久化。
- 逻辑可见状态 `panelShown` 为单一事实来源，驱动 Dock 显隐（不依赖 `win.isVisible()`，避免 Windows `skipTaskbar` 竞态）。
- 最小化 / 关闭 → 收进**系统托盘**（`skipTaskbar`，不占任务栏）；三窗互不影响。
- 托盘菜单：分别显示聊天 / 状态 / 日程、退出。
- 页面未完成加载时的事件只排队一次；页面或窗口销毁后取消待发送事件，所有广播使用销毁安全发送。
- 启动页、自动更新和可见性恢复的计时器/监听在退出时解除，退出期间不再重建窗口。
- 退出由 `shutdown-coordinator` 隔离清理 Agent run、后台工作、RAG、语音、权限、更新和启动计时器；单个子系统失败不得阻断其余清理及 SQLite 关闭。
- Windows 休眠时暂停调度器，唤醒或解锁的重复系统事件在 500ms 内合并，然后重建定时任务并校正窗口可见性。

**Dock 快捷栏（M4）：**

- 当所有主面板 `panelShown=false` 时自动显示；任一主面板打开时隐藏。
- 布局：左侧头像（点击 → 聊天），右侧**竖向**三行——状态、日程、今日 Token（点击 → 对应面板）。
- 支持拖动 reposition；可选窗口置顶、固定位置（`app_settings` 持久化）。

系统托盘提供：显示/隐藏各窗口、退出、快捷打开聊天。

---

## 4. 技术选型

### 4.1 技术栈总表

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron | 多窗口、托盘、本地 Node 能力 |
| 语言 | TypeScript | 全栈统一类型 |
| 构建 | Vite | 渲染进程构建与 HMR |
| UI 框架 | React 18 | 组件化面板 |
| 样式 | Tailwind CSS | 主题、毛玻璃、渐变 |
| 图表 | Recharts | Token 周趋势 |
| 数据库 | SQLite（生产 **better-sqlite3**；sql.js 仅作回滚与双 adapter 测试） | 嵌入式主库 |
| Schema | `src/db/schema.ts` + 手写 SQL migration | 类型与迁移 |
| 全文检索 | SQLite FTS5 | Worldbook 关键词 |
| 向量检索 | Embedding BLOB + TS 余弦 + FTS5 RRF 混合 | RAG、语义记忆 |
| 定时任务 | node-cron | 本地调度 |
| TTS | 百炼 CosyVoice | 文本转语音 / 通话 |
| MCP | @modelcontextprotocol/sdk | 外部工具扩展 |

### 4.2 数据库选型结论

**主库：SQLite（生产 better-sqlite3 + 手写 migration）**

理由：单文件备份、WAL、FTS5/trigram 与 Embedding BLOB 均可用；sql.js 保留为回滚源和双 adapter 测试。详见 [DATABASE.md](./DATABASE.md)。

分阶段扩展：

- M1：基础表（sessions, messages）
- M3：记忆表 + Worldbook + `memory_key` upsert + FTS5（可选）
- M5：document_chunks `embedding BLOB`、语义记忆向量去重
- M5-RAG 优化（2026-07）：FTS5 混合检索、chunk 内存缓存、Markdown 感知分块、文档 hash 去重、可调注入模式
- 未来若文档量极大（>1 万 chunk）：评估 sqlite-vec 或 LanceDB 双库

### 4.3 模型适配

支持两类协议，经统一 `ChatModel` 接口屏蔽差异：

| 适配器 | 协议 | 示例 |
|--------|------|------|
| `OpenAICompatibleModel` | OpenAI Chat Completions + tools | OpenAI, 方舟, DeepSeek, Ollama |
| `AnthropicLikeModel` | Messages API + tool_use | Claude |

统一输出为 `ModelEvent` 流：`text_delta`, `reasoning_delta`, `tool_call`, `usage`, `done`, `error`。

每次 Agent run 在开始时由 `loadModelRuntimeConfig` 固定 profile、协议、服务地址、模型名与密钥快照，后续工具轮次不再重新读取活动 profile。初始 HTTP 请求只会在尚未消费响应流时对网络失败、429、408 和可恢复 5xx 做一次短重试；上游错误正文不会直接进入用户界面或运行诊断。

---

## 5. 核心模块设计

### 5.1 Agent 编排器 (Orchestrator)

**职责**：接收用户输入，组装上下文，驱动 Agent 循环，发射 AG-UI 事件，处理副作用（持久化、TTS）。

**输入**：

```typescript
interface AgentRunRequest {
  sessionId: string;
  userMessage: string;
  options?: {
    modelId?: string;
    style?: 'gentle' | 'default' | 'formal';
    reasoning?: 'auto' | 'on' | 'off';
    activeSkillIds?: string[];
  };
}
```

**输出**：`AsyncIterable<AgUiEvent>`

**上下文组装顺序**（`context-builder.ts`）：

1. **稳定前缀**（`getStableSystemPrefix`）：人设 System Prompt + 【上下文优先级】+ 【证据不足先问】（P6.0，措辞固定、测试逐句断言；缓存于 `stable-context.ts`，利于 prompt cache）
2. **本轮技能**（`formatSkillsForPrompt`）：仅注入 `resolveActiveSkills` 激活的技能，以 `<skill id="..." name="...">` 包裹
3. **工具说明**（`formatToolGuideForPrompt`）：根据当前 registry 实际可用工具生成；若已激活 `task-execution` / `workspace-doc-edit` 等技能，则省略与之重复的全局规则
4. **动态块**（随 query 变化）：
   - 好感度阶段指引（`affection`）
   - 用户画像摘要（`user_profile`）
   - 会话摘要（`session_summaries`，长会话压缩后）
   - 长期记忆检索（向量 + 重要性）
   - Worldbook 命中条目（FTS5 关键词）
   - RAG 文档目录 / 检索片段（按 `ragInjectMode` 决定，见 §5.5）

### 5.2 Function-Calling 循环

```
┌──────────┐
│ 用户消息  │
└────┬─────┘
     ▼
┌──────────────────┐
│ 组装 messages     │
└────┬─────────────┘
     ▼
┌──────────────────┐     无 tool_calls
│ 流式调用模型  ◄────┼──────────────► 输出最终文本
└────┬─────────────┘
     │ 有 tool_calls
     ▼
┌──────────────────┐
│ 权限检查          │
└────┬─────────────┘
     ▼
┌──────────────────┐
│ 执行工具（并行/串行）│
└────┬─────────────┘
     ▼
┌──────────────────┐
│ tool_result 回注  │
└────┬─────────────┘
     │
     └──► 再次调用模型（循环，设最大轮次 maxToolRounds=10）
```

**约束**：

- 默认 `maxToolRounds = 10`，防止死循环
- 单轮默认最多接受 20 个工具调用；相同 `tool_call_id` 的重复调用复用首次结果，不重复执行副作用
- 多轮工具正文使用默认 8,000 Token 滚动预算；较早结果保留调用配对，但正文会按预算省略或截断
- 同一会话通过 `session-run-lock` 串行运行，新消息需等待或中断当前 run
- 用户可在设置中中断进行中的 run（`AbortController`）
- 下一条消息前通过 `session-background` 等待同会话后台任务（记忆提取、摘要压缩）完成，避免竞态
- 用户消息可触发 **定时提醒意图**（`scheduler/reminder-intent`）或 **对话归档知识库**（`rag/conversation-knowledge`），在 Agent loop 之前短路处理
- 调度器按任务 ID 防重入；超过 Node 单次计时上限的远期任务分段等待；一次性 Agent 任务遇到会话忙碌时 60 秒后重试；AI 提醒文案失败或超时会回退静态正文
- 每次 run 通过 `run-record` 写入 `task_runs` / `task_run_steps` / `artifacts`（来源 `chat` / `scheduled` / `voice`）；应用启动由 `run-recovery` 把上次遗留的非终态 run 收口为 `interrupted`，并在下一轮同会话对话中注入一次性的中断说明，让助理先说明再决定是否继续

### 5.3 工具系统 (Tool Registry)

**接口**：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'file' | 'web' | 'doc' | 'memory' | 'life' | 'mcp' | 'skill';
  requiresPermission: PermissionFlag[];
  sideEffects?: ToolSideEffectContract;   // 内置工具必须显式声明；MCP 工具按权限推导保守值
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolSideEffectContract {
  risk: 'read' | 'low' | 'medium' | 'high'; // high 无论策略如何都必须用户确认
  idempotent: boolean;                       // false 时同一 run 内相同参数的重复调用会被合并
  supportsPreview: boolean;                  // 是否支持 ctx.preview 干跑
  reversible: 'none' | 'manual' | 'automatic';
  evidence: 'none' | 'output' | 'artifact';  // artifact 表示成功必须附带可读回校验的文件
}

interface ToolContext {
  sessionId: string;
  workspaceRoot: string;  // 沙箱根目录
  signal: AbortSignal;
  runId?: string;
  preview?: boolean;
  previewRevision?: string; // 确认时返回的目标版本，实际执行前用于防止过期写入
}
```

**副作用契约的运行时约束**（`src/tools/contract.ts`、`src/tools/evidence.ts`、`src/agent/loop.ts`）：

- `risk: 'high'` 的工具即使权限策略允许也会进入确认；每次确认都写入 `approvals` 表，含风险等级和结论来源。
- 支持预览且需要确认的工具先以 `ctx.preview = true` 干跑，再把结构化 diff 放入权限弹窗；确认后携带 `previewRevision` 执行，目标已变化则拒绝写入。当前覆盖 `write_file`、`replace_text`、`update_xlsx_cells`。
- 预览成功不得携带文件产物；违反该约束或声明支持预览但未返回结构化预览时，主循环拒绝继续。
- 非幂等的副作用工具在同一 run 内以完全相同参数再次调用时，不会重复执行，而是复用首次结果并在输出前标注“重复调用已合并”。
- `evidence: 'artifact'` 的工具成功后会由主循环读回校验产物（存在、大小、SHA-256）；校验失败时结果降级为失败，避免“声称完成”。
- 预设契约：`READ_ONLY_CONTRACT`、`WORKSPACE_WRITE_CONTRACT`、`LOCAL_APPEND_CONTRACT`、`LOCAL_UPSERT_CONTRACT`；`tool-contract.test.ts` 强制所有内置工具显式声明并与权限标志一致。
- **向用户提问（P6.1）**：`ask_user` 是核心工具（不受技能白名单限制），只读、无副作用；`src/agent/user-questions.ts` 是注入点，主进程 `electron/ipc/ask.ts` 镜像权限确认（pending 表、10 分钟超时、abort 与窗口关闭监听、`ask:request` / `ask:respond`），未注入时返回 abort。渲染层 `usePromptRequests` 把权限请求与提问放进同一条队列（`prompt-queue.ts`），一次只弹一个；`QuestionDialog` 选项即答、自由文本 Enter 提交、Esc 是"稍后再答"。等待期间运行阶段为 `waiting_user`，正在进行的计划项标为 `waiting_user`（面板显示 `?`）。语音通话运行通过 `excludeTools: ['ask_user']` 不注册它。回答未收到时工具返回失败，模型按【证据不足先问】停下。

**内置工具（当前）**：

| 类别 | 工具 |
|------|------|
| 文件 | `read_file`, `write_file`, `replace_text`, `list_dir` |
| 网络 | `web_search`（博查）, `fetch_url`, `get_weather`, `translate` |
| 文档 | `convert_to_markdown`（Word / PDF 文字层 / 文本）, `gen_markdown`, `gen_docx`, `gen_xlsx`, `gen_pdf`（Markdown 正文，经 `printToPDF` 输出）, `read_xlsx`, `update_xlsx_cells`（工作区 Excel） |
| 记忆 / 知识 | `recall_memory`, `save_memory`, `search_worldbook`, `search_knowledge` |
| 生活 | `bookkeeping`, `travel_plan` |
| 日程 | `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task` |
| 计划 / 待办 | `update_agent_plan`, `import_tasks_from_xlsx`, `create_user_task`, `list_user_tasks`, `update_user_task` |
| 追问 | `ask_user`（P6.1：证据不足时向用户提一个问题并等待，选项或自由文本；核心工具） |
| 目标 / 承诺 | `manage_goals`（create/list/update/close）, `manage_commitments`（record/confirm/list/update/complete/cancel）；创建提醒自动记录助理承诺，待办状态变化自动同步承诺 |
| 每日管家 | `build_daily_brief`, `build_evening_review`（每天各一次，`force` 重做）；由设置页创建的两条系统 `agent_prompt` 任务触发，安静时段推迟，成功后弹标题提醒；流程约束见 `skills/daily-steward/SKILL.md` |

**文档库加载**（CJS 包在 ESM 动态 `import()` 下的互操作）：`src/tools/doc/` 提供统一加载器，避免 `is not a constructor` 类错误。

| 加载器 | 依赖 | 使用处 |
|--------|------|--------|
| `exceljs-loader.ts` → `loadExcelJS()` | exceljs | `parse-xlsx`, `gen_xlsx`, `update_xlsx_cells`, `xlsx-task-sync` |
| `doc-loaders.ts` → `loadMammoth()` | mammoth | `convert-markdown`, RAG `format-converters` |
| `doc-loaders.ts` → `loadWordExtractor()` | word-extractor | 同上 |

`docx`、`pdf-lib`、`pdf-parse` 为原生 ESM 命名导出，无需 loader。

**PDF 读写（P5.0）**：读是逐页**版面分析**而不是抽纯文本——PDF 里没有"表格"，只有带坐标的字、矩形和图。`src/documents/pdf-layout.ts` 直接用 pdfjs-dist 取绘图指令：填充与描边的矩形、线段交给 pdf-parse 公开的 `LineStore` 重建网格（pdf-parse 自带的 `getTable` 只认描边，遇到用底色画格子的表一个都找不到）；文字按水平中点落进格子，压在格线上的整段文字在最近的空白处切开；图片按绘制位置归格子或自由区域，被导出器切成条块分别绘制的照片按"对齐且相接"在同一格子内拼回一张（`groupImagePaints`）。`pdf-markdown.ts` 按纵向位置输出段落、GFM 表格（格内换行 `<br>`，横跨整表的标题行作加粗段落）与 `![]()`。`pdf-images.ts` 从 `page.objs` 解像素、用 `@napi-rs/canvas` 落成 JPEG（最长边 3600，约 A4 300 dpi，扫描图纸的标注可读；1 位黑白保留 PNG），必须在 `page.cleanup()` 之前完成。入口 `src/rag/format-converters.ts` 的 `extractPdfDocument`：`convert_to_markdown` 走带页码注释、图片抽到 `<同名>.assets/` 的模式；知识库导入不插注释、不抽图。不支持内联图（`paintInlineImageXObject`）。去空白后不足 20 字视为无文字层：抽到了图片就照常输出并在正文开头写明未识别文字，一张图也没有才抛错，绝不返回空文档。写走 Electron `printToPDF`：`src/documents/markdown-ast.ts` 解析 Markdown 子集 → `markdown-to-html.ts` 渲染全转义 HTML → `src/documents/pdf-renderer.ts` 的注入点 → `electron/print/markdown-to-pdf.ts` 在隐藏窗口（沙箱、`javascript: false`、独立内存 session 且拦截一切非 `data:` 请求）打印，30 秒超时、用完即销毁，退出时 `shutdownPdfPrintRuntime()` 兜底。`src/` 不引用 Electron，注入方式与 `setPermissionConfirmer` 相同；未注入时 `gen_pdf` fail closed。

工具可见性受 **设置 → 插件**（`PluginSettings`）与 **本轮激活技能的白名单** 双重过滤；`getAgentRegistry(activeSkills)` 先缓存 builtin+MCP+插件过滤后的 base registry，再按激活技能做白名单并集。核心伴侣工具（`CORE_TOOL_NAMES`：记忆、知识检索、定时任务、执行计划、用户待办等）不受技能白名单限制。

MCP 工具在运行时动态合并，与内置工具同名时 MCP 优先或加前缀（`mcp__server__tool`）。

### 5.4 记忆系统

三层记忆模型：

| 层级 | 存储 | 生命周期 | 注入方式 |
|------|------|----------|----------|
| 工作记忆 | `messages` 表 | 当前会话 | 直接作为 messages |
| 长期记忆 | `long_term_memory` 表 | 持久 | 检索 top-K 注入 system |
| 检索记忆 | RAG chunks + Worldbook | 持久 | 检索后注入 system |

**长期记忆写入时机与边界**：

- 每次 `run_finished` 后，异步任务仅分析**本轮** user+assistant 消息；LLM 输出 key、content、七类事实类型、置信度、敏感度、模型使用策略和可选有效期
- 写入前依次做标准化、完全重复、embedding 语义重复、补充信息和真实冲突判断；同 key 不同内容进入候选，不直接覆盖
- 普通高置信偏好、习惯和做事方式可按策略静默保存；身份、关系、事件、目标、私密/敏感、低置信和冲突事实必须确认
- 密码、Token、密钥和验证码等凭据直接拒绝，不进入长期记忆或候选；健康、财务等敏感事实即使确认，也默认 `model_use_policy = deny`
- 每条用户消息通过 `extraction-state` 仅触发一次提取；`save_memory` 复用相同策略和冲突服务
- Goal / Commitment 保持各自领域表为真源；目标候选确认后写入 `goals`，不复制为长期记忆

**memory_key 命名（示例）**：

| key | 含义 |
|-----|------|
| `user.nickname` | 称呼 / 名字 |
| `user.preference.*` | 偏好 |
| `user.relationship.*` | 人际关系 |
| `user.event.*` | 有时效的事件 / 行程 |
| `user.goal.*` | 目标候选（确认后写入 goals） |
| `user.habit.*` | 习惯 |
| `user.procedure.*` | 做事方式 / 稳定流程 |
| `user.other.*` | 旧版兼容事实；新提取不会生成 |

**冲突、去重与版本策略**：

- 完全相同或高相似语义重复直接跳过，不制造候选
- 补充信息与真实冲突进入 `memory_candidates`；原 active 事实先转为 `disputed`，不再提供给模型
- 用户可选择保留原事实、用新事实替代或两条并存；状态转换、候选确认和来源记录在单一事务内提交
- 替代保留旧行并以 `superseded_by` 指向新版本；设置页手工编辑也创建版本，删除使用 `rejected` 软状态
- 模型检索仅选择 active、允许模型使用且未过期的事实

**压缩策略**：

- 会话 messages 超过 token 阈值时，对早期消息做摘要，摘要写入 `session_summaries`

### 5.5 RAG 子系统

**支持格式**：`.md` / `.txt` / `.docx` / `.doc` / `.pdf`（二进制经 `format-converters` 转 Markdown 后入库，单文件 ≤ 10MB）。

**运行一致性（2026-09-13 六轴复审）**：一次导入或重建固定同一份 Embedding 地址、密钥和模型配置；空向量、非法数值、数量/维度变化和超过 10MB 的响应会在写库前拒绝。同一文档的重建与删除共用写操作队列，重复重建明确拒绝；窗口销毁或应用退出会取消并等待活动任务，取消后的记录保持 `needs_rebuild`。删除使用 `.trash` 隔离，启动时根据数据库最终状态恢复原文件或清理已提交删除的副本。工作区导入采用完整临时文件、原子文件名占位和读回校验，启动时只清理受管临时文件。

**导入流程**：

```
用户选择文件 / 对话归档
  → 解析文本（Markdown 感知分块 splitMarkdownIntoChunks）
  → content_hash 去重（相同内容跳过）
  → 调用 Embedding API（text-embedding-v3 等）
  → 写入 documents + document_chunks（BLOB 向量）
  → 同步 document_chunks_fts（FTS5）
  → invalidateChunkCache()
```

**检索流程**（`retriever.ts`）：

```

查询文本最多使用前 4000 字符，单次结果限制为 1–20。60 秒短缓存同时绑定 chunk 版本、请求数量、RAG 运行设置、HyDE 选项和 Embedding 模型；运行中设置变化不会复用旧结果。当前容量参考和技术选型门槛见 `docs/RAG-CAPACITY-BASELINE.md`。
用户 query
  → FTS 强命中?（ragFtsFirst）→ 直接返回 sparse top-K
  → embedText(query)
  → 文档路由 top-3（文档数 ≥ ragDocRouteMinDocs 时）
  → dense top-20 + sparse top-20（候选文档子集内；sparse 优先 FTS5 trigram，sql.js 无 FTS 时走内存子串匹配）
  → RRF 融合（hybrid.ts）
  → 按 ragMinScore 过滤
  → 按文档去重（ragMaxChunksPerDoc）
  → 相邻 chunk 扩展（ragNeighborWindow）
  → 可选 rerank（ragRerankEnabled）
  → 0 结果时可选 HyDE 重试（ragHydeEnabled）
  → 格式化为 context 片段
```

**Catalog 注入**：`catalog` 模式下注入「文件名 + 一句话摘要」，引导模型调用 `search_knowledge`。

**注入模式**（`RagInjectMode`，设置 → 性能）：

| 模式 | 行为 |
|------|------|
| `catalog`（默认） | 仅注入文档目录；知识问答时模型自行调用 `search_knowledge` |
| `auto` | 检测到知识意图时自动检索并注入 top-K 片段 |
| `tool` | 完全不自动检索，仅依赖 `search_knowledge` 工具 |

**相关模块**：

| 文件 | 职责 |
|------|------|
| `chunk-cache.ts` | embedding 内存缓存，导入/删除时失效 |
| `hybrid.ts` | Reciprocal Rank Fusion |
| `embedding-store.ts` / `sqljs-embedding-store.ts` | 向量存储抽象（sql.js 实现） |
| `reindex.ts` | 换 embedding 模型后批量重嵌入；`reindexFts()` 重建 FTS |
| `summary.ts` | 导入时规则生成文档摘要 / 大纲 |
| `sparse-search.ts` | 中文友好内存 sparse 检索（sql.js 无 FTS5 时的后备） |
| `doc-cache.ts` | 文档级 embedding 内存缓存 |
| `reranker.ts` | 可选精排（默认透传） |
| `hyde.ts` | 0 结果时假设答案重检索 |
| `conversation-knowledge.ts` | 对话归档写入知识库（语义去重） |

### 5.6 Worldbook

类似 SillyTavern World Info：

| 字段 | 说明 |
|------|------|
| `keys` | 逗号分隔触发词 |
| `content` | 注入内容 |
| `priority` | 优先级，高者优先 |
| `enabled` | 是否启用 |

检索：FTS5 匹配 keys + 可选向量语义匹配。

### 5.7 技能系统 (Skills)

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];       // 白名单，空=不限制
  requiredTools?: string[];      // 缺少时不激活，并生成状态提示
  conflictsWith?: string[];      // 互斥 Skill id
  trigger: 'manual' | 'auto';
  matchKeywords?: string[];      // auto 技能：用户消息命中任一关键词时激活
  priority: number;              // 注入顺序，高者优先
  kind: 'capability' | 'workflow' | 'internal';
  validationErrors: string[];
  enabled: boolean;
}
```

技能包目录：`skills/<skill-id>/SKILL.md`。

文件顶层遵循标准 Agent Skill frontmatter（`name`、`description`、`metadata`）；上面的运行时字段由加载器从 `metadata.shorekeeper` 解析。`name` 使用 kebab-case 并与目录名一致，中文展示名使用 `metadata.shorekeeper.displayName`。

**激活逻辑**（`resolveActiveSkills`）：

- `manual`：常驻规则，用户开关后每轮注入；内置产品 Skill 默认不使用常驻模式
- `auto`：仅当 `userMessage` 命中收窄后的 `matchKeywords` 时注入；附件通过真实扩展名触发格式能力，通用附件标记不触发业务工作流
- `internal`：可供测试或开发参考，但不会出现在设置页、不会进入 Agent 上下文
- 冲突 Skill 按优先级解析；必需工具被插件设置关闭时，该 Skill 不注入，并给模型可解释的缺失工具提示

**注入位置**：`context-builder` 在稳定前缀（人设 + 上下文优先级）之后追加 `<skill>` 包裹的 fragment，再拼接工具说明；`stable-context` 中按已激活技能 ID 去重全局工具规则，避免与技能正文重复。

**运行诊断**：`run-observability` 记录本轮激活 Skill、命中触发词、冲突、必需工具缺失、工具调用次数与稳定错误类别。诊断仅驻留内存、最多保留最近 100 次，不存储用户消息正文；设置 → 技能展示最近 5 次。

**工具过滤**：多个带白名单的技能同时激活时，可用工具为各白名单的**并集**，外加 `CORE_TOOL_NAMES`（定时、计划、记忆、知识库、用户待办等）不受限制。

**内置技能包**（`skills/`）：

| id | 名称 | trigger | 说明 |
|----|------|---------|------|
| `excel` | Excel 表格处理 | auto | 分页读取、新建报表、保留结构的单元格修改 |
| `task-execution` | 多步任务执行 | auto | 仅复杂/批量任务建立精简执行计划 |
| `progress-tracker` | 进度与待办 | auto | Excel 导入待办、查询与回写 |
| `workspace-doc-edit` | 工作区文档维护 | auto | 局部精确替换优先，必要时才整文件重写 |
| `doc-to-markdown` | 文档转 Markdown | auto | Word/文本转 `.md` |
| `example` | 简洁助手 | manual/internal | 仅开发示例，不展示、不激活 |

**模块**：`src/skills/loader.ts`（发现 + mtime 缓存）、`resolve.ts`（激活）、`state.ts`（启用状态 + `getActiveSkills`）。

### 5.8 MCP 集成

- 主进程作为 MCP Client
- 配置存储在 `mcp_servers` 表：command、args、env、enabled
- 启动时连接已启用 Server，发现工具并注册
- 设置页支持添加/测试/禁用 Server

### 5.9 语音子系统（TTS / 通话）

> **当前进度：TTS 朗读与通话已落地**（按需/自动朗读、复刻音色、独立通话窗；STT → Agent → CosyVoice）。

语音运行时按 callId 管理 STT generation，同一通话的并发或过期启动只保留最新有效流；握手后异常断线会显式结束 Promise。流式 TTS 故障只降级本轮音频，不改变已成功的文字 run。单轮音频上限为 20 MB；播放正常结束、缺包、失败、窗口卸载和应用退出都会关闭 WebSocket、AudioContext、音频元素与对象 URL。

**引擎**：阿里云百炼 **CosyVoice**（`src/voice/bailian-tts.ts`），替代 M6 阶段移除的 edge-tts。

**分层**：

| 层级 | 模块 | 职责 |
|------|------|------|
| 配置 | `src/config/voice.ts` | 读写 `voice.settings` / `voice.profiles`（复刻列表类型已定义，UI 待 V1.5） |
| 主进程 | `synthesize-chunk.ts`、`electron/ipc/voice.ts` | 合成单段音频；`voice:synthesize` 返回 speak/pause 步骤序列 |
| 文本清洗 | `text-for-speech.ts` | 剥离 Markdown；解析 RP **动作**（`*…*`）与 **对白**，动作后插入 pause |
| 渲染进程 | `useVoicePlayback.ts`、`MessageSpeechButton.tsx` | Web Audio 播放；消息 🔊 按需朗读 |
| 自动播放 | `ChatPage.tsx` | `run_finished` 后在渲染进程调用 `voice.synthesize`（**非** Orchestrator 广播） |

**配置要点**（设置 → **语音**）：

- `ttsVoiceId`：百炼预设或复刻 `voice_id`（用户手动填写；复刻创建流程见 V1.5 计划）
- `useChatApi`：复用 Chat API Key，或独立 `voiceApiKey` + `voiceTtsEndpoint`
- `ttsAutoPlay`：Agent 回复结束后自动朗读（默认关）
- `ttsPlaybackGain`：渲染端 Web Audio 增益（0.5–3）

**与 AG-UI 的关系**：

- 类型中保留 `tts_chunk`，但**当前实现走 IPC `voice:synthesize`**，不经 `agent:event` 流式推送
- `tts_start` / `tts_end` 尚未实现；流式播放需要时再接入 Orchestrator 侧 pipeline

**待做（按计划）**：STT 语音输入（V3）、百炼声音复刻管理 UI（V1.5）、Orchestrator `tts-pipeline` 与事件广播（V2）

### 5.10 权限控制

```typescript
type PermissionFlag =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network'
  | 'mcp'
  | 'shell';

interface PermissionPolicy {
  filesystem: {
    allowedRoots: string[];  // 默认 userData/workspace
    requireConfirmOnWrite: boolean;
  };
  network: boolean;
  mcp: boolean;
}
```

敏感操作（写文件、执行 MCP 写操作）弹出主进程 `dialog` 确认。

### 5.11 好感度系统 (Affection)

轻量伴侣进度，分数 0–100 持久化于 `app_settings`，分五阶段注入 prompt 语气指引：

| 阶段 | 分数 | 说明 |
|------|------|------|
| 初醒 | 0–19 | 克制、工具式距离感 |
| 同行 | 20–39 | 可靠同伴 |
| 守望 | 40–59 | 默认起点，留意调律者状态 |
| 羁绊 | 60–79 | 主动表达惦念 |
| 岸畔 | 80–100 | 深层珍重，仍保持沉静底色 |

**加分来源**：每日首次对话、连续轮次（有上限）、状态面板喂食。实现见 `src/affection/`。

### 5.12 联网搜索

- 默认提供商：**博查**（`src/tools/web/search-providers/bocha.ts`）
- 配置：设置 → 插件，或 `.env` 中 `WEB_SEARCH_API_KEY` / `BOCHA_API_KEY`
- `web_search` 工具经插件开关控制；与 RAG 知识库独立

### 5.13 应用自动更新

- 打包版集成 **electron-updater**（`electron/update/auto-updater.ts`）
- 启动约 8s 后静默检查；设置 → **关于** 可手动检查与安装
- IPC：`update:getVersion`、`update:check`、`update:install`；状态经 `update:status` 广播
- 开发模式（`pnpm dev`）不支持更新检查

### 5.14 Agent 工作流指示（UI）

聊天窗顶栏下方 **AgentWorkflowStrip** 展示当前 run 阶段：

| 步骤 | 含义 |
|------|------|
| 准备 | 会话就绪、等待模型 |
| 思考 | 流式输出 / 推理中 |
| 工具 | 工具调用或权限确认 |
| 输出 | 生成最终回复 |

由 `deriveAgentWorkflow`（`src/renderer/hooks/agent-workflow.ts`）根据消息流、`isRunning`、权限弹窗推导；权限等待时 headline 为「等待确认」。支持预览的写操作会在同一权限弹窗展示修改前后文本或 Excel 单元格新旧值，确认后才执行。

设置 → 数据与任务 → **运行记录**提供跨重启历史浏览：最近 100 条 run 可按状态筛选，详情展示工具步骤、错误、审批结论与文件产物。列表和详情分别使用 `agent:runHistory`、`agent:runDetail`，只呈现持久化脱敏摘要。

---

## 6. AG-UI 事件协议

主进程与渲染进程之间的实时通信协议。

### 6.1 事件类型

```typescript
type AgUiEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'run_finished'; runId: string }
  | { type: 'run_error'; runId: string; message: string; sessionId?: string }
  | { type: 'text_delta'; runId: string; delta: string }
  | { type: 'reasoning_delta'; runId: string; delta: string }
  | { type: 'tool_call_start'; runId: string; callId: string; name: string; args: unknown }
  | { type: 'tool_call_end'; runId: string; callId: string; result: ToolResult }
  | { type: 'state_update'; state: AgentPresenceState }
  | { type: 'tts_chunk'; runId: string; audio: ArrayBuffer }  // 类型保留；TTS 当前走 voice IPC
  | { type: 'usage'; runId: string; promptTokens: number; completionTokens: number; cachedTokens?: number };
```

### 6.2 传输方式

- **IPC**：`ipcMain.handle('agent:send')` + `webContents.send('agent:event')`
- 多窗口：主进程向所有订阅窗口广播 `agent:event`
- 请求/响应型操作（设置、历史列表）使用 `invoke/handle`

### 6.3 状态同步

```typescript
interface AgentPresenceState {
  online: boolean;
  mood: 'happy' | 'calm' | 'sleepy' | 'thinking';
  activity: 'idle' | 'accompanying' | 'feeding' | 'working';
  affectionStage: string;   // 好感度阶段名（如「守望」）
  currentModel: string;
  tokenUsageToday: number;
}
```

---

## 7. 数据模型

### 7.1 数据库文件

| 项 | 路径 |
|----|------|
| 数据库目录 | `D:\SQLlite`（可通过 `SHOREKEEPER_DB_DIR` 覆盖） |
| 主库文件 | `D:\SQLlite\shorekeeper.db`（可通过 `SHOREKEEPER_DB_PATH` 覆盖） |
| 工具工作区 | `D:\SQLlite\workspace`（Agent 文件读写沙箱） |

使用 **文件模式**（非 `:memory:`）。应用启动时若目录不存在则自动创建；首次运行执行迁移建表。

配置定义见 `src/config/paths.ts`。

### 7.2 表结构

#### sessions

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 会话标题（首条消息摘要） |
| archived | INTEGER | 0/1，归档标记 |
| compressed | INTEGER | 0/1，长会话已压缩 |
| created_at | INTEGER | Unix ms |
| updated_at | INTEGER | Unix ms |

#### messages

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT FK | 所属会话 |
| role | TEXT | user / assistant / system / tool |
| content | TEXT | 消息内容（JSON 字符串支持多模态） |
| token_count | INTEGER | 可选 |
| created_at | INTEGER | Unix ms |

#### user_profile

| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | 如 nickname, preference.tone |
| value | TEXT | JSON 或纯文本 |
| updated_at | INTEGER | Unix ms |

#### long_term_memory

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| memory_key | TEXT | 可选；结构化键（如 `user.nickname`），仅 active 行唯一 |
| content | TEXT | 记忆内容 |
| importance | REAL | 0-1 |
| source_session_id | TEXT | 来源会话 |
| memory_type | TEXT | identity / preference / relationship / event / goal / habit / procedure / other |
| confidence | REAL | 事实可信度，独立于 importance |
| sensitivity | TEXT | normal / private / sensitive |
| model_use_policy | TEXT | allow / deny |
| status | TEXT | active / disputed / superseded / rejected |
| valid_from / expires_at | INTEGER | 生效和过期时间（Unix ms，可空） |
| superseded_by | TEXT FK | 替代该事实的新版本 id |
| created_at / updated_at | INTEGER | Unix ms |

#### memory_candidates / memory_sources

- `memory_candidates` 保存待确认事实的类型、置信度、敏感/模型策略、有效期、冲突对象与建议动作；已确认或拒绝的候选保留状态，用于幂等与防止拒绝事实自动复活。
- `memory_sources` 为每个事实记录 conversation、run、document、tool、goal、commitment 或 user_edit 等稳定来源；事实删除时来源级联清理。
- 冲突候选写入与原事实进入 disputed，以及替代版本、来源和候选终态，均由领域服务在数据库事务内完成。

#### task_run_context_sources 与稳定引用

- 上下文预算裁剪完成后，实际进入 prompt 的记忆、检索片段、active goal 和未完成 commitment 会写入 run 来源账本；完整 prompt 与私密记忆正文不进入审计。
- 稳定引用为 `mem:<id>`、`doc:<documentId>#chunk:<index>`、`goal:<id>`、`commitment:<id>`。回答中的 `〔…〕` 引用由 renderer 转成来源卡片，运行详情也可回查同一来源。
- 记忆选择综合相关度、importance、confidence 与更新时间；状态非 active、策略 deny 或已过期的事实仍在检索入口前被排除。

#### session_summaries

| 列 | 类型 | 说明 |
|----|------|------|
| session_id | TEXT PK | 所属会话 |
| summary | TEXT | 压缩后的早期对话摘要 |
| compressed_up_to_message_id | TEXT | 已压缩到的最后一条 message id |
| updated_at | INTEGER | Unix ms |

#### bookkeeping_entries

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT | 可选，来源会话 |
| category | TEXT | 分类 |
| amount | REAL | 金额 |
| currency | TEXT | 默认 CNY |
| note | TEXT | 备注 |
| entry_type | TEXT | income / expense 等 |
| created_at | INTEGER | Unix ms |

#### worldbook_entries

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| keys | TEXT | 触发词，逗号分隔 |
| content | TEXT | 注入内容 |
| priority | INTEGER | 默认 0 |
| enabled | INTEGER | 0/1 |
| created_at | INTEGER | Unix ms |

#### documents

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| filename | TEXT | 原始文件名 |
| filepath | TEXT | 本地存储路径 |
| mime_type | TEXT | |
| chunk_count | INTEGER | |
| imported_at | INTEGER | Unix ms |
| content_hash | TEXT | SHA-256，导入去重 |
| embedding_model | TEXT | 嵌入模型 ID |
| embedding_dim | INTEGER | 向量维度 |
| source_kind | TEXT | `snapshot / local_file` |
| source_modified_at / source_size | INTEGER | 上次成功索引时的来源基线 |
| last_checked_at | INTEGER | 最近来源检查时间 |
| freshness_status / stale_reason | TEXT | `snapshot / unknown / current / changed / missing` 与可解释原因 |
| sync_policy | TEXT | `manual / auto`，默认手工 |

本地来源只在手工动作或用户显式开启后的启动/唤醒低频检查点比较 mtime/size；不建立无界 watcher。变化先标记 `changed`，只有新版本完整索引成功后才沿既有版本事务切换；缺失、转换失败或向量失败都保留上一可用快照。重新定位来源后由用户确认同步生成新版本。

#### document_chunks

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| document_id | TEXT FK | |
| chunk_index | INTEGER | |
| content | TEXT | 块文本 |
| embedding | BLOB | Float32Array 序列化 |

#### document_chunks_fts（FTS5 虚表）

```sql
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
  chunk_id UNINDEXED, document_id UNINDEXED,
  content, filename, tokenize='unicode61'
);
```

#### token_usage

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT | 可选 |
| model | TEXT | |
| prompt_tokens | INTEGER | |
| completion_tokens | INTEGER | |
| cached_tokens | INTEGER | 显式缓存命中（prompt cache） |
| created_at | INTEGER | Unix ms |

#### scheduled_tasks

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| name | TEXT | |
| cron | TEXT | cron 表达式 |
| action_type | TEXT | agent_prompt / reminder / ... |
| action_payload | TEXT | JSON |
| enabled | INTEGER | 0/1 |
| last_run_at | INTEGER | 可选 |
| schedule_kind | TEXT | cron / once |
| run_at | INTEGER | 一次性任务触发时间 |

#### mcp_servers

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| name | TEXT | |
| command | TEXT | |
| args | TEXT | JSON 数组 |
| env | TEXT | JSON 对象 |
| enabled | INTEGER | 0/1 |

#### app_settings

| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | |
| value | TEXT | JSON |

### 7.3 FTS5 虚表

```sql
CREATE VIRTUAL TABLE worldbook_fts USING fts5(
  keys, content, content='worldbook_entries', content_rowid='rowid'
);
```

### 7.4 ER 关系简图

```
sessions 1───N messages
sessions 1───0..1 session_summaries
documents 1───N document_chunks
sessions 1───N token_usage (optional)
sessions 1───N bookkeeping_entries (optional)
```

---

## 8. UI 设计规范

### 8.1 视觉风格

| 元素 | 规范 |
|------|------|
| 主色 | 深紫 `#1a1028` ~ `#2d1b4e` 渐变 |
| 强调色 | 粉紫 `#e879a8`, `#c084fc` |
| 背景 | 星空粒子 / 微光（CSS 或 Canvas） |
| 面板 | 毛玻璃 `backdrop-blur`, 圆角 16-24px |
| 字体 | 中文：思源黑体 / 苹方；英文：Inter |

### 8.2 聊天窗

- 顶栏下方 **AgentWorkflowStrip**：运行中展示准备 → 思考 → 工具 → 输出四步进度
- 左右气泡：Agent 左，用户右
- Agent 头像：静态头像或用户自定义头像
- 顶栏：模型名、连接状态、Style / Reasoning 下拉
- 工具调用：折叠卡片展示名称、参数、结果
- 写操作确认：支持预览的工具展示拟议 diff，并在确认后校验目标版本
- 推理过程：可折叠灰色区域
- Assistant 消息 **🔊** 按钮：按需 TTS 朗读（设置 → 语音）

### 8.3 状态面板

- 大圆形头像、名称、Online 指示
- 状态卡片：State（陪伴中）、Mood（开心）
- 活动区：喂食等轻互动
- 按钮：打开聊天、切换模型、设置

### 8.4 日程 / Token 面板

- 日期、待办数量
- Token 当日/累计、进度条
- 周趋势柱状图（Recharts）
- 定时任务列表与「任务设置」入口
- 设置中的「运行记录」列表与运行详情（步骤、审批、产物）

### 8.5 Dock 快捷栏

| 区块 | 内容 | 点击行为 |
|------|------|----------|
| 头像 | 守岸人静态头像 | 打开聊天窗 |
| 状态 | 在线指示、活动、心情 | 打开状态面板 |
| 日程 | 定时任务数量与最近条目 | 打开日程面板 |
| 今日 Token | 当日用量与进度条 | 打开日程面板（含 Token 详情） |

- 竖向堆叠，固定宽度约 300px；可拖动移动位置。
- 顶栏控件（悬停显示）：窗口置顶 📌、固定位置 📍。
- 拖动手势与点击区分：移动超过阈值视为拖动，否则触发打开。

---

## 9. 配置与安全

### 9.1 配置项

| 配置 | 存储 | 说明 |
|------|------|------|
| API Keys | `app_settings` 或加密文件 | 不进渲染进程、不进 git |
| 模型列表 | `app_settings` | 端点、模型 ID、协议类型 |
| 人设 Prompt | `app_settings` | `persona.system_prompt`、`persona.version`（`custom` 不自动覆盖）、`persona.display_name` |
| 外观主题 | `app_settings` + `appearance/` | `ui.theme.preset_id`、`ui.theme.assets`、`ui.theme.veil_opacity`；用户图片存 `D:\SQLlite\appearance\` |
| 语音 | `app_settings` | `voice.settings`（TTS/STT 行为）、`voice.profiles`（复刻音色列表，类型已备） |
| 性能 / RAG | `app_settings` 或 `.env` | `RAG_*`、`MAX_HISTORY_MESSAGES`、`memorySemanticInContext` 等 |
| 权限策略 | `app_settings` | filesystem roots 等 |
| 窗口位置 | `app_settings` | 各窗 last bounds（含 `window.bounds.dock`） |
| Dock 偏好 | `app_settings` | alwaysOnTop、positionLocked |

### 9.2 安全原则

1. API Key 仅主进程读取
2. `contextIsolation: true`, `nodeIntegration: false`（渲染进程）
3. 工具文件访问限制在 `workspaceRoot` 与用户授权目录
4. 外部 URL 抓取需 `network` 权限
5. 导入文档路径不入公开仓库

---

## 10. 目录结构

```
TheShorekeeper/
├── docs/
│   ├── DESIGN.md                 # 架构设计（本文档）
│   ├── DATABASE.md               # 数据库、migration、数据目录
│   ├── MODELS.md                 # 模型与 API / Embedding 配置
│   ├── UI-THEME.md               # 主题预设、壁纸、CSS 变量
│   ├── 使用说明.md               # 日常使用说明
│   ├── RAG-OPTIMIZATION.md       # 知识库检索优化
│   ├── STABILITY-PLAN.md         # M1-M7 后稳定化计划（S0–S5 已收口）
│   ├── S2-ACCEPTANCE.md          # Agent 运行时验收集
│   ├── S3-ACCEPTANCE.md          # 工具 / 技能 / 权限验收集
│   ├── S5-ACCEPTANCE.md          # 私人助理验收集
│   └── RAG-RETRIEVAL-BASELINE.md # RAG 检索质量基线
├── electron/
│   ├── main.ts                   # 应用入口：env、DB、IPC、托盘、调度、自动更新
│   ├── preload.ts                # contextBridge API（window.shorekeeper）
│   ├── tray.ts
│   ├── paths.ts                  # 打包态资源路径
│   ├── protocol/
│   │   └── appearance-assets.ts  # sk-asset:// 本地外观文件
│   ├── update/
│   │   └── auto-updater.ts       # electron-updater 检查与安装
│   ├── ipc/                      # 见下表「IPC 模块」
│   ├── windows/                  # chat / status / schedule / dock / reminder / broadcast
│   ├── dock/                     # Dock 显隐、偏好
│   ├── scheduler/cron.ts         # 定时任务执行
│   ├── state/presence.ts         # Agent 在线 / 心情 / 活动 / 好感阶段
│   ├── tasks/events.ts           # 任务变更广播
│   └── reminder/popup.ts
├── src/
│   ├── agent/                    # orchestrator, loop, context-builder, stable-context, session-background, session-run-lock
│   ├── affection/
│   ├── config/
│   │   ├── paths.ts, bootstrap-data-layout.ts
│   │   ├── persona.ts, appearance.ts, voice.ts
│   │   ├── performance.ts, plugins.ts, web-search-config.ts
│   │   └── themes/               # ThemePreset 定义（9 套）
│   ├── models/                   # openai-compatible, anthropic-like, embedding-config, stream-chat
│   ├── tools/                    # agent-registry + 分类子目录
│   │   ├── file/                 # read / write / list_dir / artifact / workspace-hints
│   │   ├── web/                  # web_search, fetch, weather + search-providers/
│   │   ├── doc/                  # 文档生成、Markdown 转换、CJS 加载器
│   │   │                         # exceljs-loader, doc-loaders, parse-xlsx
│   │   ├── memory/               # recall / knowledge 工具
│   │   ├── life/                 # 记账、旅行规划等
│   │   └── schedule/             # 定时任务工具
│   ├── memory/                   # 长期记忆、Worldbook、摘要、提取、session-context
│   ├── rag/                      # 导入、分块、FTS+向量混合检索、缓存
│   ├── voice/                    # 百炼 CosyVoice TTS、朗读文本清洗
│   ├── mcp/client.ts
│   ├── skills/                   # loader, resolve, state（运行时读 skills/）
│   ├── tasks/                    # 用户待办、xlsx 回写同步
│   ├── scheduler/                # reminder 意图解析与执行
│   ├── session/                  # 活跃会话 id
│   ├── workspace/                # 工作区导入、扩展名白名单
│   ├── shared/                   # types, theme-styles, appearance-asset-url
│   └── db/                       # better-sqlite3 / sql.js adapter、migrations、repositories、seeds
├── src/renderer/                 # React（main.tsx + ?panel= 路由）
│   ├── ChatPage.tsx
│   ├── components/               # MessageList, AgentWorkflowStrip, MessageSpeechButton, PermissionDialog, …
│   ├── hooks/                    # useAgentEvents, useVoicePlayback, agent-workflow
│   ├── settings/                 # SettingsDrawer + 各设置子页（含 VoicePage、AboutPage）
│   ├── theme/                    # ThemeProvider, apply-theme, useTheme
│   ├── dock/ | status/ | schedule/ | reminder/
│   └── styles/globals.css        # --sk-* CSS 变量与 keeper-* 工具类
├── skills/                       # 技能包：excel, task-execution, progress-tracker, …
├── scripts/                      # db:init / seed / cleanup / reset-keep-models
├── public/                       # keeper-bg.png、默认头像等静态资源
├── .env.example
├── vite.config.ts
└── package.json                  # electron-builder files 白名单
```

### IPC 模块（`electron/ipc/`）

`trusted-ipc.ts` 是唯一允许直接注册 `ipcMain.handle/on` 的边界。功能模块不得绕过它；受信页面仅包含打包后的 renderer index，或开发环境配置的 loopback 同源页面，`about:blank` 只可作为加载中间态，不得发起高权限 IPC。

| 文件 | 职责 |
|------|------|
| `agent.ts` | 流式对话、AG-UI 事件 |
| `session.ts` | 会话 CRUD、归档、压缩 |
| `model.ts` / `profile.ts` | 模型配置与用户画像 |
| `persona.ts` / `appearance.ts` | 人设与主题/壁纸/头像 |
| `documents.ts` / `embedding.ts` | 知识库导入与向量 API |
| `worldbook.ts` | Worldbook 条目 |
| `performance.ts` | RAG / 记忆 / 历史条数等性能项 |
| `plugins.ts` / `web-search.ts` | 插件开关与博查搜索 |
| `mcp.ts` / `skills.ts` | MCP 与技能 |
| `tasks.ts` | 定时任务 |
| `presence.ts` / `stats.ts` | 状态与 Token 统计 |
| `workspace.ts` | 工作区文件、拖拽导入 |
| `permission.ts` | 工具执行确认弹窗 |
| `voice.ts` | TTS 合成与语音设置 |
| `update.ts` | 应用版本与自动更新 |
| `window.ts` / `dock.ts` | 多窗管理与 Dock |

### 打包产物（`pnpm dist`）

| 包含 | 不包含 |
|------|--------|
| `dist/` 前端、`dist-electron/` 主进程 | `.env`、源码 `src/`、`docs/` |
| `skills/`、`package.json` | 本地 `shorekeeper.db`、`workspace/` |
| `extraResources`: migration `.sql`、sql.js WASM（回滚） | `node_modules/` 全量 |

用户敏感配置存于 **本机** `app_settings`（SQLite）或 `userData/.env`，不随安装包分发。

### 数据目录（默认 `D:\SQLlite\`）

| 路径 | 内容 |
|------|------|
| `shorekeeper.db` | 会话、消息、记忆、设置、RAG 元数据 |
| `workspace/` | Agent 可读写文件、知识库副本 |
| `appearance/` | 用户上传的背景与头像文件 |
| `appearance/voice-samples/` | （计划）声音复刻样本备份 |

---

## 11. 开发里程碑

| 里程碑 | 目标 | 状态 |
|--------|------|------|
| **M1** | 基础脚手架 | ✅ Electron+Vite+React，流式 LLM，SQLite |
| **M2** | Agent 核心 | ✅ Tool loop，AG-UI 事件，内置工具 |
| **M3** | 记忆 | ✅ memory_key upsert、Worldbook、设置页 |
| **M4** | 多窗 UI | ✅ 多窗、托盘、Dock、Token/定时任务 |
| **M5** | RAG | ✅ 文档导入、向量检索、语义记忆去重 |
| **M5-RAG** | RAG 优化 | ✅ 混合检索、缓存、Markdown 分块、注入模式 |
| **M6** | 扩展 | ✅ MCP、技能、Anthropic 协议 |
| **M7** | 工具补齐 | ✅ 文档生成、记账、旅行规划；Token 优化与长会话压缩；Windows 打包 |
| **M7+** | 人设 / 外观 / 主题 | ✅ 可编辑人设、9 套主题、自定义壁纸与头像（见 UI-THEME.md） |
| **Voice** | TTS / 通话 | ✅ 百炼 CosyVoice、语音设置页、通话窗 |

每个里程碑结束时应可独立运行、可测试。

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| OpenAI / Anthropic 工具格式差异 | 工具循环失败 | 适配层统一 ToolCall 结构 |
| better-sqlite3 与 Electron ABI | 打包后 native 加载失败 | 固定 `better-sqlite3@13.0.3`；sql.js 保留为回滚源 |
| 上下文超长 | 成本高、超限 | 摘要压缩 + RAG 检索代替全量历史 |
| MCP Server 不稳定 | 工具超时 | 超时、重试、禁用开关 |
| 百炼 TTS endpoint 与 Chat 不同 | 语音不可用 | 设置 → 语音独立 endpoint；或 `VOICE_TTS_ENDPOINT` |
| 包体过大 | 下载/更新慢 | electron-updater 增量更新；打包白名单控制资源体积 |

---

## 13. 附录

### 13.1 术语表

| 术语 | 说明 |
|------|------|
| AG-UI | Agent 运行过程的标准化 UI 事件流 |
| Worldbook | 关键词触发的世界观/设定注入知识库 |
| RAG | 检索增强生成，从导入文档检索相关内容 |
| MCP | Model Context Protocol，外部工具服务协议 |
| Skill | 可插拔技能包（`skills/*/SKILL.md`）；标准元数据下支持常驻（manual）或按需（auto）激活、工具契约、冲突声明和配置诊断 |

### 13.2 参考资源

- [Model Context Protocol](https://modelcontextprotocol.io/)

### 13.3 文档修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0-draft | 2026-06-29 | 初稿，基于需求讨论整理 |
| 0.1.1 | 2026-06-29 | M4 多窗/Dock/托盘模型；M5 更正为 RAG；向量实现为 BLOB+余弦 |
| 0.2.0 | 2026-07-01 | 反映 M1–M7 实现：混合 RAG、好感度、博查搜索、插件系统、目录与表结构更新 |
| 0.2.1 | 2026-07-01 | 目录结构扩充：IPC/主题/打包白名单；人设外观主题落地；文档与 superpowers 索引整理 |
| 0.3.0 | 2026-07-02 | 语音 V1（百炼 TTS）、自动更新、Agent 工作流条；表结构补全（session_summaries、bookkeeping）；目录与 IPC 同步 |
| 0.3.2 | 2026-09-11 | 同步 S0–S5：生产库改为 better-sqlite3；清理已完成的里程碑/专项计划文档 |
| 0.3.3 | 2026-09-13 | 同步 H1 RAG/工作区一致性与 H2 IPC 零信任、窗口/媒体/更新生命周期契约 |
| 0.3.4 | 2026-09-13 | 同步 P1.0—P1.2：个人事实类型/来源/时效、冲突候选、事务化版本链与模型检索过滤 |
| 0.3.5 | 2026-09-13 | 完成 P1.3—P1.5 工程闭环：run 上下文来源、稳定引用卡片、本地知识新鲜度与低频同步 |

---

*本文档描述 The Shorekeeper 的目标架构与模块边界。实现时以本文档为准，重大变更需更新版本号与修订记录。*
