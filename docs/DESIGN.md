# The Shorekeeper 设计文档

> 版本：0.1.0-draft  
> 更新日期：2026-06-29  
> 状态：设计阶段（仓库尚未实现代码）

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
  → Live2D 角色显示在桌面（透明置顶窗）
  → 点击角色 / 托盘图标打开聊天窗
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
| 状态陪伴 | 在线状态、心情、喂食等轻量互动 |
| 资源监控 | Token 用量统计、周趋势、定时任务 |

---

## 3. 系统架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      表现层 (Renderer)                       │
│  Live2D 窗 │ 聊天窗 │ 状态面板 │ 日程/Token │ 设置/侧边栏    │
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
| `live2d` | 透明、无边框、可置顶 | PixiJS 渲染 Live2D，接收动作指令 |
| `chat` | 无边框、圆角 | 消息列表、输入、流式输出、工具卡片 |
| `status` | 浮动面板 | 头像、在线、心情、活动、快捷操作 |
| `schedule` | 浮动面板 | 日程、Token 统计、定时任务入口 |
| `settings` | 标准/无边框窗口 | 模型、API、MCP、技能、权限、人设 |

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
| 数据库 | SQLite (`better-sqlite3`) | 嵌入式主库 |
| ORM | Drizzle ORM | Schema 与迁移 |
| 全文检索 | SQLite FTS5 | Worldbook 关键词 |
| 向量检索 | sqlite-vec（M5 阶段） | RAG、语义记忆 |
| 定时任务 | node-cron | 本地调度 |
| TTS | edge-tts 或等价方案 | 文本转语音 |
| MCP | @modelcontextprotocol/sdk | 外部工具扩展 |

### 4.2 数据库选型结论

**主库：SQLite + Drizzle**

理由：Electron 主进程友好、单文件备份、覆盖结构化存储与中等规模检索、无守护进程。

分阶段扩展：

- M1：基础表（sessions, messages）
- M3：记忆表 + FTS5（worldbook）
- M5：sqlite-vec（document_chunks 向量）
- 未来若文档量极大（>5 万 chunk）：评估 SQLite + LanceDB 双库

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

**上下文组装顺序**：

1. 基础 System Prompt（人设）
2. 用户画像摘要（`user_profile`）
3. 长期记忆检索结果（向量 + 重要性）
4. RAG 检索片段（若启用）
5. Worldbook 命中条目（FTS5 关键词 + 可选向量）
6. 当前激活技能说明
7. 可用工具列表（内置 + MCP + 技能限制后）

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
- 每次 tool_call 记录到 `tool_invocations` 表（可选，用于调试）
- 用户可在设置中中断进行中的 run

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

**内置工具（分期）**：

| 阶段 | 工具 |
|------|------|
| M2 | `read_file`, `list_dir`, `web_search` |
| M3 | `recall_memory`, `search_worldbook` |
| M6 | `write_file`, `fetch_url`, `get_weather`, `translate` |
| M7 | `gen_markdown`, `gen_docx`, `gen_xlsx`, `gen_pdf`, `bookkeeping`, `travel_plan` |

MCP 工具在运行时动态合并，与内置工具同名时 MCP 优先或加前缀（`mcp__server__tool`）。

### 5.4 记忆系统

三层记忆模型：

| 层级 | 存储 | 生命周期 | 注入方式 |
|------|------|----------|----------|
| 工作记忆 | `messages` 表 | 当前会话 | 直接作为 messages |
| 长期记忆 | `long_term_memory` 表 | 持久 | 检索 top-K 注入 system |
| 检索记忆 | RAG chunks + Worldbook | 持久 | 检索后注入 system |

**长期记忆写入时机**：

- 每次 `run_finished` 后，异步任务调用 LLM 提取值得记住的事实
- 或通过工具 `save_memory` 显式写入

**压缩策略**：

- 会话 messages 超过 token 阈值时，对早期消息做摘要，摘要写入 `session_summaries`

### 5.5 RAG 子系统

**导入流程**：

```
用户选择文件 (PDF/MD/TXT/DOCX)
  → 解析文本
  → 分块 (chunk_size=512, overlap=64)
  → 调用 embedding API
  → 写入 document_chunks + 向量索引
```

**检索流程**：

```
用户 query
  → embedding
  → 向量 top-K + 可选 FTS 混合
  → 去重、按 document 分组
  → 格式化为 context 片段注入 prompt
```

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
  enabled: boolean;
}
```

技能包目录：`skills/<skill-id>/SKILL.md` + 可选脚本。

编排器在 system prompt 末尾追加已启用技能的 fragment；若 `allowedTools` 存在，则过滤工具列表。

### 5.8 MCP 集成

- 主进程作为 MCP Client
- 配置存储在 `mcp_servers` 表：command、args、env、enabled
- 启动时连接已启用 Server，发现工具并注册
- 设置页支持添加/测试/禁用 Server

### 5.9 TTS

- 主进程调用 TTS 引擎，生成音频 buffer
- 通过 `tts_chunk` 事件推送渲染进程播放
- 联动 Live2D：`speak_start` / `speak_end` 控制口型参数（若模型支持）

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

### 5.11 Live2D 子系统

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

---

## 6. AG-UI 事件协议

主进程与渲染进程之间的实时通信协议。

### 6.1 事件类型

```typescript
type AgUiEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'run_finished'; runId: string }
  | { type: 'run_error'; runId: string; message: string }
  | { type: 'text_delta'; runId: string; delta: string }
  | { type: 'reasoning_delta'; runId: string; delta: string }
  | { type: 'tool_call_start'; runId: string; callId: string; name: string; args: unknown }
  | { type: 'tool_call_end'; runId: string; callId: string; result: ToolResult }
  | { type: 'state_update'; state: AgentPresenceState }
  | { type: 'live2d_motion'; motion: string; priority?: number }
  | { type: 'tts_chunk'; runId: string; audio: ArrayBuffer }
  | { type: 'usage'; promptTokens: number; completionTokens: number };
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
| content | TEXT | 记忆内容 |
| importance | REAL | 0-1 |
| source_session_id | TEXT | 来源会话 |
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

#### document_chunks

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| document_id | TEXT FK | |
| chunk_index | INTEGER | |
| content | TEXT | 块文本 |
| -- | vec | sqlite-vec 向量列（M5） |

#### token_usage

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT | 可选 |
| model | TEXT | |
| prompt_tokens | INTEGER | |
| completion_tokens | INTEGER | |
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
documents 1───N document_chunks
sessions 1───N token_usage (optional)
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

- 左右气泡：Agent 左，用户右
- Agent 头像：Live2D 截图或静态头像
- 顶栏：模型名、连接状态、Style / Reasoning 下拉
- 工具调用：折叠卡片展示名称、参数、结果
- 推理过程：可折叠灰色区域

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

---

## 9. 配置与安全

### 9.1 配置项

| 配置 | 存储 | 说明 |
|------|------|------|
| API Keys | `app_settings` 或加密文件 | 不进渲染进程、不进 git |
| 模型列表 | `app_settings` | 端点、模型 ID、协议类型 |
| 人设 Prompt | `app_settings` | 可拆分 name/personality/rules |
| 权限策略 | `app_settings` | filesystem roots 等 |
| 窗口位置 | `app_settings` | 各窗 last bounds |

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
│   └── DESIGN.md                 # 本文档
├── electron/
│   ├── main.ts                   # 应用入口
│   ├── preload.ts                # IPC 桥
│   ├── tray.ts                   # 系统托盘
│   ├── windows/
│   │   ├── manager.ts            # 窗口创建与生命周期
│   │   ├── live2d.ts
│   │   ├── chat.ts
│   │   └── ...
│   └── ipc/
│       ├── agent.ts
│       ├── settings.ts
│       └── history.ts
├── src/
│   ├── agent/
│   │   ├── orchestrator.ts
│   │   ├── loop.ts
│   │   ├── context-builder.ts
│   │   └── types.ts              # AgUiEvent, AgentRunRequest
│   ├── models/
│   │   ├── base.ts
│   │   ├── openai-compatible.ts
│   │   └── anthropic-like.ts
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── file/
│   │   ├── web/
│   │   └── memory/
│   ├── mcp/
│   │   └── client.ts
│   ├── memory/
│   │   ├── long-term.ts
│   │   ├── user-profile.ts
│   │   └── summarizer.ts
│   ├── rag/
│   │   ├── importer.ts
│   │   ├── chunker.ts
│   │   └── retriever.ts
│   ├── skills/
│   │   └── loader.ts
│   ├── tts/
│   │   └── engine.ts
│   ├── scheduler/
│   │   └── cron.ts
│   └── db/
│       ├── index.ts
│       ├── schema.ts             # Drizzle schema
│       └── migrations/
├── src/renderer/
│   ├── live2d/
│   │   ├── main.tsx
│   │   └── Live2DStage.tsx
│   ├── chat/
│   ├── status/
│   ├── schedule/
│   ├── settings/
│   ├── components/
│   └── hooks/
│       └── useAgentEvents.ts
├── skills/                       # 用户技能包
├── assets/
│   └── live2d/                   # gitignore
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
└── drizzle.config.ts
```

---

## 11. 开发里程碑

| 里程碑 | 目标 | 交付物 |
|--------|------|--------|
| **M1** | 基础脚手架 | Electron+Vite+React，单窗聊天，流式 LLM，SQLite sessions/messages |
| **M2** | Agent 核心 | Tool loop，AG-UI 事件，3 个内置工具，权限骨架 |
| **M3** | 记忆 | 长期记忆，Worldbook+FTS5，上下文组装 |
| **M4** | 多窗 UI | 状态面板、Token 统计、定时任务表 |
| **M5** | Live2D | 透明窗桌宠，动作联动，RAG+sqlite-vec |
| **M6** | 扩展 | MCP，技能系统，TTS |
| **M7** | 工具补齐 | 文档生成、记账、旅行规划等 |

每个里程碑结束时应可独立运行、可测试。

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| OpenAI / Anthropic 工具格式差异 | 工具循环失败 | 适配层统一 ToolCall 结构 |
| better-sqlite3 与 Electron 版本 | 安装失败 | electron-rebuild，锁定版本 |
| 上下文超长 | 成本高、超限 | 摘要压缩 + RAG 检索代替全量历史 |
| Live2D 模型版权 | 法律风险 | 自用官方示例/授权模型，gitignore |
| MCP Server 不稳定 | 工具超时 | 超时、重试、禁用开关 |
| 包体过大 | 下载/更新慢 | 模型可选下载，单角色起步 |

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

---

*本文档描述 The Shorekeeper 的目标架构与模块边界。实现时以本文档为准，重大变更需更新版本号与修订记录。*
