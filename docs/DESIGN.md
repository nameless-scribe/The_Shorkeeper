# The Shorekeeper 设计文档

> 版本：0.3.0  
> 更新日期：2026-07-02  
> 状态：**M1–M7 已完成**（含 RAG 优化、人设/外观/主题、插件与好感度、自动更新）；**语音 V1 部分落地**（百炼 TTS 按需/自动朗读）；**M8 桌宠**待做

---

## 1. 项目概述

### 1.1 项目名称

**The Shorekeeper**（岸守护者）

### 1.2 项目定位

The Shorekeeper 是一款 **自用桌面 AI Agent 应用**，将完整的 Agent 能力（工具调用、记忆、RAG、MCP、技能）与 **Live2D 桌宠** 及 **伴侣式多窗 UI** 结合。用户通过透明桌宠角色与浮动面板与 Agent 交互，获得人格化、可扩展的本地智能助手体验。

### 1.3 核心目标

| 目标 | 说明 |
|------|------|
| 本地优先 | 数据、配置、会话默认存储在本机，无需依赖云端数据库 |
| Agent 能力完整 | 支持多轮工具调用、记忆、文档检索、MCP 扩展 |
| 伴侣式体验 | Live2D 角色、心情/状态、TTS、人格化对话 |
| 可扩展 | 技能系统、MCP Server、内置工具可插拔 |
| 自用友好 | 部署简单、单文件数据库备份、无服务端运维 |

### 1.4 非目标（当前阶段）

- 多用户 / 账号系统
- 云端同步（可后续扩展）
- 商业分发与 Live2D 商用授权流程
- 移动端版本

---

## 2. 用户场景

### 2.1 典型使用流程

```
启动应用
  → 默认显示聊天窗；状态/日程窗预加载但隐藏
  → 全部主面板隐藏时显示 Dock 快捷栏（头像 + 状态 / 日程 / Token）
  → 点击 Dock 区块 / 托盘菜单打开对应窗口
  → （M8）Live2D 桌宠显示在桌面（透明置顶窗）
  → 选择模型、风格、推理模式
  → 发送消息 → Agent 循环（可能调用工具）→ 流式回复
  → 角色播放动作 / TTS 朗读
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
│  Live2D 窗 │ 聊天窗 │ 状态面板 │ 日程/Token │ Dock 快捷栏 │ 设置/侧边栏 │
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

### 3.3 进程与窗口模型

| 窗口 | 类型 | 职责 |
|------|------|------|
| `live2d` | 透明、无边框、可置顶 | PixiJS 渲染 Live2D，接收动作指令（**M8**） |
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
| Live2D | PixiJS + pixi-live2d-display | 桌宠渲染 |
| 数据库 | SQLite（运行时 **sql.js**；设计原案 better-sqlite3） | 嵌入式主库 |
| Schema | `src/db/schema.ts` + 手写 SQL migration | 类型与迁移 |
| 全文检索 | SQLite FTS5 | Worldbook 关键词 |
| 向量检索 | sql.js BLOB + TS 余弦 + FTS5 RRF 混合（M5 + RAG 优化） | RAG、语义记忆 |
| 定时任务 | node-cron | 本地调度 |
| TTS | edge-tts 或等价方案 | 文本转语音 |
| MCP | @modelcontextprotocol/sdk | 外部工具扩展 |

### 4.2 数据库选型结论

**主库：SQLite（sql.js + 手写 migration）**

理由：Electron 主进程友好、单文件备份、WASM 实现免 native 编译（Windows 兼容）。详见 [DATABASE.md](./DATABASE.md)。

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

---

## 5. 核心模块设计

### 5.1 Agent 编排器 (Orchestrator)

**职责**：接收用户输入，组装上下文，驱动 Agent 循环，发射 AG-UI 事件，处理副作用（持久化、TTS、Live2D）。

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

1. **稳定前缀**（`stable-context.ts`）：人设 System Prompt + **当前可用工具**摘要（`formatToolGuideForPrompt`）+ 技能 fragment（利于 prompt cache）
2. **动态块**（随 query 变化）：
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
- 同一会话通过 `session-run-lock` 串行运行，新消息需等待或中断当前 run
- 用户可在设置中中断进行中的 run（`AbortController`）
- 下一条消息前通过 `session-background` 等待同会话后台任务（记忆提取、摘要压缩）完成，避免竞态
- 用户消息可触发 **定时提醒意图**（`scheduler/reminder-intent`）或 **对话归档知识库**（`rag/conversation-knowledge`），在 Agent loop 之前短路处理

### 5.3 工具系统 (Tool Registry)

**接口**：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'file' | 'web' | 'doc' | 'memory' | 'life' | 'mcp' | 'skill';
  requiresPermission: PermissionFlag[];
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  sessionId: string;
  workspaceRoot: string;  // 沙箱根目录
  signal: AbortSignal;
}
```

**内置工具（当前）**：

| 类别 | 工具 |
|------|------|
| 文件 | `read_file`, `write_file`, `list_dir` |
| 网络 | `web_search`（博查）, `fetch_url`, `get_weather`, `translate` |
| 文档 | `convert_to_markdown`, `gen_markdown`, `gen_docx`, `gen_xlsx`, `gen_pdf`, `read_xlsx`（工作区 Excel） |
| 记忆 / 知识 | `recall_memory`, `save_memory`, `search_worldbook`, `search_knowledge` |
| 生活 | `bookkeeping`, `travel_plan` |
| 日程 | `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task` |

工具可见性受 **设置 → 插件**（`PluginSettings`）与 **技能白名单** 双重过滤；核心伴侣工具（记忆、知识检索、定时任务）不受技能白名单限制。

MCP 工具在运行时动态合并，与内置工具同名时 MCP 优先或加前缀（`mcp__server__tool`）。

### 5.4 记忆系统

三层记忆模型：

| 层级 | 存储 | 生命周期 | 注入方式 |
|------|------|----------|----------|
| 工作记忆 | `messages` 表 | 当前会话 | 直接作为 messages |
| 长期记忆 | `long_term_memory` 表 | 持久 | 检索 top-K 注入 system |
| 检索记忆 | RAG chunks + Worldbook | 持久 | 检索后注入 system |

**长期记忆写入时机**：

- 每次 `run_finished` 后，异步任务仅分析**本轮** user+assistant 消息，LLM 输出 `[{key, content}]`，经 `upsertMemory` 写入（同 `memory_key` 更新而非新增）
- 提取前将已有记忆列表注入 prompt，避免重复提取同一主题
- 每条用户消息通过 `extraction-state` 仅触发一次提取
- 或通过工具 `save_memory` 显式写入（推荐带 `key`；无 key 时走自由文本 + 子串去重）

**memory_key 命名（示例）**：

| key | 含义 |
|-----|------|
| `user.nickname` | 称呼 / 名字 |
| `user.preference.*` | 偏好 |
| `user.schedule.*` | 作息、忙碌时段 |
| `user.habit.*` | 习惯 |
| `user.other.*` | 其他事实 |

**去重策略**：

- M3：结构化 **key upsert**（主路径）+ 无 key 文本的子串匹配（兜底）
- M5：向量语义相似度合并（如不同表述的同一偏好）

**压缩策略**：

- 会话 messages 超过 token 阈值时，对早期消息做摘要，摘要写入 `session_summaries`

### 5.5 RAG 子系统

**支持格式**：`.md` / `.txt` / `.docx` / `.doc` / `.pdf`（二进制经 `format-converters` 转 Markdown 后入库，单文件 ≤ 10MB）。

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
用户 query
  → embedText(query)
  → dense top-20（余弦，读 chunk-cache 内存缓存）
  → sparse top-20（document_chunks_fts BM25）
  → RRF 融合（hybrid.ts）
  → 按 ragMinScore 过滤
  → 按文档去重（ragMaxChunksPerDoc）
  → 格式化为 context 片段
```

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
| `reindex.ts` | 换 embedding 模型后批量重嵌入 |
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
  trigger: 'manual' | 'auto';
  matchKeywords?: string[];      // auto 技能：用户消息命中任一关键词时激活
  priority: number;              // 注入顺序，高者优先
  enabled: boolean;
}
```

技能包目录：`skills/<skill-id>/SKILL.md`。

**激活逻辑**（`resolveActiveSkills`）：

- `manual`：用户开关后每轮注入 prompt，并参与工具白名单并集
- `auto`：仅当 `userMessage` 命中 `matchKeywords` 时注入 prompt 且参与本轮白名单（附件预解析会追加 `[工作区附件已解析]`，相关技能关键词须覆盖该标记）

**注入位置**：`context-builder` 在稳定前缀（人设 + 上下文优先级）之后追加 `<skill>` 包裹的 fragment，再拼接工具说明；`stable-context` 中按已激活技能 ID 去重全局工具规则，避免与技能正文重复。

**工具过滤**：多个带白名单的技能同时激活时，可用工具为各白名单的**并集**，外加 `CORE_TOOL_NAMES`（定时、计划、记忆、知识库等核心能力）不受限制。

### 5.8 MCP 集成

- 主进程作为 MCP Client
- 配置存储在 `mcp_servers` 表：command、args、env、enabled
- 启动时连接已启用 Server，发现工具并注册
- 设置页支持添加/测试/禁用 Server

### 5.9 语音子系统（TTS）

> 专项计划：[superpowers/plans/2026-07-01-voice.md](./superpowers/plans/2026-07-01-voice.md)  
> **当前进度：V1 部分完成**（按需朗读 + 自动播放）；STT、声音复刻 UI、Orchestrator 侧 `tts_chunk` 广播、M8 口型联动待做。

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
- `tts_start` / `tts_end` / `speak_start` / `speak_end` 尚未实现；M8 口型联动时再接入 Orchestrator 侧 pipeline

**待做（按计划）**：STT 语音输入（V3）、百炼声音复刻管理 UI（V1.5）、Orchestrator `tts-pipeline` 与事件广播（V2）、桌宠口型（V4）

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

### 5.13 Live2D 子系统

- 独立 `BrowserWindow`：`transparent: true`, `frame: false`
- PixiJS Application 加载 `.model3.json`
- 动作映射表（可配置）：

| 事件 | 默认动作 |
|------|----------|
| `idle` | 待机 |
| `think` | 思考 |
| `speak` | 说话 / 口型 |
| `happy` | 开心 |
| `tap` | 点击反应 |

- 点击角色：打开聊天窗；可选穿透模式（仅角色区域可点）

**自用注意**：使用官方示例或明确允许个人使用的模型；模型目录加入 `.gitignore`。

### 5.14 应用自动更新

- 打包版集成 **electron-updater**（`electron/update/auto-updater.ts`）
- 启动约 8s 后静默检查；设置 → **关于** 可手动检查与安装
- IPC：`update:getVersion`、`update:check`、`update:install`；状态经 `update:status` 广播
- 开发模式（`pnpm dev`）不支持更新检查

### 5.15 Agent 工作流指示（UI）

聊天窗顶栏下方 **AgentWorkflowStrip** 展示当前 run 阶段：

| 步骤 | 含义 |
|------|------|
| 准备 | 会话就绪、等待模型 |
| 思考 | 流式输出 / 推理中 |
| 工具 | 工具调用或权限确认 |
| 输出 | 生成最终回复 |

由 `deriveAgentWorkflow`（`src/renderer/hooks/agent-workflow.ts`）根据消息流、`isRunning`、权限弹窗推导；权限等待时 headline 为「等待确认」。

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
  | { type: 'live2d_motion'; motion: string; priority?: number }
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
| memory_key | TEXT | 可选；结构化键（如 `user.nickname`），唯一索引，同 key upsert |
| content | TEXT | 记忆内容 |
| importance | REAL | 0-1 |
| source_session_id | TEXT | 来源会话 |
| created_at | INTEGER | Unix ms（更新时刷新） |

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
- Agent 头像：Live2D 截图或静态头像
- 顶栏：模型名、连接状态、Style / Reasoning 下拉
- 工具调用：折叠卡片展示名称、参数、结果
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
5. Live2D 与导入文档路径不入公开仓库

---

## 10. 目录结构

```
TheShorekeeper/
├── docs/
│   ├── DESIGN.md                 # 架构设计（本文档）
│   ├── DATABASE.md               # 数据库、migration、数据目录
│   ├── MODELS.md                 # 模型与 API / Embedding 配置
│   ├── UI-THEME.md               # 主题预设、壁纸、CSS 变量
│   ├── PLAN.md                   # 里程碑实施计划（M1–M8）
│   └── superpowers/              # 进行中的专项计划（语音 / RAG 等）
│       ├── README.md
│       └── plans/
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
│   │   ├── doc/                  # 文档生成、Markdown 转换
│   │   ├── memory/               # recall / knowledge 工具
│   │   ├── life/                 # 记账、旅行规划等
│   │   └── schedule/             # 定时任务工具
│   ├── memory/                   # 长期记忆、Worldbook、摘要、提取、session-context
│   ├── rag/                      # 导入、分块、FTS+向量混合检索、缓存
│   ├── voice/                    # 百炼 CosyVoice TTS、朗读文本清洗
│   ├── mcp/client.ts
│   ├── skills/                   # 技能加载（运行时读 skills/）
│   ├── scheduler/                # reminder 意图解析与执行
│   ├── session/                  # 活跃会话 id
│   ├── workspace/                # 工作区导入、扩展名白名单
│   ├── shared/                   # types, theme-styles, appearance-asset-url
│   └── db/                       # sql.js、migrations（0000–0011）、repositories、seeds
├── src/renderer/                 # React（main.tsx + ?panel= 路由）
│   ├── ChatPage.tsx
│   ├── components/               # MessageList, AgentWorkflowStrip, MessageSpeechButton, PermissionDialog, …
│   ├── hooks/                    # useAgentEvents, useVoicePlayback, agent-workflow
│   ├── settings/                 # SettingsDrawer + 各设置子页（含 VoicePage、AboutPage）
│   ├── theme/                    # ThemeProvider, apply-theme, useTheme
│   ├── dock/ | status/ | schedule/ | reminder/
│   └── styles/globals.css        # --sk-* CSS 变量与 keeper-* 工具类
├── skills/                       # 技能包：example, excel, doc-to-markdown, workspace-doc-edit
├── scripts/                      # db:init / seed / cleanup / reset-keep-models
├── public/                       # keeper-bg.png、默认头像等静态资源
├── .env.example
├── vite.config.ts
└── package.json                  # electron-builder files 白名单
```

### IPC 模块（`electron/ipc/`）

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
| `extraResources`: sql.js WASM、migration `.sql` | `node_modules/` 全量 |

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
| **Voice V1** | TTS 按需/自动朗读 | 🔄 百炼 CosyVoice、语音设置页、🔊 按钮（见 voice 计划） |
| **M8** | 桌宠 | ⏳ Live2D 或精灵图窗，动作与对话联动 |

每个里程碑结束时应可独立运行、可测试。

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| OpenAI / Anthropic 工具格式差异 | 工具循环失败 | 适配层统一 ToolCall 结构 |
| better-sqlite3 与 Electron 版本 | 安装失败 | 已改用 sql.js（WASM），免 native 编译 |
| 上下文超长 | 成本高、超限 | 摘要压缩 + RAG 检索代替全量历史 |
| Live2D 模型版权 | 法律风险 | 自用官方示例/授权模型，gitignore |
| MCP Server 不稳定 | 工具超时 | 超时、重试、禁用开关 |
| 百炼 TTS endpoint 与 Chat 不同 | 语音不可用 | 设置 → 语音独立 endpoint；或 `VOICE_TTS_ENDPOINT` |
| 包体过大 | 下载/更新慢 | electron-updater 增量更新；Live2D 模型可选下载 |

---

## 13. 附录

### 13.1 术语表

| 术语 | 说明 |
|------|------|
| AG-UI | Agent 运行过程的标准化 UI 事件流 |
| Worldbook | 关键词触发的世界观/设定注入知识库 |
| RAG | 检索增强生成，从导入文档检索相关内容 |
| MCP | Model Context Protocol，外部工具服务协议 |
| Skill | 可插拔的技能包，扩展 Agent 行为 |

### 13.2 参考资源

- [Live2D Cubism SDK](https://www.live2d.com/sdk/download/native/)
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)

### 13.3 文档修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0-draft | 2026-06-29 | 初稿，基于需求讨论整理 |
| 0.1.1 | 2026-06-29 | M4 多窗/Dock/托盘模型；M5 更正为 RAG（非 Live2D）；向量实现为 BLOB+余弦 |
| 0.2.0 | 2026-07-01 | 反映 M1–M7 实现：混合 RAG、好感度、博查搜索、插件系统、目录与表结构更新 |
| 0.2.1 | 2026-07-01 | 目录结构扩充：IPC/主题/打包白名单；人设外观主题落地；文档与 superpowers 索引整理 |
| 0.3.0 | 2026-07-02 | 语音 V1（百炼 TTS）、自动更新、Agent 工作流条；表结构补全（session_summaries、bookkeeping）；目录与 IPC 同步 |

---

*本文档描述 The Shorekeeper 的目标架构与模块边界。实现时以本文档为准，重大变更需更新版本号与修订记录。*
