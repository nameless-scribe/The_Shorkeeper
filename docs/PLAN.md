# The Shorekeeper 实施计划

> **执行说明：** 按里程碑 M1 → M7 顺序推进。每完成一个 Task 勾选 checkbox。每完成一个里程碑做一次整体验证后再进入下一阶段。  
> **设计依据：** [DESIGN.md](./DESIGN.md)  
> **当前进度：** **M3 已完成**（2026-06-29 手动验收）→ 下一步：**M4 多窗 UI**

**Goal：** 从零构建自用桌面 AI Agent 应用 The Shorekeeper，具备流式聊天、工具调用、记忆、RAG、Live2D 桌宠与多窗伴侣 UI。

**Architecture：** Electron 主进程承载 Agent 运行时与 SQLite；渲染进程仅负责 UI，通过 Preload IPC 与 AG-UI 事件流通信；能力按里程碑递增，每阶段可独立运行。

**Tech Stack：** Electron · TypeScript · Vite · React · Tailwind · better-sqlite3 · Drizzle · PixiJS · pixi-live2d-display

---

## 里程碑总览

| 里程碑 | 名称 | 预计工期 | 验收标准 |
|--------|------|----------|----------|
| M1 | 基础脚手架 | 3–5 天 | ✅ **已完成** — 能流式聊天，会话入库 |
| M2 | Agent 核心 | 4–6 天 | ✅ **已完成** — 工具循环、AG-UI 事件、工具卡片 |
| M3 | 记忆系统 | 3–5 天 | ✅ **已完成** — 长期记忆、Worldbook 注入、设置页 |
| M4 | 多窗 UI | 4–5 天 | 状态/日程窗、Token 统计 |
| M5 | Live2D + RAG | 5–7 天 | 桌宠联动，文档检索回答 |
| M6 | 扩展能力 | 4–6 天 | MCP、技能、TTS |
| M7 | 工具补齐 | 5–7 天 | 文档生成与生活类工具 |

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

- Schema：`0001_memory_worldbook.sql` + 可选 `0002_worldbook_fts5.sql`（sql.js 运行时以关键词匹配为主）
- 上下文：`context-builder.ts` 按 DESIGN §5.1 组装；orchestrator 已接入
- 工具：`recall_memory`、`search_worldbook`、`save_memory`
- 设置：顶栏 ⚙ → 用户画像 / Worldbook 管理（`SettingsDrawer`）
- 已验：Worldbook 命中（如「介绍一下守岸人」）、`long_term_memory` / `user_profile` 表有数据

---

### Task M3-1：扩展数据库 schema

**Files:**
- Modify: `src/db/schema.ts`
- Create: migration for `user_profile`, `long_term_memory`, `worldbook_entries`, FTS5

- [x] **Step 1** 添加表定义（见 DESIGN §7.2）

- [x] **Step 2** 手写 migration 创建 `worldbook_fts` 虚表及 trigger 同步

- [x] **Step 3** `pnpm db:migrate`

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

- [x] **Step 3** `saveMemory(content, importance, sessionId)`

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
- Create: `src/memory/summarizer.ts`

- [x] **Step 1** `run_finished` 后异步调用 LLM：「从对话提取值得长期记住的事实」

- [x] **Step 2** 去重：与已有记忆相似度简单字符串比较或后续向量

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m3): post-run memory extraction"
```

---

### Task M3-6：设置页 Worldbook 管理（基础）

**Files:**
- Create: `src/renderer/settings/WorldbookPage.tsx`, `electron/ipc/worldbook.ts`

- [x] **Step 1** 列表、新增、编辑、删除、启用开关

- [ ] **Step 2** Commit

```bash
git commit -m "feat(m3): worldbook settings ui"
```

---

### M3 验收清单

- [x] Worldbook 命中内容出现在回复语境中
- [x] 多轮对话后长期记忆表有新增
- [x] 用户画像可在设置中编辑

---

# M4：多窗 UI ← **当前里程碑**

**交付物：** 状态面板、日程/Token 面板、系统托盘、定时任务表。

---

### Task M4-1：窗口管理器

**Files:**
- Create: `electron/windows/manager.ts`, `electron/windows/chat.ts`, `electron/windows/status.ts`, `electron/windows/schedule.ts`

- [ ] **Step 1** 抽象 `WindowManager`：create/show/hide/getBounds/saveBounds

- [ ] **Step 2** 从 main.ts 拆出三窗创建逻辑

- [ ] **Step 3** 窗口位置持久化到 `app_settings`

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m4): multi window manager"
```

---

### Task M4-2：系统托盘

**Files:**
- Create: `electron/tray.ts`

- [ ] **Step 1** 托盘菜单：显示聊天/状态/日程、退出

- [ ] **Step 2** 关闭所有窗口时最小化到托盘（可选）

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): system tray"
```

---

### Task M4-3：Token 统计

**Files:**
- Modify: `src/db/schema.ts` → `token_usage`
- Create: `src/db/token-usage.ts`

- [ ] **Step 1** 每次 `usage` 事件写入 token_usage

- [ ] **Step 2** IPC `stats:getTokenUsage` 返回今日/本周/总量

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): token usage tracking"
```

---

### Task M4-4：状态面板 UI

**Files:**
- Create: `src/renderer/status/StatusPage.tsx`

- [ ] **Step 1** 订阅 `state_update` 事件

- [ ] **Step 2** 展示 Online、Mood、Activity（orchestrator 在 run 各阶段更新 state）

- [ ] **Step 3** 按钮：打开聊天、打开设置

- [ ] **Step 4** 轻量「喂食」互动：IPC 更新 activity=feeding，30s 后恢复

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m4): status panel ui"
```

---

### Task M4-5：日程 / Token 面板 UI

**Files:**
- Create: `src/renderer/schedule/SchedulePage.tsx`

- [ ] **Step 1** 安装 `recharts`，周 Token 柱状图

- [ ] **Step 2** 显示日期、今日 Token、进度条

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m4): schedule token panel with charts"
```

---

### Task M4-6：定时任务（表 + 调度器）

**Files:**
- Create: `src/db/schema.ts` 扩展, `src/scheduler/cron.ts`

- [ ] **Step 1** `scheduled_tasks` 表与 CRUD

- [ ] **Step 2** `node-cron` 加载 enabled 任务

- [ ] **Step 3** `action_type=reminder` 用 Notification；`agent_prompt` 触发静默 agent run

- [ ] **Step 4** 设置页任务列表 UI

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m4): scheduled tasks"
```

---

### M4 验收清单

- [ ] 三窗可独立显示/隐藏，托盘可用
- [ ] Token 图表有真实数据
- [ ] 定时 reminder 到点弹出

---

# M5：Live2D + RAG

**交付物：** 透明桌宠窗、动作联动、文档导入与向量检索。

---

### Task M5-1：Live2D 窗口

**Files:**
- Create: `electron/windows/live2d.ts`, `src/renderer/live2d/main.tsx`, `src/renderer/live2d/Live2DStage.tsx`

- [ ] **Step 1** 安装 `pixi.js`, `pixi-live2d-display`

- [ ] **Step 2** 透明置顶窗配置 `transparent: true`, `alwaysOnTop: true`

- [ ] **Step 3** 加载 `assets/live2d/` 下模型（用户自行放置，README 说明）

- [ ] **Step 4** 默认播放 idle 动作

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m5): live2d transparent window"
```

---

### Task M5-2：Live2D 动作联动

**Files:**
- Modify: `src/agent/orchestrator.ts`, `src/renderer/live2d/Live2DStage.tsx`

- [ ] **Step 1** orchestrator 在 think/speak/happy 阶段 `broadcast('agent:event', { type: 'live2d_motion', motion })`

- [ ] **Step 2** Live2D 窗订阅并 `model.motion(motionName)`

- [ ] **Step 3** 点击角色 IPC 打开聊天窗 + 播放 tap 动作

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m5): live2d motion sync"
```

---

### Task M5-3：RAG schema + sqlite-vec

**Files:**
- Create: `src/db/schema.ts` 扩展 documents/document_chunks
- Create: `src/rag/embedding.ts`

- [ ] **Step 1** 集成 sqlite-vec，document_chunks 加向量列

- [ ] **Step 2** embedding 调用 OpenAI `text-embedding-3-small` 或本地模型

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m5): rag schema and sqlite-vec"
```

---

### Task M5-4：文档导入管线

**Files:**
- Create: `src/rag/importer.ts`, `src/rag/chunker.ts`, `src/rag/retriever.ts`

- [ ] **Step 1** 支持 MD/TXT 先（PDF/DOCX 可后加库）

- [ ] **Step 2** chunk_size=512, overlap=64

- [ ] **Step 3** 设置页「导入文档」按钮 + 进度

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m5): document import and chunking"
```

---

### Task M5-5：RAG 注入 context

**Files:**
- Modify: `src/agent/context-builder.ts`

- [ ] **Step 1** 用户消息前检索 top-5 chunks

- [ ] **Step 2** 格式化为 `<reference>...</reference>` 注入 system

- [ ] **Step 3** 验收：导入文档后提问文档内容可答

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m5): rag retrieval in context builder"
```

---

### M5 验收清单

- [ ] Live2D 角色显示在桌面，动作与对话状态联动
- [ ] 导入 md 文件后，问答能引用文档内容
- [ ] `assets/live2d/` 在 gitignore 中

---

# M6：扩展能力

**交付物：** MCP Client、技能系统、TTS。

---

### Task M6-1：MCP Client

**Files:**
- Create: `src/mcp/client.ts`, `src/db/schema.ts` → `mcp_servers`

- [ ] **Step 1** 使用 `@modelcontextprotocol/sdk` 连接 stdio server

- [ ] **Step 2** 启动时加载 enabled servers，工具名加前缀 `mcp__{server}__{tool}`

- [ ] **Step 3** 合并进 ToolRegistry

- [ ] **Step 4** 设置页添加/测试/禁用 MCP

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m6): mcp client integration"
```

---

### Task M6-2：技能系统

**Files:**
- Create: `src/skills/loader.ts`, `skills/example/SKILL.md`

- [ ] **Step 1** 解析 SKILL.md frontmatter + body 为 Skill

- [ ] **Step 2** context-builder 注入已启用技能 fragment

- [ ] **Step 3** `allowedTools` 过滤工具列表

- [ ] **Step 4** 设置页技能开关

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m6): skill system"
```

---

### Task M6-3：TTS

**Files:**
- Create: `src/tts/engine.ts`

- [ ] **Step 1** 集成 edge-tts 或等价库，主进程合成

- [ ] **Step 2** `run_finished` 或流式累积后发送 `tts_chunk`

- [ ] **Step 3** 聊天窗或 Live2D 窗播放 Audio

- [ ] **Step 4** 设置页 TTS 开关与音色

- [ ] **Step 5** Commit

```bash
git commit -m "feat(m6): tts playback"
```

---

### Task M6-4：Anthropic-like 模型适配

**Files:**
- Create: `src/models/anthropic-like.ts`

- [ ] **Step 1** 实现 tool_use / tool_result 格式转换

- [ ] **Step 2** 设置页可选协议类型

- [ ] **Step 3** 测试与 loop 集成

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m6): anthropic like model adapter"
```

---

### M6 验收清单

- [ ] 至少一个 MCP Server 工具可调用
- [ ] 启用技能后 system prompt 有变化
- [ ] TTS 可朗读最后一条回复

---

# M7：工具补齐

**交付物：** 写文件、抓取、天气、翻译、文档生成、记账、旅行规划。

---

### Task M7-1：文件与网络工具

**Files:**
- Create: `src/tools/file/write-file.ts`, `src/tools/web/fetch-url.ts`, `src/tools/web/weather.ts`, `src/tools/web/translate.ts`

- [ ] **Step 1** write_file 需 confirm 权限

- [ ] **Step 2** 注册到 ToolRegistry

- [ ] **Step 3** 单测 + 手动验收

- [ ] **Step 4** Commit

```bash
git commit -m "feat(m7): write fetch weather translate tools"
```

---

### Task M7-2：文档生成工具

**Files:**
- Create: `src/tools/doc/gen-markdown.ts`, `gen-docx.ts`, `gen-xlsx.ts`, `gen-pdf.ts`

- [ ] **Step 1** 安装 `docx`, `exceljs`, `pdf-lib` 等

- [ ] **Step 2** 输出到 workspace 目录

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

- [ ] **Step 1** 记账：写入 SQLite，支持查询汇总

- [ ] **Step 2** 旅行规划：输出结构化 markdown  itinerary

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m7): bookkeeping and travel plan tools"
```

---

### Task M7-4：会话摘要压缩

**Files:**
- Modify: `src/memory/summarizer.ts`, `src/db/schema.ts` → `session_summaries`

- [ ] **Step 1** messages 超阈值时压缩早期消息为 summary

- [ ] **Step 2** loop 使用 summary + 近期 messages

- [ ] **Step 3** Commit

```bash
git commit -m "feat(m7): session context compression"
```

---

### Task M7-5：打包与发布（自用）

**Files:**
- Modify: `package.json` → `electron-builder` 配置

- [ ] **Step 1** 配置 `build.appId`, `directories.output`

- [ ] **Step 2** `pnpm build` 生成 Windows 安装包

- [ ] **Step 3** README：环境变量、Live2D 模型放置说明

- [ ] **Step 4** Commit

```bash
git commit -m "chore(m7): electron builder config and readme"
```

---

### M7 验收清单

- [ ] 文档生成工具可产出可打开的文件
- [ ] 长会话不超限（摘要生效）
- [ ] 本地可打包运行

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
| M5 结束 | Live2D 模型版权与路径 |
| M6 结束 | MCP server 超时处理 |
| M7 结束 | write_file 权限与确认弹窗 |

---

## 文档修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-06-29 | 初稿，覆盖 M1–M7 任务分解 |
| 0.1.1 | 2026-06-29 | M1 验收完成，标记可进入 M2 |
| 0.1.2 | 2026-06-29 | M2 验收完成，进入 M3 |
| 0.1.3 | 2026-06-29 | M3 验收完成，进入 M4 |

---

*下一步：从 **M4 Task M4-1**（窗口管理器）开始执行。*
