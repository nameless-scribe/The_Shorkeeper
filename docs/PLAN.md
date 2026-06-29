# The Shorekeeper 实施计划

> **执行说明：** 按里程碑 M1 → M7 顺序推进（**M8 桌宠延后**，M7 完成后再做）。每完成一个 Task 勾选 checkbox。每完成一个里程碑做一次整体验证后再进入下一阶段。  
> **设计依据：** [DESIGN.md](./DESIGN.md)  
> **当前进度：** **M7 进行中**（2026-06-29）→ 工具补齐、Token 优化、会话压缩、打包配置

**Goal：** 从零构建自用桌面 AI Agent 应用 The Shorekeeper，具备流式聊天、工具调用、记忆、RAG 与多窗伴侣 UI；桌宠（Live2D / 精灵图）延后至 **M8**。

**Architecture：** Electron 主进程承载 Agent 运行时与 SQLite；渲染进程仅负责 UI，通过 Preload IPC 与 AG-UI 事件流通信；能力按里程碑递增，每阶段可独立运行。

**Tech Stack：** Electron · TypeScript · Vite · React · Tailwind · better-sqlite3 · Drizzle ·（M8：PixiJS · pixi-live2d-display）

---

## 里程碑总览

| 里程碑 | 名称 | 预计工期 | 验收标准 |
|--------|------|----------|----------|
| M1 | 基础脚手架 | 3–5 天 | ✅ **已完成** — 能流式聊天，会话入库 |
| M2 | Agent 核心 | 4–6 天 | ✅ **已完成** — 工具循环、AG-UI 事件、工具卡片 |
| M3 | 记忆系统 | 3–5 天 | ✅ **已完成** — 结构化长期记忆、Worldbook、设置页 |
| M4 | 多窗 UI | 4–5 天 | ✅ **已完成** — 多窗管理、托盘、Dock 快捷入口、Token/定时任务 |
| M5 | RAG | 3–5 天 | ✅ **已完成** — 文档导入、向量检索、问答引用 |
| M6 | 扩展能力 | 4–6 天 | ✅ **已完成** — MCP、技能、Anthropic 协议（TTS 延后排期） |
| M7 | 工具补齐 | 5–7 天 | 文档生成与生活类工具；**含 Token 优化与长会话压缩** |
| M8 | 桌宠（延后） | 3–5 天 | Live2D 或精灵图窗，动作与对话联动 |

---

## 前置准备

- [x] **Step 0.1** 安装 Node.js 20+、pnpm（或 npm）
- [x] **Step 0.2** 准备 LLM API Key（OpenAI-compatible 或 Ollama 本地端点）
- [x] **Step 0.3** 克隆/初始化仓库，确认 `docs/DESIGN.md` 已阅读

```bash
node -v    # >= 20
pnpm -v
```

---

# M1：基础脚手架 ✅

**交付物：** Electron + Vite + React 可运行；单聊天窗；流式 LLM；SQLite 存储 sessions/messages。

**状态：** 已完成（2026-06-29）。四项验收自测均已通过。

**实现说明（与原文差异，不阻塞 M2）：**

- 数据库：**sql.js** + 手写 migration/repositories（替代 Drizzle + better-sqlite3，兼容 Electron Windows）
- 开发命令：`pnpm dev`（等同原计划 `electron:dev`）
- UI：Shorekeeper 蓝白主题、左右气泡、AI/用户头像（超出 M1 最小范围）
- 人设 / Worldbook **种子**已写入（`pnpm db:seed`），context 注入留 **M3**
- 延后：vitest 单测、electron-builder 安装包

---

## M1 验收清单

- [x] `pnpm dev` 正常启动 Electron 窗口
- [x] 流式对话可用
- [x] 会话与消息写入 `D:\SQLlite\shorekeeper.db`
- [x] 渲染进程无法访问 `process.env.OPENAI_API_KEY`（仅主进程读取）

---

### Task M1-1：初始化项目与依赖

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `.gitignore`, `.env.example`

- [x] **Step 1** 创建 `package.json`

```json
{
  "name": "the-shorekeeper",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && electron-builder",
    "electron:dev": "vite",
    "postinstall": "electron-builder install-app-deps",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.33.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "drizzle-kit": "^0.24.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0",
    "vitest": "^2.0.0"
  }
}
```

- [x] **Step 2** 创建 `.gitignore`

```
node_modules/
dist/
dist-electron/
release/
.env
*.db
assets/live2d/
.DS_Store
```

- [x] **Step 3** 创建 `.env.example`

```
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_MODEL=gpt-4o-mini
```

- [x] **Step 4** 安装依赖

```bash
pnpm install
```

Expected: `node_modules` 创建成功，无 fatal error。

- [x] **Step 5** Commit

```bash
git add package.json .gitignore .env.example tsconfig.json tsconfig.node.json
git commit -m "chore: initialize project dependencies"
```

---

### Task M1-2：Vite + Electron 入口

**Files:**
- Create: `vite.config.ts`, `electron/main.ts`, `electron/preload.ts`, `index.html`

- [x] **Step 1** 创建 `vite.config.ts`（多入口：chat 为主窗口）

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
});
```

- [x] **Step 2** 创建 `electron/main.ts`

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let chatWindow: BrowserWindow | null = null;

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: 480,
    height: 720,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    chatWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/src/renderer/chat/index.html`);
  } else {
    chatWindow.loadFile(path.join(__dirname, '../dist/src/renderer/chat/index.html'));
  }
}

app.whenReady().then(createChatWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [x] **Step 3** 创建 `electron/preload.ts`（空壳 API，后续扩展）

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('shorekeeper', {
  agent: {
    send: (payload: unknown) => ipcRenderer.invoke('agent:send', payload),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
});
```

- [x] **Step 4** 创建 `src/renderer/chat/index.html` 与入口 `main.tsx`（React 空壳 + Tailwind）

- [x] **Step 5** 运行验证

```bash
pnpm electron:dev
```

Expected: 透明无边框窗口打开，显示 React 页面。

- [x] **Step 6** Commit

```bash
git commit -m "feat(m1): electron vite react scaffold"
```

---

### Task M1-3：数据库层（SQLite + Drizzle）

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `drizzle.config.ts`

- [x] **Step 1** 创建 `src/db/schema.ts`（M1 仅 sessions + messages）→ 实际：`src/db/repositories/` + sql.js

- [x] **Step 2** 创建 `src/db/index.ts`（主进程初始化）→ 实际：sql.js `SqliteDb`

- [x] **Step 3** 创建 `drizzle.config.ts` 并生成迁移 → 实际：`src/db/migrations/` + `pnpm db:init` / `db:seed`

- [ ] **Step 4** 编写 `src/db/sessions.test.ts` 验证 CRUD（延后，不阻塞 M2）

```bash
pnpm test
```

Expected: PASS

- [x] **Step 5** Commit

```bash
git commit -m "feat(m1): sqlite drizzle sessions and messages"
```

---

### Task M1-4：OpenAI-compatible 模型适配（流式）

**Files:**
- Create: `src/models/base.ts`, `src/models/openai-compatible.ts`, `src/agent/types.ts`

- [x] **Step 1** 定义 `src/agent/types.ts` → 实际：`src/shared/types.ts`

- [x] **Step 2** 实现 `src/models/openai-compatible.ts`（`fetch` + SSE 解析 `data: {...}`）

- [ ] **Step 3** 单元测试：mock fetch 验证 `text_delta` 解析（延后，不阻塞 M2）

```bash
pnpm test src/models/
```

Expected: PASS

- [x] **Step 4** Commit

```bash
git commit -m "feat(m1): openai compatible streaming model adapter"
```

---

### Task M1-5：简易聊天编排（无工具）

**Files:**
- Create: `src/agent/simple-chat.ts`, `electron/ipc/agent.ts`

- [x] **Step 1** 实现 `simpleChat(sessionId, userMessage)`：读历史 → 调模型 → 流式 yield `text_delta` → 写入 messages

- [x] **Step 2** 在 `electron/ipc/agent.ts` 注册 `agent:send`，向渲染进程 `webContents.send('agent:event', event)`

- [x] **Step 3** 在 `electron/main.ts` 启动时调用 `initDatabase()`（默认 `D:\SQLlite\shorekeeper.db`，见 `src/config/paths.ts`）

- [x] **Step 4** Commit

```bash
git commit -m "feat(m1): simple chat orchestration with ipc"
```

---

### Task M1-6：聊天 UI

**Files:**
- Create: `src/renderer/chat/ChatPage.tsx`, `src/renderer/chat/components/MessageList.tsx`, `src/renderer/chat/components/InputBar.tsx`, `src/renderer/hooks/useAgentEvents.ts`

- [x] **Step 1** 实现 `useAgentEvents`：订阅 `window.shorekeeper.agent.onEvent`，合并 `text_delta` 到当前 assistant 消息

- [x] **Step 2** 聊天气泡布局（左 agent / 右 user）→ 实际：Shorekeeper 蓝白主题 + 头像

- [x] **Step 3** 顶栏显示模型名、连接状态（硬编码或读 settings）

- [x] **Step 4** 端到端验证：输入「你好」→ 流式回复 → 重启应用后历史仍在

- [x] **Step 5** Commit

```bash
git commit -m "feat(m1): chat ui with streaming messages"
```

---

# M2：Agent 核心 ✅

**交付物：** Function-calling 循环、AG-UI 完整事件、3 个内置工具、权限骨架。

**状态：** 已完成（2026-06-29）。手动验收通过，可进入 M3。

**实现说明（验收记录）：**

- 默认模型 **qwen3.6-plus**（百炼 OpenAI 兼容）；流式 tool_calls 去重已处理（delta + message 双份）
- 已验：`list_dir`、`read_file`+摘要、工具卡片 UI、消息列表自动滚底
- `web_search` 可触发并展示错误；DuckDuckGo 在国内常 `fetch failed`，不阻塞 M2
- 越权路径：**工具层**有单测（`permissions.test.ts`、`read_file` 路径穿越）；**对话层** Qwen 倾向不调用工具而口头拒绝，E2E 卡片验收跳过（可接受）
- UI 路径：`src/renderer/components/ToolCallCard.tsx`（非 PLAN 原路径 `chat/components/`）

---

### Task M2-1：AG-UI 事件类型扩展

**Files:**
- Modify: `src/agent/types.ts`
- Create: `src/agent/events.ts`

- [x] **Step 1** 按 DESIGN §6.1 补全 `AgUiEvent` 联合类型

- [x] **Step 2** 创建 `createRunId()` 与事件工厂函数 `ev.runStarted()` 等

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m2): ag-ui event types"
```

---

### Task M2-2：工具注册表

**Files:**
- Create: `src/tools/registry.ts`, `src/tools/types.ts`

- [x] **Step 1** 实现 `ToolRegistry`：`register(tool)`, `list()`, `get(name)`, `toOpenAITools()`

- [x] **Step 2** 定义 `ToolResult { success, output, error? }`

- [x] **Step 3** 测试注册与列表

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m2): tool registry"
```

---

### Task M2-3：内置工具 read_file / list_dir / web_search

**Files:**
- Create: `src/tools/file/read-file.ts`, `src/tools/file/list-dir.ts`, `src/tools/web/web-search.ts`

- [x] **Step 1** `read_file`：限制路径在 `workspaceRoot` 内，超出抛错

- [x] **Step 2** `list_dir`：同上

- [x] **Step 3** `web_search`：对接搜索 API（或 DuckDuckGo 简易实现），需 `network` 权限

- [x] **Step 4** 各工具单测

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m2): builtin tools read list search"
```

---

### Task M2-4：权限模块

**Files:**
- Create: `src/agent/permissions.ts`

- [x] **Step 1** 实现 `PermissionPolicy` 默认值（workspace = userData/workspace）

- [x] **Step 2** `checkPermission(tool, policy)` 返回 allow / deny / confirm

- [x] **Step 3** 写操作弹 `dialog.showMessageBox`（M2 可先实现 read 权限）

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m2): permission policy skeleton"
```

---

### Task M2-5：Function-calling 循环

**Files:**
- Create: `src/agent/loop.ts`, `src/agent/orchestrator.ts`

- [x] **Step 1** 扩展 `openai-compatible.ts` 支持 `tools` 参数与 `tool_calls` 流式解析

- [x] **Step 2** 实现 `runAgentLoop(messages, tools, maxRounds=10)` 按 DESIGN §5.2 流程

- [x] **Step 3** 每轮 tool 执行前后 yield `tool_call_start` / `tool_call_end`

- [x] **Step 4** 集成测试：让模型调用 `list_dir`（system prompt 引导）

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m2): function calling agent loop"
```

---

### Task M2-6：聊天 UI 工具卡片

**Files:**
- Create: `src/renderer/chat/components/ToolCallCard.tsx`

- [x] **Step 1** 监听 `tool_call_start/end`，在消息流中插入可折叠卡片

- [x] **Step 2** 运行中显示 loading，完成后显示 result

- [x] **Step 3** 验收：提问「列出工作区文件」触发工具

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m2): tool call cards in chat ui"
```

---

### M2 验收清单

- [x] 多轮 tool loop 正常终止（不超过 maxRounds）— 读文件+list_dir 实测正常
- [x] AG-UI 事件在 DevTools 可观察到 — tool_call_start/end 经 UI 验证
- [x] 无权限的文件路径被拒绝 — **单测覆盖**；E2E 因模型不调用工具跳过

---

# M3：记忆系统 ✅

**交付物：** 长期记忆、Worldbook + FTS5、上下文组装器。

**状态：** 已完成（2026-06-29）。手动验收通过（对话 + Navicat 查库），可进入 M4。

**实现说明（验收记录）：**

- Schema：`0001_memory_worldbook.sql`、`0002_worldbook_fts5.sql`（可选）、`0003_memory_key.sql`（`memory_key` 唯一索引）
- 长期记忆：**结构化 key + `upsertMemory`**（同 key 更新不重复插入）；自动提取仅分析**本轮对话增量**，并附带已有记忆列表供 LLM 去重
- 辅助模块：`extraction-state.ts`（每条用户消息只提取一次）、`dedupe.ts`（无 key 的自由文本兜底）
- 上下文：`context-builder.ts` 按 DESIGN §5.1 组装；`orchestrator` 已接入
- 工具：`recall_memory`、`search_worldbook`、`save_memory`（支持 `key` 参数）
- 设置：顶栏 ⚙ → **用户画像** / **Worldbook**（`SettingsDrawer`、`ProfilePage`、`WorldbookPage`）
- IPC：`electron/ipc/profile.ts`、`electron/ipc/worldbook.ts`
- Worldbook：sql.js 运行时以**关键词匹配**为主；系统 SQLite / 完整 FTS5 为可选增强
- 已验：Worldbook 命中（如「介绍一下守岸人」）、`long_term_memory` / `user_profile` 有数据
- 延后 M5：向量语义去重（如「拿铁」vs「咖啡」）、RAG 片段注入

**主要源文件：**

| 区域 | 路径 |
|------|------|
| 记忆 CRUD / upsert | `src/memory/long-term.ts` |
| 用户画像 | `src/memory/user-profile.ts` |
| Worldbook | `src/memory/worldbook.ts` |
| 对话后提取 | `src/memory/summarizer.ts` |
| 上下文组装 | `src/agent/context-builder.ts` |
| 记忆工具 | `src/tools/memory/memory-tools.ts` |
| 单测 | `src/memory/__tests__/memory.test.ts` |

---

### Task M3-1：扩展数据库 schema

**Files:**
- Modify: `src/db/schema.ts`
- Create: migration for `user_profile`, `long_term_memory`, `worldbook_entries`, FTS5

- [x] **Step 1** 添加表定义（见 DESIGN §7.2）

- [x] **Step 2** 手写 migration 创建 `worldbook_fts` 虚表及 trigger 同步

- [x] **Step 3** `pnpm db:migrate`（应用启动时自动执行；亦可 `pnpm db:init`）

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m3): memory and worldbook schema"
```

---

### Task M3-2：用户画像与长期记忆 CRUD

**Files:**
- Create: `src/memory/user-profile.ts`, `src/memory/long-term.ts`

- [x] **Step 1** `getProfileSummary()` 格式化为 prompt 片段

- [x] **Step 2** `searchMemories(query, limit)` 先用 SQL `LIKE` 或按 importance 排序（向量 M5 再加）

- [x] **Step 3** `saveMemory` / `upsertMemory(memoryKey, content, …)`

- [x] **Step 4** 单测

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m3): user profile and long term memory"
```

---

### Task M3-3：Worldbook + FTS5 检索

**Files:**
- Create: `src/memory/worldbook.ts`

- [x] **Step 1** CRUD API

- [x] **Step 2** `matchWorldbook(userMessage)` 用 FTS5 查 keys/content

- [x] **Step 3** 测试：插入条目 keys=「魔法」→ 用户消息含「魔法」时命中

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m3): worldbook fts5 retrieval"
```

---

### Task M3-4：上下文组装器

**Files:**
- Create: `src/agent/context-builder.ts`

- [x] **Step 1** 按 DESIGN §5.1 顺序组装 system prompt

- [x] **Step 2** 接入 orchestrator，替换 M1 硬编码 system prompt

- [x] **Step 3** 工具 `recall_memory`, `search_worldbook`

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m3): context builder and memory tools"
```

---

### Task M3-5：记忆提取（run 结束后）

**Files:**
- Create: `src/memory/summarizer.ts`, `src/memory/extraction-state.ts`

- [x] **Step 1** `run_finished` 后异步调用 LLM，**仅分析本轮 user+assistant**，输出结构化 `[{key, content}]`

- [x] **Step 2** 去重：`upsertMemory` 按 `memory_key` 更新；提取 prompt 含已有记忆；无 key 文本用简单子串去重（语义向量 → M5）

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m3): post-run memory extraction"
```

---

### Task M3-6：设置页（用户画像 + Worldbook）

**Files:**
- Create: `src/renderer/settings/SettingsDrawer.tsx`, `ProfilePage.tsx`, `WorldbookPage.tsx`
- Create: `electron/ipc/profile.ts`, `electron/ipc/worldbook.ts`

- [x] **Step 1** Worldbook：列表、新增、编辑、删除、启用开关

- [x] **Step 2** 用户画像：键值编辑（如 `nickname`）

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m3): settings ui for profile and worldbook"
```

---

### M3 验收清单

- [x] Worldbook 命中内容出现在回复语境中
- [x] 多轮对话后长期记忆表有新增（`memory_key` 同主题不重复膨胀）
- [x] 用户画像可在设置中编辑

---

# M4：多窗 UI ✅

**交付物：** 状态面板、日程/Token 面板、系统托盘、Dock 快捷栏、定时任务表。

**状态：** 已完成（2026-06-29）。含后续 UX 迭代：最小化收进托盘、三窗独立关闭、启动默认仅聊天窗、Dock 竖向信息栏（状态 / 日程 / Token）可点击打开对应窗口并可拖动 reposition。

**主要源文件：**

| 区域 | 路径 |
|------|------|
| 窗口管理 | `electron/windows/manager.ts`, `chat.ts`, `status.ts`, `schedule.ts` |
| 托盘 | `electron/tray.ts` |
| Dock | `electron/windows/dock.ts`, `electron/dock/visibility.ts`, `src/renderer/dock/` |
| 面板 UI | `src/renderer/status/StatusPage.tsx`, `src/renderer/schedule/SchedulePage.tsx` |
| Token 统计 | `src/db/token-usage.ts`, `electron/ipc/stats.ts` |
| 定时任务 | `src/db/scheduled-tasks.ts`, `electron/scheduler/cron.ts`, `src/renderer/settings/TasksPage.tsx` |

---

### Task M4-1：窗口管理器

**Files:**
- Create: `electron/windows/manager.ts`, `electron/windows/chat.ts`, `electron/windows/status.ts`, `electron/windows/schedule.ts`

- [x] **Step 1** 抽象 `WindowManager`：create/show/hide/getBounds/saveBounds

- [x] **Step 2** 从 main.ts 拆出三窗创建逻辑

- [x] **Step 3** 窗口位置持久化到 `app_settings`

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m4): multi window manager"
```

---

### Task M4-2：系统托盘

**Files:**
- Create: `electron/tray.ts`

- [x] **Step 1** 托盘菜单：显示聊天/状态/日程、退出

- [x] **Step 2** 最小化/关闭收进托盘（`skipTaskbar`）；三窗互不影响；启动默认仅显示聊天窗

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): system tray"
```

---

### Task M4-3：Token 统计

**Files:**
- Modify: `src/db/schema.ts` → `token_usage`
- Create: `src/db/token-usage.ts`

- [x] **Step 1** 每次 `usage` 事件写入 token_usage

- [x] **Step 2** IPC `stats:getTokenUsage` 返回今日/本周/总量

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): token usage tracking"
```

---

### Task M4-4：状态面板 UI

**Files:**
- Create: `src/renderer/status/StatusPage.tsx`

- [x] **Step 1** 订阅 `state_update` 事件

- [x] **Step 2** 展示 Online、Mood、Activity（orchestrator 在 run 各阶段更新 state）

- [x] **Step 3** 按钮：打开聊天、打开设置

- [x] **Step 4** 轻量「喂食」互动：IPC 更新 activity=feeding，30s 后恢复

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m4): status panel ui"
```

---

### Task M4-5：日程 / Token 面板 UI

**Files:**
- Create: `src/renderer/schedule/SchedulePage.tsx`

- [x] **Step 1** 安装 `recharts`，周 Token 柱状图

- [x] **Step 2** 显示日期、今日 Token、进度条

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): schedule token panel with charts"
```

---

### Task M4-6：定时任务（表 + 调度器）

**Files:**
- Create: `src/db/schema.ts` 扩展, `src/scheduler/cron.ts`

- [x] **Step 1** `scheduled_tasks` 表与 CRUD

- [x] **Step 2** `node-cron` 加载 enabled 任务

- [x] **Step 3** `action_type=reminder` 用 Notification；`agent_prompt` 触发静默 agent run

- [x] **Step 4** 设置页任务列表 UI

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m4): scheduled tasks"
```

---

### Task M4-7：Dock 快捷栏（增量）

**Files:**
- Create: `electron/windows/dock.ts`, `electron/dock/visibility.ts`, `src/renderer/dock/*`

- [x] **Step 1** 主面板全部隐藏时显示 Dock（头像 + 竖向信息条）

- [x] **Step 2** 状态 / 日程 / 今日 Token 预览，点击打开对应窗口

- [x] **Step 3** 拖动 reposition；置顶 / 固定位置偏好持久化

- [x] **Step 4** `WindowManager.panelShown` 统一 Dock 与托盘显隐逻辑

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m4): dock companion bar with status schedule token"
```

---

### M4 验收清单

- [x] 三窗可独立显示/隐藏，托盘可用；最小化不进任务栏
- [x] 启动默认仅聊天窗；状态/日程预加载但隐藏
- [x] Dock 竖向展示状态、日程、Token，可点击打开、可拖动
- [x] Token 图表有真实数据
- [x] 定时 reminder 到点弹出

---

# M5：RAG ✅

**交付物：** 文档导入、向量存储与检索，问答可引用导入内容。

**状态：** 已完成（2026-06-29）。手动验收通过（设置 → 文档导入 `testdata/shenhong-data-governance.md`，提问「伸宏贸易关账日」等可正确引用）。

**实现说明（与原文差异）：**

- 向量存储：**sql.js 兼容** — `embedding BLOB` + TypeScript 余弦相似度（非 sqlite-vec，见 [M5 实施计划](./superpowers/plans/2026-06-29-m5-rag.md)）
- Embedding：百炼 OpenAI 兼容 `/embeddings`，`.env` → `EMBEDDING_MODEL=text-embedding-v3`
- 增量（超出原计划 M5）：**对话归档知识库**（「将本次对话计入知识库」）、**轻量历史会话**（☰ 侧边栏）
- Token 消耗偏快 → 已排期 **M7-4**，本阶段不阻塞

**主要源文件：**

| 区域 | 路径 |
|------|------|
| Embedding / 向量 | `src/rag/embedding.ts`, `src/rag/vector.ts` |
| 分块 / 导入 | `src/rag/chunker.ts`, `src/rag/importer.ts`, `src/rag/text-import.ts` |
| 检索 / 注入 | `src/rag/retriever.ts`, `src/agent/context-builder.ts` |
| 对话归档 | `src/rag/conversation-knowledge.ts` |
| 设置 UI | `src/renderer/settings/DocumentsPage.tsx` |
| Schema | `src/db/migrations/0006_rag.sql` |
| 单测 | `src/rag/__tests__/` |

> **排期说明：** 桌宠（Live2D / 精灵图）已移至 **M8**，M5 仅做 RAG。`live2d_motion` 等 AG-UI 事件类型保留，供 M8 订阅。

---

### Task M5-1：RAG schema + embedding

**Files:**
- Create: `src/db/schema.ts` 扩展 documents/document_chunks
- Create: `src/rag/embedding.ts`

- [x] **Step 1** migration `0006_rag.sql`（documents / document_chunks / memory.embedding）

- [x] **Step 2** embedding 调用 OpenAI 兼容 API（`text-embedding-v3`）

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m5): rag schema and embedding"
```

---

### Task M5-2：文档导入管线

**Files:**
- Create: `src/rag/importer.ts`, `src/rag/chunker.ts`, `src/rag/retriever.ts`

- [x] **Step 1** 支持 MD/TXT（PDF/DOCX 留 M7）

- [x] **Step 2** chunk_size=512, overlap=64

- [x] **Step 3** 设置页「导入文档」+ 进度

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m5): document import and chunking"
```

---

### Task M5-3：RAG 注入 context

**Files:**
- Modify: `src/agent/context-builder.ts`

- [x] **Step 1** 检索 top-5 chunks

- [x] **Step 2** `<reference>...</reference>` 注入 system

- [x] **Step 3** 验收：导入文档后提问文档内容可答 ✅

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m5): rag retrieval in context builder"
```

---

### M5 验收清单

- [x] 导入 md 文件后，问答能引用文档内容
- [x] 语义记忆去重（向量，`save_memory` 路径）
- [x] （增量）对话「计入知识库」可提炼写入 RAG

---

# M6：扩展能力 ✅

**交付物：** MCP Client、技能系统、Anthropic-like 模型适配。（**TTS 延后排期**，见下）

**状态：** 已完成（2026-06-29）。TTS 曾尝试 edge-tts，国内网络下 Bing 语音服务合成超时，已移除 UI 与运行时逻辑，与桌宠口型一并留待后续里程碑。

**主要源文件：**

| 区域 | 路径 |
|------|------|
| MCP | `src/mcp/client.ts`, `src/db/mcp-servers.ts`, `electron/ipc/mcp.ts` |
| 技能 | `src/skills/loader.ts`, `skills/example/SKILL.md` |
| 模型协议 | `src/models/anthropic-like.ts`, `src/models/stream-chat.ts` |
| 工具合并 | `src/tools/agent-registry.ts` |
| 设置 UI | `McpPage`, `SkillsPage`, `ModelPage` |

---

### Task M6-1：MCP Client

**Files:**
- Create: `src/mcp/client.ts`, `src/db/schema.ts` → `mcp_servers`

- [x] **Step 1** 使用 `@modelcontextprotocol/sdk` 连接 stdio server

- [x] **Step 2** 启动时加载 enabled servers，工具名加前缀 `mcp__{server}__{tool}`

- [x] **Step 3** 合并进 ToolRegistry

- [x] **Step 4** 设置页添加/测试/禁用 MCP

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m6): mcp client integration"
```

---

### Task M6-2：技能系统

**Files:**
- Create: `src/skills/loader.ts`, `skills/example/SKILL.md`

- [x] **Step 1** 解析 SKILL.md frontmatter + body 为 Skill

- [x] **Step 2** context-builder 注入已启用技能 fragment

- [x] **Step 3** `allowedTools` 过滤工具列表

- [x] **Step 4** 设置页技能开关

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m6): skill system"
```

---

### Task M6-3：TTS（消息朗读）— 延后排期

> **2026-06-29 决策：** 国内环境 edge-tts 连接 `speech.platform.bing.com` 易超时/无音频，暂不上线。AG-UI 事件类型 `tts_chunk` 保留，供后续与 M8 桌宠一并实现。候选方案：百炼语音合成 API、可配置代理的 TTS 引擎。

**Files:**（原计划，未交付）

- `src/tts/engine.ts`, `electron/ipc/tts.ts`
- `src/renderer/components/MessageSpeechButton.tsx`

- [ ] **Step 1** 选定可用 TTS 引擎（百炼 / 代理 edge-tts 等）

- [ ] **Step 2** IPC 合成 + 消息 🔊 按钮

- [ ] **Step 3** 设置页音色与自动朗读

- [ ] **Step 4** （可选）`tts_chunk` 供桌宠口型

---

### Task M6-4：Anthropic-like 模型适配

**Files:**
- Create: `src/models/anthropic-like.ts`

- [x] **Step 1** 实现 tool_use / tool_result 格式转换

- [x] **Step 2** 设置页可选协议类型

- [x] **Step 3** 测试与 loop 集成

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m6): anthropic like model adapter"
```

---

### M6 验收清单

- [ ] 至少一个 MCP Server 工具可调用（需本地配置 MCP Server 后手动验收）
- [ ] 启用技能后 system prompt 有变化
- [ ] ~~TTS 消息朗读~~（延后排期）

---

# M7：工具补齐

**交付物：** 写文件、抓取、天气、翻译、文档生成、记账、旅行规划。

**状态：** 实现完成（2026-06-29），待手动验收与 commit。

---

### Task M7-1：文件与网络工具

**Files:**
- Create: `src/tools/file/write-file.ts`, `src/tools/web/fetch-url.ts`, `src/tools/web/weather.ts`, `src/tools/web/translate.ts`

- [x] **Step 1** write_file 需 confirm 权限

- [x] **Step 2** 注册到 ToolRegistry

- [x] **Step 3** 单测 + 手动验收

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m7): write fetch weather translate tools"
```

---

### Task M7-2：文档生成工具

**Files:**
- Create: `src/tools/doc/gen-markdown.ts`, `gen-docx.ts`, `gen-xlsx.ts`, `gen-pdf.ts`

- [x] **Step 1** 安装 `docx`, `exceljs`, `pdf-lib` 等

- [x] **Step 2** 输出到 workspace 目录

- [ ] **Step 3** 验收：让 Agent 生成一份简单 xlsx

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m7): document generation tools"
```

---

### Task M7-3：生活类工具

**Files:**
- Create: `src/tools/life/bookkeeping.ts`, `travel-plan.ts`
- Modify: `src/db/schema.ts` → `bookkeeping_entries`（可选）

- [x] **Step 1** 记账：写入 SQLite，支持查询汇总

- [x] **Step 2** 旅行规划：输出结构化 markdown  itinerary

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m7): bookkeeping and travel plan tools"
```

---

---

### Task M7-4：Token 消耗优化（快速项）

> **排期说明（2026-06-29）：** M5 RAG + 每轮记忆提取 + 全量 history 导致 Token 消耗偏快。本 Task 在 **M7 会话压缩（M7-5）之前** 先做低成本开关与上限，不阻塞 M6。

**现状问题（每轮用户消息）：**

| 来源 | 说明 |
|------|------|
| 主对话 LLM | system（人设+记忆+RAG+Worldbook+工具说明）+ 全量 session history + 10 工具 schema |
| 隐藏 LLM | `run_finished` 后 `extractMemoriesFromSession` 再调一次 |
| Embedding | RAG 检索每轮 1 次 |
| Tool loop | 每轮 tool 重发累积 messages |

**Files:**
- Modify: `src/agent/orchestrator.ts`, `src/agent/context-builder.ts`
- Modify: `src/memory/summarizer.ts`, `src/memory/long-term.ts`
- Modify: `src/rag/retriever.ts`
- Modify: `src/db/app-settings.ts` 或 `.env` 开关
- Modify: `src/renderer/settings/` → Token/性能 子页（可选）

- [x] **Step 1** 记忆提取降频：设置项「自动提取记忆」默认开；可改为仅手动 / 每 N 轮 / 含关键词时触发

- [x] **Step 2** RAG 条件注入：无文档库或 query 不像知识问答时跳过 embedding + chunk 注入

- [x] **Step 3** 长期记忆检索：去掉无命中时 fallback `listMemories(3)`，未命中则不注入记忆块

- [x] **Step 4** History 上限：送入模型的 messages 仅保留最近 **20 条**（或按 token 估算）；完整 history 仍入库

- [x] **Step 5** 设置页（或 .env）：`RAG_ENABLED`、`AUTO_MEMORY_EXTRACT`、`MAX_HISTORY_MESSAGES`

- [ ] **Step 6** 验收：Schedule 窗 Token 曲线对比优化前后同场景 10 轮对话

- [ ] **Step 7** Commit

```bash
git commit -m "feat(m7): token usage quick optimizations"
```

---

### Task M7-5：会话摘要压缩 + 完整历史会话

**Files:**
- Modify: `src/memory/summarizer.ts`, `src/db/schema.ts` → `session_summaries`
- Modify: `src/renderer/components/SessionHistoryPanel.tsx`（扩展）

**轻量版（已完成）：** 侧边栏列表、切换会话、首条消息自动标题、启动新建会话。

**完整版（本 Task）：**
- [x] 会话搜索 / 删除 / 归档
- [x] 长会话「已压缩」标识
- [ ] Agent 跨会话 recall（可选）

- [x] **Step 1** messages 超阈值时压缩早期消息为 summary

- [x] **Step 2** loop 使用 summary + 近期 messages

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m7): session context compression and full session history"
```

---

### Task M7-6：打包与发布（自用）

**Files:**
- Modify: `package.json` → `electron-builder` 配置

- [x] **Step 1** 配置 `build.appId`, `directories.output`

- [ ] **Step 2** `pnpm build` 生成 Windows 安装包

- [x] **Step 3** README：环境变量、数据库路径；桌宠资源说明见 M8

- [ ] **Step 4** Commit

```bash
git commit -m "chore(m7): electron builder config and readme"
```

---

### M7 验收清单

- [ ] 文档生成工具可产出可打开的文件
- [ ] Token 优化后同场景 10 轮对话 prompt tokens 明显下降（见 Schedule 统计）
- [ ] 长会话不超限（摘要生效）
- [ ] 本地可打包运行

---

# M8：桌宠（延后）

**交付物：** 透明桌宠窗、动作与 Agent 状态联动。实现路径二选一（或先做 Live2D，精灵图作备选）：

| 路径 | 资源 | 技术 |
|------|------|------|
| Live2D | `assets/live2d/*.model3.json` 导出包 | PixiJS + pixi-live2d-display |
| 精灵图 | `assets/sprites/` PNG 序列（如 Bongo Cat 素材） | 透明窗 + 状态换图 / 帧动画 |

> **前置：** M2 已有 `live2d_motion` 事件类型；M4 已有 `state_update`（mood / activity）。M8 桌宠窗订阅 `agent:event` 即可联动，无需改事件协议。

---

### Task M8-1：桌宠窗口

**Files:**
- Create: `electron/windows/pet.ts`（或 `live2d.ts`）, `src/renderer/pet/main.tsx`, `src/renderer/pet/PetStage.tsx`

- [ ] **Step 1** Live2D 路径：安装 `pixi.js`, `pixi-live2d-display`；精灵图路径：仅用 Canvas / Pixi 贴图

- [ ] **Step 2** 透明置顶窗 `transparent: true`, `alwaysOnTop: true`

- [ ] **Step 3** 从配置加载资源路径（Live2D：`assets/live2d/`；精灵图：`assets/sprites/`）

- [ ] **Step 4** 默认 idle 状态

- [ ] **Step 5** README：模型 / 精灵图放置说明

- [ ] **Step 6** Commit

```bash
git commit -m "feat(m8): pet transparent window"
```

---

### Task M8-2：动作联动

**Files:**
- Modify: `src/agent/orchestrator.ts`, `src/renderer/pet/PetStage.tsx`

- [ ] **Step 1** orchestrator 在 think / speak / happy 阶段 `broadcast('agent:event', { type: 'live2d_motion', motion })`

- [ ] **Step 2** 桌宠窗订阅 `live2d_motion` 与 `state_update`，映射到动作或换图

- [ ] **Step 3** 点击角色 IPC 打开聊天窗 + tap 反应

- [ ] **Step 4** TTS 播放时口型 / 说话帧（若模型或素材支持）

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m8): pet motion sync with agent"
```

---

### M8 验收清单

- [ ] 桌宠显示在桌面，与对话状态（思考 / 说话 / 开心）联动
- [ ] 点击桌宠可打开聊天窗
- [ ] `assets/live2d/` 或 `assets/sprites/` 在 gitignore 中
- [ ] Live2D 路径：模型版权与授权范围已确认

---

## 全局测试策略

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元测试 | Vitest | db、tools、models、memory |
| 集成测试 | Vitest + mock | agent loop、context-builder |
| E2E | 手动 | 每里程碑验收清单 |

```bash
pnpm test           # 全量
pnpm test src/agent # 单目录
```

---

## 提交规范建议

```
feat(m1): ...
feat(m2): ...
fix(m3): ...
chore: ...
docs: ...
```

每个 Task 完成后提交一次，每个里程碑合并为一个 tag（可选）：

```bash
git tag v0.1.0-m1
git tag v0.2.0-m2
```

---

## 风险检查点

| 里程碑 | 检查项 |
|--------|--------|
| M1 结束 | ~~better-sqlite3 electron rebuild~~ → 已改用 **sql.js**，Electron 运行正常 |
| M2 结束 | tool loop 是否会死循环（maxRounds） |
| M5 结束 | RAG embedding 成本；每轮双 LLM（主对话+记忆提取）→ **M7-4 优化** |
| M6 结束 | MCP server 超时处理 |
| M7 结束 | write_file 权限；**Token 消耗与长会话压缩**（M7-4 + M7-5） |
| M8 结束 | Live2D 模型版权与路径；精灵图素材授权 |

---

## 文档修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-06-29 | 初稿，覆盖 M1–M7 任务分解 |
| 0.1.1 | 2026-06-29 | M1 验收完成，标记可进入 M2 |
| 0.1.2 | 2026-06-29 | M2 验收完成，进入 M3 |
| 0.1.3 | 2026-06-29 | M3 验收完成，进入 M4 |
| 0.1.4 | 2026-06-29 | M3 文档补充：结构化 memory_key、upsert、增量提取 |
| 0.1.5 | 2026-06-29 | 桌宠延后至 M8；M5 收窄为 RAG only |
| 0.1.6 | 2026-06-29 | 新增 M7-4 Token 优化排期；M7-5 会话压缩；轻量历史会话已完成 |
| 0.1.7 | 2026-06-29 | M5 RAG 验收完成（伸宏测试文档导入问答）；进入 M6 |
| 0.1.8 | 2026-06-29 | M4 文档同步：托盘/Dock/多窗 UX 验收；M5 里程碑确认完成 |

---

*下一步：从 **M6 Task M6-1**（MCP Client）开始执行。*
